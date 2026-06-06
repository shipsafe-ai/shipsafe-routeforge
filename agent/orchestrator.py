"""Orchestrator — ADK SequentialAgent wiring all specialists."""
from __future__ import annotations

import dataclasses
import logging
from typing import Any

import structlog

from agent.config import get_secret, gcp_project, vertex_location
from agent.specialists.commit_watcher import CommitWatcher, MergeRequestEvent
from agent.specialists.scenario_tester import ScenarioTester
from agent.specialists.code_context_analyzer import CodeContextAnalyzer
from agent.specialists.risk_gate import RiskGate, Verdict, VerdictEnum
from agent.specialists.changelog_writer import ChangelogWriter
from agent.critic import Critic, CriticReport

log = structlog.get_logger()


@dataclasses.dataclass
class PipelineResult:
    mr_iid: int
    verdict: Verdict
    critic_report: CriticReport
    comment_draft: str
    injection_blocked: bool


class RouteForgeOrchestrator:
    """Sequential pipeline: watch → test → analyze → gate → critic → draft comment.

    Human approval is MANDATORY before calling create_workitem_note.
    This class never posts to GitLab directly — it returns a draft for operator review.
    """

    def __init__(self) -> None:
        pat = get_secret("GITLAB_PAT")
        mcp_token = get_secret("GITLAB_MCP_OAUTH_TOKEN")
        project_id = gcp_project()
        location = vertex_location()

        self._watcher = CommitWatcher(gitlab_pat=pat, gitlab_project_id="82762386")
        self._tester = ScenarioTester()
        self._analyzer = CodeContextAnalyzer(mcp_oauth_token=mcp_token)
        self._gate = RiskGate(project_id=project_id, location=location)
        self._writer = ChangelogWriter(project_id=project_id, location=location)
        self._critic = Critic(project_id=project_id, location=location)

    async def run(self, webhook_payload: dict[str, Any]) -> PipelineResult | None:
        # 1. Parse webhook
        event: MergeRequestEvent | None = self._watcher.parse_webhook(webhook_payload)
        if event is None:
            log.info("pipeline.skipped", reason="non-trigger action")
            return None

        log.info("pipeline.start", mr_iid=event.mr_iid, title=event.title)

        # 2. Fetch diffs via REST API
        diffs = await self._watcher.fetch_mr_diffs(mr_iid=event.mr_iid)
        diff_text = "\n".join(d.get("diff", "") for d in diffs)

        # 3. Prompt injection check on raw diff content (DATA boundary)
        injection_report = await self._critic.check_injection(diff_content=diff_text)
        if injection_report.injection_detected:
            log.warning(
                "pipeline.injection_detected",
                indicators=injection_report.injection_indicators,
                mr_iid=event.mr_iid,
            )

        # 4. Scenario tests
        fixtures = self._tester.load_fixtures()
        scenario_results = self._tester.run_against_fixtures(
            diff_content=diff_text, fixtures=fixtures
        )
        scenario_dicts = [dataclasses.asdict(r) for r in scenario_results]

        # 5. Code context via MCP semantic_code_search
        code_context = await self._analyzer.analyze(diffs=diffs, project_id=str(event.project_id))
        context_dict = dataclasses.asdict(code_context)

        # 6. Risk gate — Gemini structured verdict
        verdict = await self._gate.evaluate(
            scenario_results=scenario_dicts,
            code_context=context_dict,
            mr_title=event.title,
        )

        verdict_dict = {
            "verdict": verdict.verdict.value,
            "confidence": verdict.confidence,
            "reasoning": verdict.reasoning,
            "affected_scenarios": verdict.affected_scenarios,
        }

        # 7. Critic challenges verdict
        critic_report = await self._critic.challenge_verdict(
            verdict=verdict_dict,
            scenario_results=scenario_dicts,
        )

        # 8. Draft comment (never posted without human approval)
        comment = await self._writer.draft_comment(
            verdict=verdict_dict,
            mr_iid=event.mr_iid,
        )

        log.info(
            "pipeline.complete",
            mr_iid=event.mr_iid,
            verdict=verdict.verdict,
            confidence=verdict.confidence,
            injection_blocked=injection_report.injection_detected,
        )

        return PipelineResult(
            mr_iid=event.mr_iid,
            verdict=verdict,
            critic_report=critic_report,
            comment_draft=comment,
            injection_blocked=injection_report.injection_detected,
        )

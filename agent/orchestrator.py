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
from agent.specialists.pipeline_observer import PipelineObserver, PipelineStatus
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
    pipeline_status: PipelineStatus | None = None
    diffs: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    changed_functions: list[str] = dataclasses.field(default_factory=list)
    throughput_delta_pct: float = 0.0
    scenarios_passed: int = 0
    scenarios_total: int = 0


class RouteForgeOrchestrator:
    """Sequential pipeline: watch → observe CI → test → analyze → gate → critic → draft.

    Human approval is MANDATORY before posting to GitLab.
    This class never posts directly — it returns a draft for operator review.
    """

    def __init__(self) -> None:
        pat = get_secret("GITLAB_PAT")
        project_id = gcp_project()
        location = vertex_location()

        self._watcher = CommitWatcher(gitlab_pat=pat, gitlab_project_id="82762386")
        self._observer = PipelineObserver(gitlab_pat=pat, gitlab_project_id="82762386")
        self._tester = ScenarioTester()
        self._analyzer = CodeContextAnalyzer(gitlab_pat=pat)
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

        # 2. Fetch diffs
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

        # 4. CI pipeline status (non-blocking — runs alongside scenario tests)
        pipeline_status = await self._observer.fetch_pipeline_status(mr_iid=event.mr_iid)
        log.info(
            "pipeline.ci_status",
            mr_iid=event.mr_iid,
            ci=pipeline_status.overall,
            failing_jobs=pipeline_status.failing_jobs,
        )

        # 5. Scenario tests
        fixtures = self._tester.load_fixtures()
        scenario_results = self._tester.run_against_fixtures(
            diff_content=diff_text, fixtures=fixtures
        )
        scenario_dicts = [dataclasses.asdict(r) for r in scenario_results]

        # 6. Code context via MCP semantic_code_search
        code_context = await self._analyzer.analyze(diffs=diffs, project_id=str(event.project_id))
        context_dict = dataclasses.asdict(code_context)

        # 7. Risk gate — Gemini structured verdict
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

        # 8. Critic challenges verdict
        critic_report = await self._critic.challenge_verdict(
            verdict=verdict_dict,
            scenario_results=scenario_dicts,
        )

        # 9. Draft comment (never posted without human approval)
        comment = await self._writer.draft_comment(
            verdict=verdict_dict,
            mr_iid=event.mr_iid,
        )

        log.info(
            "pipeline.complete",
            mr_iid=event.mr_iid,
            verdict=verdict.verdict,
            confidence=verdict.confidence,
            ci=pipeline_status.overall,
            injection_blocked=injection_report.injection_detected,
        )

        # Throughput stats from normal scenarios
        normal_results = [r for r in scenario_results if not r.get("crisis_mode")]
        max_delta = max((r.get("throughput_delta_pct", 0.0) for r in normal_results), default=0.0)
        # Count pass/fail: crisis scenario passes if handled correctly per RiskGate logic
        scenarios_passed = len([r for r in scenario_results if not (
            (r.get("crisis_mode") and not r.get("route_blocked") and not r.get("expected_rerouted", False))
            or (r.get("crisis_mode") and r.get("expected_rerouted") and not r.get("route_rerouted"))
            or (not r.get("crisis_mode") and r.get("route_blocked"))
        )])

        return PipelineResult(
            mr_iid=event.mr_iid,
            verdict=verdict,
            critic_report=critic_report,
            comment_draft=comment,
            injection_blocked=injection_report.injection_detected,
            pipeline_status=pipeline_status,
            diffs=diffs,
            changed_functions=code_context.changed_functions,
            throughput_delta_pct=max_delta,
            scenarios_passed=scenarios_passed,
            scenarios_total=len(scenario_results),
        )

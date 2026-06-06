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
from agent import pipeline_log

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
        iid = event.mr_iid
        TOTAL = 9
        pipeline_log.emit(iid, 1, TOTAL, f"CommitWatcher: MR !{iid} '{event.title}' — pipeline started")

        # 2. Fetch diffs
        pipeline_log.emit(iid, 2, TOTAL, "CommitWatcher: fetching MR diffs")
        diffs = await self._watcher.fetch_mr_diffs(mr_iid=iid)
        diff_text = "\n".join(d.get("diff", "") for d in diffs)

        # 3. Prompt injection check on raw diff content (DATA boundary)
        pipeline_log.emit(iid, 3, TOTAL, "Critic: scanning diff for prompt injection")
        injection_report = await self._critic.check_injection(diff_content=diff_text)
        if injection_report.injection_detected:
            log.warning(
                "pipeline.injection_detected",
                indicators=injection_report.injection_indicators,
                mr_iid=iid,
            )
            pipeline_log.emit(iid, 3, TOTAL, "Critic: ⚠ injection indicators detected")

        # 4. CI pipeline status
        pipeline_log.emit(iid, 4, TOTAL, "PipelineObserver: checking CI status")
        pipeline_status = await self._observer.fetch_pipeline_status(mr_iid=iid)
        pipeline_log.emit(iid, 4, TOTAL, f"PipelineObserver: CI {pipeline_status.overall}")
        log.info("pipeline.ci_status", mr_iid=iid, ci=pipeline_status.overall)

        # 5. Scenario tests
        pipeline_log.emit(iid, 5, TOTAL, "ScenarioTester: loading Hormuz crisis fixtures")
        fixtures = self._tester.load_fixtures()
        pipeline_log.emit(iid, 5, TOTAL, f"ScenarioTester: running {len(fixtures)} scenarios")
        scenario_results = self._tester.run_against_fixtures(
            diff_content=diff_text, fixtures=fixtures
        )
        scenario_dicts = [dataclasses.asdict(r) for r in scenario_results]
        crisis_fails = sum(
            1 for r in scenario_results
            if r.crisis_mode and not r.route_blocked and not r.route_rerouted
        )
        pipeline_log.emit(iid, 5, TOTAL, f"ScenarioTester: {len(fixtures) - crisis_fails}/{len(fixtures)} passed")

        # 6. Code context via MCP
        pipeline_log.emit(iid, 6, TOTAL, "CodeContextAnalyzer: semantic_code_search via MCP")
        code_context = await self._analyzer.analyze(diffs=diffs, project_id=str(event.project_id))
        context_dict = dataclasses.asdict(code_context)
        pipeline_log.emit(iid, 6, TOTAL, f"CodeContextAnalyzer: found {len(code_context.semantic_neighbors)} neighbors")

        # 7. Risk gate — Gemini structured verdict
        pipeline_log.emit(iid, 7, TOTAL, "RiskGate: Gemini evaluating verdict…")
        verdict = await self._gate.evaluate(
            scenario_results=scenario_dicts,
            code_context=context_dict,
            mr_title=event.title,
        )
        pipeline_log.emit(iid, 7, TOTAL, f"RiskGate: {verdict.verdict.value} ({int(verdict.confidence * 100)}% confidence)")

        verdict_dict = {
            "verdict": verdict.verdict.value,
            "confidence": verdict.confidence,
            "reasoning": verdict.reasoning,
            "affected_scenarios": verdict.affected_scenarios,
        }

        # 8. Critic challenges verdict
        pipeline_log.emit(iid, 8, TOTAL, "Critic: challenging verdict for false positives")
        critic_report = await self._critic.challenge_verdict(
            verdict=verdict_dict,
            scenario_results=scenario_dicts,
        )

        # 9. Draft comment
        pipeline_log.emit(iid, 9, TOTAL, "ChangelogWriter: drafting MR comment")
        comment = await self._writer.draft_comment(
            verdict=verdict_dict,
            mr_iid=iid,
        )

        log.info(
            "pipeline.complete",
            mr_iid=iid,
            verdict=verdict.verdict,
            confidence=verdict.confidence,
            ci=pipeline_status.overall,
            injection_blocked=injection_report.injection_detected,
        )
        pipeline_log.emit(
            iid, TOTAL, TOTAL,
            f"Done: {verdict.verdict.value} — {int(verdict.confidence * 100)}% confidence",
            done=True,
        )

        # Throughput stats from normal (non-crisis) scenarios — use dataclass attrs
        normal_results = [r for r in scenario_results if not r.crisis_mode]
        max_delta = max((r.throughput_delta_pct for r in normal_results), default=0.0)
        # Count pass/fail using the same logic as RiskGate pre-classification
        scenarios_passed = len([r for r in scenario_results if not (
            (r.crisis_mode and not r.route_blocked and not r.route_rerouted and r.crisis_mode)
            or (not r.crisis_mode and r.route_blocked)
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

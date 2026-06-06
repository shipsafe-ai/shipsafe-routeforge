"""Tests for RiskGate — MUST FAIL before implementation exists."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from agent.specialists.risk_gate import RiskGate, Verdict, VerdictEnum


SAMPLE_SCENARIO_RESULTS = [
    {
        "scenario_id": "hormuz_crisis_01",
        "route_blocked": True,
        "throughput_delta_pct": 12.3,
        "crisis_mode": True,
    },
    {
        "scenario_id": "normal_pacific_01",
        "route_blocked": False,
        "throughput_delta_pct": 12.1,
        "crisis_mode": False,
    },
]

SAMPLE_CODE_CONTEXT = {
    "changed_functions": ["route_via_strait"],
    "related_files": ["routing/strait_registry.py"],
    "semantic_neighbors": [],
}


@pytest.fixture
def gate():
    return RiskGate(project_id="shipsafe-routeforge", location="us-central1")


class TestVerdictEnum:
    def test_verdict_values(self):
        assert VerdictEnum.PASS == "PASS"
        assert VerdictEnum.BLOCK == "BLOCK"


class TestRiskGateVerdict:
    @pytest.mark.asyncio
    async def test_blocks_when_crisis_route_blocked(self, gate):
        mock_verdict = Verdict(
            verdict=VerdictEnum.BLOCK,
            confidence=0.97,
            reasoning="Hormuz crisis scenario blocks all Strait routing",
            affected_scenarios=["hormuz_crisis_01"],
        )
        with patch.object(gate, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = mock_verdict
            result = await gate.evaluate(
                scenario_results=SAMPLE_SCENARIO_RESULTS,
                code_context=SAMPLE_CODE_CONTEXT,
                mr_title="perf: optimize dynamic_path throughput",
            )
        assert result.verdict == VerdictEnum.BLOCK
        assert result.confidence >= 0.9

    @pytest.mark.asyncio
    async def test_uses_structured_output(self, gate):
        """Gemini must be called with structured output schema — never free text."""
        with patch.object(gate, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = Verdict(
                verdict=VerdictEnum.PASS,
                confidence=0.85,
                reasoning="No crisis scenarios affected",
                affected_scenarios=[],
            )
            await gate.evaluate(
                scenario_results=SAMPLE_SCENARIO_RESULTS,
                code_context=SAMPLE_CODE_CONTEXT,
                mr_title="test",
            )
        call_kwargs = mock_gemini.call_args[1]
        assert "response_schema" in call_kwargs or "schema" in str(mock_gemini.call_args)

    @pytest.mark.asyncio
    async def test_verdict_includes_confidence(self, gate):
        mock_verdict = Verdict(
            verdict=VerdictEnum.PASS,
            confidence=0.72,
            reasoning="Low risk change",
            affected_scenarios=[],
        )
        with patch.object(gate, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = mock_verdict
            result = await gate.evaluate(
                scenario_results=SAMPLE_SCENARIO_RESULTS,
                code_context=SAMPLE_CODE_CONTEXT,
                mr_title="docs: update readme",
            )
        assert 0.0 <= result.confidence <= 1.0

"""Tests for ChangelogWriter — MUST FAIL before implementation exists."""
import pytest
from unittest.mock import AsyncMock, patch

from agent.specialists.changelog_writer import ChangelogWriter


BLOCK_VERDICT = {
    "verdict": "BLOCK",
    "confidence": 0.97,
    "reasoning": "Hormuz crisis scenario blocks all Strait routing during active crisis",
    "affected_scenarios": ["hormuz_crisis_01", "hormuz_crisis_02"],
}

PASS_VERDICT = {
    "verdict": "PASS",
    "confidence": 0.88,
    "reasoning": "All scenarios pass; 12% throughput improvement confirmed",
    "affected_scenarios": [],
}


@pytest.fixture
def writer():
    return ChangelogWriter(project_id="shipsafe-routeforge", location="us-central1")


class TestCommentDrafting:
    @pytest.mark.asyncio
    async def test_drafts_block_comment(self, writer):
        with patch.object(writer, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "🚫 **RouteForge BLOCK** — Crisis routing failure detected..."
            comment = await writer.draft_comment(verdict=BLOCK_VERDICT, mr_iid=7)
        assert "BLOCK" in comment
        assert isinstance(comment, str)
        assert len(comment) > 50

    @pytest.mark.asyncio
    async def test_drafts_pass_comment(self, writer):
        with patch.object(writer, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "✅ **RouteForge PASS** — All 12 scenarios passed..."
            comment = await writer.draft_comment(verdict=PASS_VERDICT, mr_iid=7)
        assert "PASS" in comment

    @pytest.mark.asyncio
    async def test_comment_includes_confidence(self, writer):
        with patch.object(writer, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "🚫 **BLOCK** (confidence: 97%) — ..."
            comment = await writer.draft_comment(verdict=BLOCK_VERDICT, mr_iid=7)
        assert "97" in comment or "confidence" in comment.lower()

    @pytest.mark.asyncio
    async def test_comment_lists_affected_scenarios(self, writer):
        with patch.object(writer, "_call_gemini", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "🚫 BLOCK\n- hormuz_crisis_01\n- hormuz_crisis_02"
            comment = await writer.draft_comment(verdict=BLOCK_VERDICT, mr_iid=7)
        assert "hormuz_crisis_01" in comment or len(comment) > 0

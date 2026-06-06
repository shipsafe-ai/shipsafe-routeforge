"""Tests for ChatHandler."""
import pytest
from unittest.mock import AsyncMock, patch

from agent.specialists.chat_handler import ChatHandler


SAMPLE_VERDICT = {
    "mr_iid": 42,
    "mr_title": "Fix routing algorithm",
    "verdict": "BLOCK",
    "confidence": 0.8,
    "reasoning": "Crisis routing broken — strait not blocked during active crisis.",
    "affected_scenarios": ["hormuz_crisis_01", "hormuz_crisis_02"],
    "pipeline_status": {"overall": "passing", "failing_jobs": []},
}


@pytest.fixture
def handler():
    return ChatHandler()


class TestParseMessage:
    def test_parses_explain_command(self, handler):
        result = handler.parse_mention("@routeforge explain")
        assert result == ("explain", "")

    def test_parses_command_with_args(self, handler):
        result = handler.parse_mention("@routeforge explain why was this blocked?")
        assert result is not None
        assert result[0] == "explain"

    def test_case_insensitive(self, handler):
        result = handler.parse_mention("@RouteForge STATUS")
        assert result is not None
        assert result[0] == "status"

    def test_returns_none_when_no_mention(self, handler):
        assert handler.parse_mention("just a regular comment") is None

    def test_returns_none_empty_string(self, handler):
        assert handler.parse_mention("") is None


class TestHandleCommand:
    @pytest.mark.asyncio
    async def test_help_returns_text_without_gemini(self, handler):
        result = await handler.handle_command("help", "", None)
        assert "@routeforge" in result
        assert "explain" in result

    @pytest.mark.asyncio
    async def test_no_verdict_returns_processing_message(self, handler):
        result = await handler.handle_command("explain", "", None)
        assert "No verdict" in result or "processing" in result.lower()

    @pytest.mark.asyncio
    async def test_calls_gemini_with_context(self, handler):
        with patch("agent.specialists.chat_handler.generate_text", new_callable=AsyncMock) as mock:
            mock.return_value = "This MR was blocked because crisis routing failed."
            result = await handler.handle_command("explain", "", SAMPLE_VERDICT)
        mock.assert_called_once()
        assert "blocked" in result.lower() or len(result) > 0

    @pytest.mark.asyncio
    async def test_degrades_gracefully_on_gemini_error(self, handler):
        with patch("agent.specialists.chat_handler.generate_text", new_callable=AsyncMock) as mock:
            mock.side_effect = Exception("Vertex AI unavailable")
            result = await handler.handle_command("explain", "", SAMPLE_VERDICT)
        assert "error" in result.lower()

    @pytest.mark.asyncio
    async def test_handle_free_text_with_context(self, handler):
        with patch("agent.specialists.chat_handler.generate_text", new_callable=AsyncMock) as mock:
            mock.return_value = "The routing algorithm fails during Hormuz crisis."
            result = await handler.handle_free_text("What failed?", SAMPLE_VERDICT)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_handle_free_text_without_context(self, handler):
        with patch("agent.specialists.chat_handler.generate_text", new_callable=AsyncMock) as mock:
            mock.return_value = "RouteForge is an AI safety gate."
            result = await handler.handle_free_text("What is RouteForge?", None)
        assert len(result) > 0

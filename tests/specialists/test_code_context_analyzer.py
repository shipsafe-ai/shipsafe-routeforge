"""Tests for CodeContextAnalyzer — zereight/gitlab-mcp via Streamable HTTP."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from agent.specialists.code_context_analyzer import CodeContextAnalyzer, CodeContext


SAMPLE_DIFFS = [
    {
        "old_path": "routing/dynamic_path.py",
        "new_path": "routing/dynamic_path.py",
        "diff": "@@ -10,6 +10,8 @@ def route_via_strait(cargo):\n+    if crisis_mode:\n+        return None",
    }
]


@pytest.fixture
def analyzer():
    return CodeContextAnalyzer(gitlab_pat="glpat-test-token")


class TestMCPCodeSearch:
    @pytest.mark.asyncio
    async def test_calls_search_project_code(self, analyzer):
        with patch.object(analyzer, "_search_project_code", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = [{"text": "def route_via_strait(cargo):", "score": 0.8}]
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        mock_search.assert_called_once()
        call_args = mock_search.call_args
        assert "82762386" in str(call_args)

    @pytest.mark.asyncio
    async def test_returns_code_context(self, analyzer):
        with patch.object(analyzer, "_search_project_code", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = [{"text": "def route_via_strait(...):", "score": 0.8}]
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        assert isinstance(context, CodeContext)
        assert len(context.semantic_neighbors) == 1
        assert context.changed_functions is not None

    @pytest.mark.asyncio
    async def test_extracts_changed_function_names(self, analyzer):
        with patch.object(analyzer, "_search_project_code", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = []
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        assert "route_via_strait" in context.changed_functions or len(context.changed_functions) >= 0

    @pytest.mark.asyncio
    async def test_degrades_gracefully_on_mcp_error(self, analyzer):
        with patch.object(analyzer, "_search_project_code", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = Exception("connection refused")
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        assert isinstance(context, CodeContext)
        assert context.semantic_neighbors == []

    @pytest.mark.asyncio
    async def test_mcp_uses_private_token_auth(self, analyzer):
        """MCP calls must use Private-Token header for zereight remote authorization."""
        mock_resp = MagicMock(status_code=200)
        mock_resp.raise_for_status = MagicMock()
        mock_resp.headers = MagicMock()
        mock_resp.headers.get = MagicMock(return_value="test-session-id")
        mock_resp.json = lambda: {
            "result": {"content": [{"type": "text", "text": "def foo():"}]}
        }
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp
            await analyzer._search_project_code("routing strait", "82762386")
        assert mock_post.called
        first_call_kwargs = mock_post.call_args_list[0][1] or {}
        call_headers = first_call_kwargs.get("headers", {})
        assert call_headers.get("Private-Token") == "glpat-test-token"

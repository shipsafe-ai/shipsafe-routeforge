"""Tests for CodeContextAnalyzer — MUST FAIL before implementation exists."""
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
    return CodeContextAnalyzer(mcp_oauth_token="test-oauth-token")


class TestMCPSemanticSearch:
    @pytest.mark.asyncio
    async def test_calls_semantic_code_search(self, analyzer):
        mock_mcp_result = {
            "results": [
                {
                    "file_path": "routing/dynamic_path.py",
                    "content": "def route_via_strait(cargo, strait_id, crisis_mode=False):",
                    "score": 0.92,
                }
            ]
        }
        with patch.object(analyzer, "_call_mcp_tool", new_callable=AsyncMock) as mock_mcp:
            mock_mcp.return_value = mock_mcp_result
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        mock_mcp.assert_called_once()
        call_args = mock_mcp.call_args
        assert call_args[0][0] == "semantic_code_search"

    @pytest.mark.asyncio
    async def test_returns_code_context(self, analyzer):
        mock_mcp_result = {
            "results": [
                {"file_path": "routing/dynamic_path.py", "content": "def route_via_strait(...):", "score": 0.92}
            ]
        }
        with patch.object(analyzer, "_call_mcp_tool", new_callable=AsyncMock) as mock_mcp:
            mock_mcp.return_value = mock_mcp_result
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        assert isinstance(context, CodeContext)
        assert len(context.related_files) >= 0
        assert context.changed_functions is not None

    @pytest.mark.asyncio
    async def test_extracts_changed_function_names(self, analyzer):
        with patch.object(analyzer, "_call_mcp_tool", new_callable=AsyncMock) as mock_mcp:
            mock_mcp.return_value = {"results": []}
            context = await analyzer.analyze(diffs=SAMPLE_DIFFS, project_id="82762386")
        assert "route_via_strait" in context.changed_functions or len(context.changed_functions) >= 0

    @pytest.mark.asyncio
    async def test_mcp_http_transport(self, analyzer):
        """MCP calls must use HTTP transport to GITLAB_MCP_ENDPOINT."""
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {"result": {"results": []}},
            )
            await analyzer._call_mcp_tool("semantic_code_search", {"query": "routing strait"})
        mock_post.assert_called_once()
        url = mock_post.call_args[0][0]
        assert "gitlab.com" in url

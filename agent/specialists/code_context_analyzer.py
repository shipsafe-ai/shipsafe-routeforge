"""CodeContextAnalyzer — semantic_code_search via GitLab MCP (HTTP transport)."""
from __future__ import annotations

import dataclasses
import re
from typing import Any

import httpx

from agent.config import GITLAB_MCP_ENDPOINT

# Matches Python/Go/TS function definitions
_FUNC_PATTERN = re.compile(
    r"(?:^|\+)\s*(?:def|func|function|async def)\s+(\w+)",
    re.MULTILINE,
)


@dataclasses.dataclass
class CodeContext:
    changed_functions: list[str]
    related_files: list[dict[str, Any]]
    semantic_neighbors: list[dict[str, Any]]


class CodeContextAnalyzer:
    def __init__(self, mcp_oauth_token: str) -> None:
        self._token = mcp_oauth_token

    async def analyze(
        self, diffs: list[dict[str, Any]], project_id: str
    ) -> CodeContext:
        changed_fns = self._extract_changed_functions(diffs)
        query = self._build_search_query(diffs, changed_fns)

        try:
            mcp_result = await self._call_mcp_tool(
                "semantic_code_search",
                {
                    "query": query,
                    "project_id": project_id,
                    "limit": 10,
                },
            )
            results = mcp_result.get("results", [])
        except httpx.HTTPStatusError as exc:
            # MCP OAuth token not yet provisioned — degrade gracefully.
            # Pipeline continues with diff-only context; semantic_code_search
            # will be re-enabled once GITLAB_MCP_OAUTH_TOKEN is set via
            # `npx routeforge init`.
            import structlog
            structlog.get_logger().warning(
                "mcp.unavailable",
                status=exc.response.status_code,
                url=str(exc.request.url),
            )
            results = []

        return CodeContext(
            changed_functions=changed_fns,
            related_files=[r for r in results if r.get("score", 0) >= 0.7],
            semantic_neighbors=results,
        )

    # ------------------------------------------------------------------
    # MCP HTTP transport
    # ------------------------------------------------------------------

    async def _call_mcp_tool(self, tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
        """Call a GitLab MCP tool via HTTP transport."""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": params},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GITLAB_MCP_ENDPOINT,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_changed_functions(self, diffs: list[dict[str, Any]]) -> list[str]:
        fns: list[str] = []
        for diff in diffs:
            diff_text = diff.get("diff", "")
            fns.extend(_FUNC_PATTERN.findall(diff_text))
        return list(dict.fromkeys(fns))  # deduplicate, preserve order

    def _build_search_query(
        self, diffs: list[dict[str, Any]], changed_fns: list[str]
    ) -> str:
        files = " ".join(
            d.get("new_path", "") for d in diffs if d.get("new_path")
        )
        fns = " ".join(changed_fns)
        return f"routing algorithm strait crisis {fns} {files}".strip()

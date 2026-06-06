"""CodeContextAnalyzer — search_project_code via zereight/gitlab-mcp (Streamable HTTP)."""
from __future__ import annotations

import dataclasses
import os
import re
from typing import Any

import httpx
import structlog

log = structlog.get_logger()

# Matches Python/Go/TS function definitions
_FUNC_PATTERN = re.compile(
    r"(?:^|\+)\s*(?:def|func|function|async def)\s+(\w+)",
    re.MULTILINE,
)

_MCP_URL = os.environ.get(
    "ZEREIGHT_MCP_URL",
    "https://routeforge-mcp-336382452417.us-central1.run.app/mcp",
)


@dataclasses.dataclass
class CodeContext:
    changed_functions: list[str]
    related_files: list[dict[str, Any]]
    semantic_neighbors: list[dict[str, Any]]


class CodeContextAnalyzer:
    def __init__(self, gitlab_pat: str) -> None:
        self._pat = gitlab_pat

    async def analyze(
        self, diffs: list[dict[str, Any]], project_id: str
    ) -> CodeContext:
        changed_fns = self._extract_changed_functions(diffs)
        query = self._build_search_query(diffs, changed_fns)

        try:
            results = await self._search_project_code(query, project_id)
        except Exception as exc:
            log.warning("mcp.unavailable", error=str(exc), url=_MCP_URL)
            results = []

        return CodeContext(
            changed_functions=changed_fns,
            related_files=[r for r in results if r.get("score", 0) >= 0.7],
            semantic_neighbors=results,
        )

    # ------------------------------------------------------------------
    # MCP Streamable HTTP — initialize + tools/call
    # ------------------------------------------------------------------

    async def _search_project_code(
        self, query: str, project_id: str
    ) -> list[dict[str, Any]]:
        base_headers = {
            "Private-Token": self._pat,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1: initialize — server assigns session ID in response header
            init_resp = await client.post(
                _MCP_URL,
                headers=base_headers,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "routeforge", "version": "1.0.0"},
                    },
                },
            )
            init_resp.raise_for_status()
            session_id = init_resp.headers.get("mcp-session-id", "")
            session_headers = {**base_headers, "mcp-session-id": session_id}

            # Step 2: notifications/initialized
            await client.post(
                _MCP_URL,
                headers=session_headers,
                json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            )

            # Step 3: call search_project_code
            call_resp = await client.post(
                _MCP_URL,
                headers=session_headers,
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": "search_project_code",
                        "arguments": {
                            "project_id": str(project_id),
                            "search": query,
                        },
                    },
                },
            )
            call_resp.raise_for_status()

        data = call_resp.json()
        content = data.get("result", {}).get("content", [])
        results = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                results.append({"text": item.get("text", ""), "score": 0.8})
        return results

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_changed_functions(self, diffs: list[dict[str, Any]]) -> list[str]:
        fns: list[str] = []
        for diff in diffs:
            fns.extend(_FUNC_PATTERN.findall(diff.get("diff", "")))
        return list(dict.fromkeys(fns))

    def _build_search_query(
        self, diffs: list[dict[str, Any]], changed_fns: list[str]
    ) -> str:
        files = " ".join(d.get("new_path", "") for d in diffs if d.get("new_path"))
        fns = " ".join(changed_fns)
        return f"routing algorithm strait crisis {fns} {files}".strip()

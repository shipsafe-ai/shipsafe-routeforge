"""InlineCommenter — posts inline diff thread on Hormuz removal line via MCP."""
from __future__ import annotations

import hashlib
import os
import re
from typing import Any

import httpx
import structlog

log = structlog.get_logger()

_MCP_URL = os.environ.get(
    "ZEREIGHT_MCP_URL",
    "https://routeforge-mcp-336382452417.us-central1.run.app/mcp",
)

_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_HORMUZ_REMOVED = re.compile(r'^-\s+if\s+["\']HORMUZ["\']')
_HORMUZ_ADDED = re.compile(r'^\+\s+if\s+["\']HORMUZ["\']')


class InlineCommenter:
    def __init__(self, gitlab_pat: str) -> None:
        self._pat = gitlab_pat

    async def post_block_thread(
        self,
        project_id: int,
        mr_iid: int,
        diffs: list[dict[str, Any]],
        diff_refs: dict[str, str],
        affected_scenarios: list[str],
    ) -> bool:
        """Post inline thread on the line that removed Hormuz avoidance. Returns True on success."""
        location = _find_hormuz_removal(diffs)
        if not location:
            log.info("inline_commenter.no_target_line", mr_iid=mr_iid)
            return False

        file_path, old_line, new_path = location
        scenarios_str = (
            ", ".join(f"`{s}`" for s in affected_scenarios)
            if affected_scenarios
            else "none"
        )
        body = (
            f"🚫 **RouteForge: Hormuz avoidance removed here**\n\n"
            f"This line guarded all strait routing during active crises. "
            f"Removing it causes vessels to transit Hormuz during blockades — "
            f"failing scenarios: {scenarios_str}.\n\n"
            f'**Fix:** reinstate `if "HORMUZ" in avoid_straits:` block before merging.\n\n'
            f"🤖 *RouteForge AI Safety Gate*"
        )

        # line_code format: sha1(file_path)_{old_line}_{new_line}  (0 = no new line for deleted)
        file_sha = hashlib.sha1(file_path.encode()).hexdigest()
        line_code = f"{file_sha}_{old_line}_0"

        position = {
            "base_sha": diff_refs.get("base_sha", ""),
            "head_sha": diff_refs.get("head_sha", ""),
            "start_sha": diff_refs.get("start_sha", ""),
            "position_type": "text",
            "old_path": file_path,
            "new_path": new_path,
            "old_line": old_line,
            "new_line": None,
            "line_range": {
                "start": {
                    "line_code": line_code,
                    "type": "old",
                    "old_line": old_line,
                    "new_line": None,
                },
                "end": {
                    "line_code": line_code,
                    "type": "old",
                    "old_line": old_line,
                    "new_line": None,
                },
            },
        }

        success = await _mcp_create_thread(
            pat=self._pat,
            project_id=str(project_id),
            mr_iid=str(mr_iid),
            body=body,
            position=position,
        )
        log.info("inline_commenter.result", mr_iid=mr_iid, success=success, old_line=old_line, file=file_path)
        return success


def _find_hormuz_removal(diffs: list[dict[str, Any]]) -> tuple[str, int, str] | None:
    """Return (old_path, old_line_number, new_path) for a PERMANENT Hormuz removal (not refactor).

    Returns None if the Hormuz check was removed AND re-added (i.e. refactored, not deleted).
    """
    for diff in diffs:
        diff_text = diff.get("diff", "")
        old_path = diff.get("old_path") or diff.get("new_path", "")
        new_path = diff.get("new_path") or old_path

        lines = diff_text.splitlines()
        removed_at: int | None = None
        readded = any(_HORMUZ_ADDED.match(ln) for ln in lines)

        old_line = 0
        for line in lines:
            m = _HUNK_HEADER.match(line)
            if m:
                old_line = int(m.group(1)) - 1
                continue
            if line.startswith("\\"):
                continue
            if line.startswith("-"):
                old_line += 1
                if _HORMUZ_REMOVED.match(line) and removed_at is None:
                    removed_at = old_line
            elif line.startswith("+"):
                pass
            else:
                old_line += 1

        # Only flag if removed and NOT re-added elsewhere in the same diff
        if removed_at is not None and not readded:
            return (old_path, removed_at, new_path)
    return None


async def _mcp_create_thread(
    pat: str,
    project_id: str,
    mr_iid: str,
    body: str,
    position: dict[str, Any],
) -> bool:
    base_headers = {
        "Private-Token": pat,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            init_resp = await client.post(
                _MCP_URL,
                headers=base_headers,
                json={
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "routeforge-inline", "version": "1.0.0"},
                    },
                },
            )
            init_resp.raise_for_status()
            session_id = init_resp.headers.get("mcp-session-id", "")
            session_headers = {**base_headers, "mcp-session-id": session_id}

            await client.post(
                _MCP_URL, headers=session_headers,
                json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            )

            resp = await client.post(
                _MCP_URL,
                headers=session_headers,
                json={
                    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {
                        "name": "create_merge_request_thread",
                        "arguments": {
                            "project_id": project_id,
                            "merge_request_iid": mr_iid,
                            "body": body,
                            "position": position,
                        },
                    },
                },
            )
            resp.raise_for_status()
            return True
    except Exception as exc:
        log.warning("inline_commenter.mcp_error", error=str(exc), mr_iid=mr_iid)
        return False

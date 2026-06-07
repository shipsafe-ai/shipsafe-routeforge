"""InlineCommenter — posts and resolves inline diff threads via MCP."""
from __future__ import annotations

import hashlib
import re
from typing import Any

import structlog

from agent.mcp_client import call_tool_json

log = structlog.get_logger()

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
    ) -> str | None:
        """Post inline thread on the removed Hormuz avoidance line. Returns discussion_id or None."""
        location = _find_hormuz_removal(diffs)
        if not location:
            log.info("inline_commenter.no_target_line", mr_iid=mr_iid)
            return None

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
                "start": {"line_code": line_code, "type": "old", "old_line": old_line, "new_line": None},
                "end":   {"line_code": line_code, "type": "old", "old_line": old_line, "new_line": None},
            },
        }

        try:
            result = await call_tool_json(self._pat, "create_merge_request_thread", {
                "project_id": str(project_id),
                "merge_request_iid": str(mr_iid),
                "body": body,
                "position": position,
            })
            disc_id = result.get("id", "")
            log.info("inline_commenter.thread_posted", mr_iid=mr_iid, discussion_id=disc_id, old_line=old_line)
            return disc_id or None
        except Exception as exc:
            log.warning("inline_commenter.mcp_error", error=str(exc), mr_iid=mr_iid)
            return None

    async def resolve_block_threads(
        self,
        project_id: int,
        mr_iid: int,
        discussion_ids: list[str],
    ) -> int:
        """Resolve stored inline block threads when MR flips to PASS. Returns count resolved."""
        resolved = 0
        for disc_id in discussion_ids:
            try:
                await call_tool_json(self._pat, "resolve_merge_request_thread", {
                    "project_id": str(project_id),
                    "merge_request_iid": str(mr_iid),
                    "discussion_id": disc_id,
                    "resolved": True,
                })
                resolved += 1
                log.info("inline_commenter.thread_resolved", mr_iid=mr_iid, discussion_id=disc_id)
            except Exception:
                log.warning("inline_commenter.resolve_error", mr_iid=mr_iid, discussion_id=disc_id)
        return resolved


def _find_hormuz_removal(diffs: list[dict[str, Any]]) -> tuple[str, int, str] | None:
    """Return (old_path, old_line_number, new_path) for a PERMANENT Hormuz removal (not refactor)."""
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
            elif not line.startswith("+"):
                old_line += 1

        if removed_at is not None and not readded:
            return (old_path, removed_at, new_path)
    return None

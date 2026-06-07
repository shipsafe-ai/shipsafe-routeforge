"""CommitWatcher — parses GitLab webhook, fetches MR details via REST API (PAT auth)."""
from __future__ import annotations

import dataclasses
from typing import Any

import httpx

from agent.config import GITLAB_API_BASE


@dataclasses.dataclass
class MergeRequestEvent:
    project_id: int
    mr_iid: int
    title: str
    source_branch: str
    target_branch: str
    last_commit_sha: str
    action: str


class CommitWatcher:
    TRIGGER_ACTIONS = {"open", "reopen"}

    def __init__(self, gitlab_pat: str, gitlab_project_id: str) -> None:
        self._pat = gitlab_pat
        self._project_id = gitlab_project_id

    # ------------------------------------------------------------------
    # Webhook parsing
    # ------------------------------------------------------------------

    def parse_webhook(self, payload: dict[str, Any]) -> MergeRequestEvent | None:
        if payload.get("object_kind") != "merge_request":
            raise ValueError("Not a merge_request event")

        attrs = payload["object_attributes"]
        action = attrs.get("action", "")

        if action not in self.TRIGGER_ACTIONS:
            return None

        return MergeRequestEvent(
            project_id=payload["project"]["id"],
            mr_iid=attrs["iid"],
            title=attrs["title"],
            source_branch=attrs["source_branch"],
            target_branch=attrs["target_branch"],
            last_commit_sha=(attrs.get("last_commit") or {}).get("id", ""),
            action=action,
        )

    # ------------------------------------------------------------------
    # GitLab REST API (PAT auth)
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {"PRIVATE-TOKEN": self._pat}

    def _project_url(self) -> str:
        return f"{GITLAB_API_BASE}/projects/{self._project_id}"

    async def fetch_mr_details(self, mr_iid: int) -> dict[str, Any]:
        url = f"{self._project_url()}/merge_requests/{mr_iid}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def fetch_mr_commits(self, mr_iid: int) -> list[dict[str, Any]]:
        url = f"{self._project_url()}/merge_requests/{mr_iid}/commits"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def fetch_mr_diffs(self, mr_iid: int) -> list[dict[str, Any]]:
        url = f"{self._project_url()}/merge_requests/{mr_iid}/diffs"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

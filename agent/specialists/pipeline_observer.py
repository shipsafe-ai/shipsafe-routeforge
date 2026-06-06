"""PipelineObserver — fetch CI pipeline status for an MR via GitLab REST API."""
from __future__ import annotations

import dataclasses
from typing import Any

import httpx
import structlog

from agent.config import GITLAB_API_BASE

log = structlog.get_logger()


@dataclasses.dataclass
class PipelineStatus:
    overall: str  # "passing" | "failing" | "running" | "pending" | "none"
    pipeline_id: int | None
    pipeline_url: str
    failing_jobs: list[str]
    coverage: float | None


_STATUS_MAP = {
    "success": "passing",
    "failed": "failing",
    "running": "running",
    "pending": "pending",
    "canceled": "failing",
    "skipped": "none",
    "manual": "pending",
    "created": "pending",
    "preparing": "running",
    "waiting_for_resource": "pending",
    "scheduled": "pending",
}


class PipelineObserver:
    def __init__(self, gitlab_pat: str, gitlab_project_id: str) -> None:
        self._pat = gitlab_pat
        self._project_id = gitlab_project_id

    def _headers(self) -> dict[str, str]:
        return {"PRIVATE-TOKEN": self._pat}

    async def fetch_pipeline_status(self, mr_iid: int) -> PipelineStatus:
        try:
            pipelines = await self._fetch_mr_pipelines(mr_iid)
            if not pipelines:
                return PipelineStatus(
                    overall="none", pipeline_id=None,
                    pipeline_url="", failing_jobs=[], coverage=None,
                )

            latest = pipelines[0]
            pipeline_id = latest["id"]
            pipeline_url = latest.get("web_url", "")
            overall = _STATUS_MAP.get(latest.get("status", ""), "none")

            failing_jobs: list[str] = []
            if overall in ("failing", "running"):
                jobs = await self._fetch_pipeline_jobs(pipeline_id)
                failing_jobs = [
                    j["name"] for j in jobs
                    if j.get("status") in ("failed", "canceled")
                ]

            return PipelineStatus(
                overall=overall,
                pipeline_id=pipeline_id,
                pipeline_url=pipeline_url,
                failing_jobs=failing_jobs,
                coverage=latest.get("coverage"),
            )

        except Exception as exc:
            log.warning("pipeline_observer.error", error=str(exc))
            return PipelineStatus(
                overall="none", pipeline_id=None,
                pipeline_url="", failing_jobs=[], coverage=None,
            )

    async def _fetch_mr_pipelines(self, mr_iid: int) -> list[dict[str, Any]]:
        url = f"{GITLAB_API_BASE}/projects/{self._project_id}/merge_requests/{mr_iid}/pipelines"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def _fetch_pipeline_jobs(self, pipeline_id: int) -> list[dict[str, Any]]:
        url = f"{GITLAB_API_BASE}/projects/{self._project_id}/pipelines/{pipeline_id}/jobs"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

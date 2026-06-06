"""FastAPI webhook handler — verifies X-Gitlab-Token, dispatches pipeline."""
from __future__ import annotations

import asyncio
import hmac
import logging
from collections import OrderedDict
from typing import Any

import httpx
import structlog
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agent.config import get_secret
from agent.orchestrator import RouteForgeOrchestrator, PipelineResult

log = structlog.get_logger()

app = FastAPI(title="RouteForge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_orchestrator: RouteForgeOrchestrator | None = None

# In-memory verdict store — keyed by mr_iid, capped at 50
_verdicts: OrderedDict[int, dict[str, Any]] = OrderedDict()


def _get_orchestrator() -> RouteForgeOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = RouteForgeOrchestrator()
    return _orchestrator


def _verify_token(provided: str, expected: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    return hmac.compare_digest(provided.encode(), expected.encode())


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "routeforge"}


@app.get("/verdicts")
async def list_verdicts() -> list[dict[str, Any]]:
    return list(reversed(list(_verdicts.values())))


@app.post("/verdicts/{mr_iid}/approve")
async def approve_verdict(mr_iid: int) -> JSONResponse:
    if mr_iid not in _verdicts:
        raise HTTPException(status_code=404, detail="Verdict not found")
    entry = _verdicts[mr_iid]
    if entry.get("posted"):
        return JSONResponse(content={"status": "already_posted"})

    pat = get_secret("GITLAB_PAT")
    project_id = entry["project_id"]
    comment = entry["comment_draft"]
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://gitlab.com/api/v4/projects/{project_id}/merge_requests/{mr_iid}/notes",
            headers={"PRIVATE-TOKEN": pat},
            json={"body": comment},
        )
    if resp.status_code == 201:
        _verdicts[mr_iid]["posted"] = True
        log.info("verdict.approved", mr_iid=mr_iid)
        return JSONResponse(content={"status": "posted"})
    raise HTTPException(status_code=502, detail=f"GitLab returned {resp.status_code}")


@app.post("/webhooks/gitlab", status_code=status.HTTP_202_ACCEPTED)
async def gitlab_webhook(
    request: Request,
    x_gitlab_token: str | None = Header(default=None),
) -> JSONResponse:
    # Token verification against Secret Manager value
    expected_token = get_secret("GITLAB_WEBHOOK_SECRET")

    if not x_gitlab_token:
        raise HTTPException(status_code=401, detail="Missing X-Gitlab-Token header")

    if not _verify_token(x_gitlab_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    payload: dict[str, Any] = await request.json()

    # Non-MR events are acknowledged but not processed
    if payload.get("object_kind") != "merge_request":
        return JSONResponse(content={"status": "ignored", "reason": "not a merge_request event"})

    # Run pipeline in background — respond immediately so GitLab doesn't time out
    asyncio.create_task(run_pipeline(payload))

    return JSONResponse(
        status_code=202,
        content={"status": "queued", "object_kind": "merge_request"},
    )


async def run_pipeline(payload: dict[str, Any]) -> None:
    """Background pipeline execution. Never posts to GitLab without operator approval."""
    try:
        orch = _get_orchestrator()
        result = await orch.run(payload)
        if result:
            log.info(
                "pipeline.result",
                mr_iid=result.mr_iid,
                verdict=result.verdict.verdict,
                confidence=result.verdict.confidence,
                injection_blocked=result.injection_blocked,
            )
            log.info("pipeline.comment_draft", comment=result.comment_draft)
            _store_verdict(result, payload)
    except Exception:
        log.exception("pipeline.error")


def _store_verdict(result: PipelineResult, payload: dict[str, Any]) -> None:
    from datetime import datetime, timezone
    import json
    mr = payload.get("object_attributes", {})
    entry = {
        "mr_iid": result.mr_iid,
        "mr_title": mr.get("title", f"MR !{result.mr_iid}"),
        "mr_url": mr.get("url", ""),
        "project_id": payload.get("project", {}).get("id", ""),
        "verdict": result.verdict.verdict,
        "confidence": result.verdict.confidence,
        "reasoning": result.verdict.reasoning,
        "affected_scenarios": result.verdict.affected_scenarios if hasattr(result.verdict, "affected_scenarios") else [],
        "comment_draft": result.comment_draft,
        "injection_blocked": result.injection_blocked,
        "posted": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _verdicts[result.mr_iid] = entry
    if len(_verdicts) > 50:
        _verdicts.popitem(last=False)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("agent.webhooks:app", host="0.0.0.0", port=8080, reload=False)

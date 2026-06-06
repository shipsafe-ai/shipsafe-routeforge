"""FastAPI webhook handler — verifies X-Gitlab-Token, dispatches pipeline."""
from __future__ import annotations

import asyncio
import hmac
import re
import logging
from collections import OrderedDict
from typing import Any

import httpx
import json
import structlog
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from agent.config import get_secret
from agent.orchestrator import RouteForgeOrchestrator, PipelineResult
from agent.specialists.chat_handler import ChatHandler
from agent import pipeline_log

log = structlog.get_logger()

app = FastAPI(title="RouteForge", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_orchestrator: RouteForgeOrchestrator | None = None

# In-memory verdict store — keyed by mr_iid, capped at 50
_verdicts: OrderedDict[int, dict[str, Any]] = OrderedDict()

_INLINE_LINE_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)", re.MULTILINE)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def _get_orchestrator() -> RouteForgeOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = RouteForgeOrchestrator()
    return _orchestrator


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _verify_token(provided: str, expected: str) -> bool:
    return hmac.compare_digest(provided.encode(), expected.encode())


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    mr_iid: int | None = None


# ---------------------------------------------------------------------------
# Health + verdicts
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "routeforge"}


@app.get("/verdicts")
async def list_verdicts() -> list[dict[str, Any]]:
    # Strip large diffs from API response — stored for inline comments only
    result = []
    for v in reversed(list(_verdicts.values())):
        entry = {k: val for k, val in v.items() if k != "diffs"}
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# Approve verdict — posts top-level note + inline diff threads
# ---------------------------------------------------------------------------

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

    async with httpx.AsyncClient(timeout=30) as client:
        # 1. Post top-level verdict note
        resp = await client.post(
            f"https://gitlab.com/api/v4/projects/{project_id}/merge_requests/{mr_iid}/notes",
            headers={"PRIVATE-TOKEN": pat},
            json={"body": comment},
        )

    if resp.status_code != 201:
        raise HTTPException(status_code=502, detail=f"GitLab returned {resp.status_code}")

    _verdicts[mr_iid]["posted"] = True
    log.info("verdict.approved", mr_iid=mr_iid)

    # 2. Post inline diff threads (best-effort — failures don't block the response)
    asyncio.create_task(
        _post_inline_threads(pat, project_id, mr_iid, entry)
    )

    return JSONResponse(content={"status": "posted"})


# ---------------------------------------------------------------------------
# Create GitLab issue for a BLOCK verdict
# ---------------------------------------------------------------------------

@app.post("/verdicts/{mr_iid}/create-issue")
async def create_issue_for_verdict(mr_iid: int) -> JSONResponse:
    if mr_iid not in _verdicts:
        raise HTTPException(status_code=404, detail="Verdict not found")
    entry = _verdicts[mr_iid]
    if entry["verdict"] != "BLOCK":
        raise HTTPException(status_code=400, detail="Only BLOCK verdicts can create issues")
    if entry.get("issue_url"):
        return JSONResponse(content={"status": "exists", "issue_url": entry["issue_url"]})

    pat = get_secret("GITLAB_PAT")
    project_id = entry["project_id"]
    scenarios = entry.get("affected_scenarios", [])

    title = f"[RouteForge BLOCK] MR !{mr_iid}: {entry['mr_title']}"
    description = (
        f"RouteForge AI Safety Gate detected a blocking issue in MR [!{mr_iid}]({entry['mr_url']}).\n\n"
        f"**Confidence:** {int(entry['confidence'] * 100)}%\n\n"
        f"**Reasoning:**\n{entry['reasoning']}\n\n"
        f"**Affected scenarios:**\n"
        + "\n".join(f"- `{s}`" for s in scenarios)
        + "\n\n---\n🤖 *Auto-created by RouteForge AI Safety Gate*"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://gitlab.com/api/v4/projects/{project_id}/issues",
            headers={"PRIVATE-TOKEN": pat},
            json={"title": title, "description": description, "labels": "routeforge,block"},
        )

    if resp.status_code == 201:
        issue = resp.json()
        _verdicts[mr_iid]["issue_url"] = issue.get("web_url", "")
        return JSONResponse(content={"status": "created", "issue_url": issue.get("web_url", "")})
    raise HTTPException(status_code=502, detail=f"GitLab returned {resp.status_code}")


# ---------------------------------------------------------------------------
# Dashboard chat endpoint
# ---------------------------------------------------------------------------

@app.post("/chat")
async def chat_endpoint(body: ChatRequest) -> JSONResponse:
    handler = ChatHandler()
    context = _verdicts.get(body.mr_iid) if body.mr_iid is not None else None
    # Strip diffs from context passed to Gemini — not needed for chat
    if context:
        context = {k: v for k, v in context.items() if k != "diffs"}
    response = await handler.handle_free_text(body.message, context)
    return JSONResponse(content={"response": response})


# ---------------------------------------------------------------------------
# Live pipeline log stream (SSE)
# ---------------------------------------------------------------------------

@app.get("/verdicts/{mr_iid}/log")
async def stream_pipeline_log(mr_iid: int) -> StreamingResponse:
    async def generator():
        # Replay stored events first (catches clients that connect after pipeline finishes)
        stored = pipeline_log.get_stored(mr_iid)
        for entry in stored:
            yield f"data: {json.dumps(entry)}\n\n"
        if stored and stored[-1].get("done"):
            return  # pipeline already done — nothing more to stream

        q = pipeline_log.subscribe(mr_iid)
        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                    if entry.get("done"):
                        break
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            pipeline_log.unsubscribe(mr_iid, q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# GitLab webhook entry point
# ---------------------------------------------------------------------------

@app.post("/webhooks/gitlab", status_code=status.HTTP_202_ACCEPTED)
async def gitlab_webhook(
    request: Request,
    x_gitlab_token: str | None = Header(default=None),
) -> JSONResponse:
    expected_token = get_secret("GITLAB_WEBHOOK_SECRET")

    if not x_gitlab_token:
        raise HTTPException(status_code=401, detail="Missing X-Gitlab-Token header")

    if not _verify_token(x_gitlab_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    payload: dict[str, Any] = await request.json()
    event_kind = payload.get("object_kind")

    if event_kind == "merge_request":
        asyncio.create_task(run_pipeline(payload))
        return JSONResponse(
            status_code=202,
            content={"status": "queued", "object_kind": "merge_request"},
        )

    if event_kind == "note":
        attrs = payload.get("object_attributes", {})
        note_text = attrs.get("note", "")
        noteable_type = attrs.get("noteable_type", "")

        if noteable_type == "MergeRequest" and "@routeforge" in note_text.lower():
            mr_iid = payload.get("merge_request", {}).get("iid")
            project_id = payload.get("project_id") or payload.get("project", {}).get("id")
            if mr_iid and project_id:
                asyncio.create_task(
                    handle_routeforge_mention(note_text, int(mr_iid), str(project_id))
                )

        return JSONResponse(content={"status": "ok", "object_kind": "note"})

    return JSONResponse(content={"status": "ignored", "reason": f"unhandled event: {event_kind}"})


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def run_pipeline(payload: dict[str, Any]) -> None:
    """Background pipeline — never posts to GitLab without operator approval."""
    try:
        orch = _get_orchestrator()
        result = await orch.run(payload)
        if result:
            log.info(
                "pipeline.result",
                mr_iid=result.mr_iid,
                verdict=result.verdict.verdict,
                confidence=result.verdict.confidence,
                ci=result.pipeline_status.overall if result.pipeline_status else "unknown",
                injection_blocked=result.injection_blocked,
            )
            _store_verdict(result, payload)
    except Exception:
        log.exception("pipeline.error")


async def handle_routeforge_mention(
    note_text: str, mr_iid: int, project_id: str
) -> None:
    """Respond to @routeforge commands posted in GitLab MR comments."""
    try:
        handler = ChatHandler()
        parsed = handler.parse_mention(note_text)
        if parsed is None:
            return

        command, args = parsed
        # Diffs excluded from context — not needed for chat
        raw_ctx = _verdicts.get(mr_iid)
        ctx = {k: v for k, v in raw_ctx.items() if k != "diffs"} if raw_ctx else None

        response = await handler.handle_command(command, args, ctx)
        pat = get_secret("GITLAB_PAT")

        body = f"🤖 **@routeforge `{command}`**:\n\n{response}"

        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(
                f"https://gitlab.com/api/v4/projects/{project_id}/merge_requests/{mr_iid}/notes",
                headers={"PRIVATE-TOKEN": pat},
                json={"body": body},
            )
        log.info("routeforge_mention.replied", mr_iid=mr_iid, command=command)

    except Exception:
        log.exception("routeforge_mention.error", mr_iid=mr_iid)


async def _post_inline_threads(
    pat: str,
    project_id: str,
    mr_iid: int,
    entry: dict[str, Any],
) -> None:
    """Post inline discussion threads on failing function lines (best-effort)."""
    diffs = entry.get("diffs", [])
    changed_fns = entry.get("changed_functions", [])
    affected = entry.get("affected_scenarios", [])

    if not diffs or not changed_fns or not affected:
        return

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Fetch diff_refs (base/head/start SHAs) from MR
            mr_resp = await client.get(
                f"https://gitlab.com/api/v4/projects/{project_id}/merge_requests/{mr_iid}",
                headers={"PRIVATE-TOKEN": pat},
            )
            if mr_resp.status_code != 200:
                return

            diff_refs = mr_resp.json().get("diff_refs", {})
            if not diff_refs.get("head_sha"):
                return

            posted = 0
            for fn_name in changed_fns[:3]:
                location = _find_function_in_diffs(diffs, fn_name)
                if not location:
                    continue
                file_path, line_num = location
                scenarios_text = ", ".join(f"`{s}`" for s in affected[:2])
                body = (
                    f"🚫 **RouteForge**: `{fn_name}` fails crisis scenarios: {scenarios_text}. "
                    f"Check crisis-mode avoidance logic."
                )
                ok = await _post_inline_discussion(
                    client, pat, project_id, mr_iid, diff_refs, file_path, line_num, body
                )
                if ok:
                    posted += 1

            log.info("inline_threads.posted", mr_iid=mr_iid, count=posted)

    except Exception:
        log.exception("inline_threads.error", mr_iid=mr_iid)


async def _post_inline_discussion(
    client: httpx.AsyncClient,
    pat: str,
    project_id: str,
    mr_iid: int,
    diff_refs: dict[str, str],
    file_path: str,
    new_line: int,
    body: str,
) -> bool:
    url = f"https://gitlab.com/api/v4/projects/{project_id}/merge_requests/{mr_iid}/discussions"
    payload = {
        "body": body,
        "position": {
            "base_sha": diff_refs.get("base_sha", ""),
            "start_sha": diff_refs.get("start_sha", ""),
            "head_sha": diff_refs.get("head_sha", ""),
            "position_type": "text",
            "new_path": file_path,
            "new_line": new_line,
        },
    }
    try:
        resp = await client.post(url, headers={"PRIVATE-TOKEN": pat}, json=payload)
        return resp.status_code in (200, 201)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Verdict store
# ---------------------------------------------------------------------------

def _store_verdict(result: PipelineResult, payload: dict[str, Any]) -> None:
    from datetime import datetime, timezone

    mr = payload.get("object_attributes", {})
    ps = result.pipeline_status

    entry: dict[str, Any] = {
        "mr_iid": result.mr_iid,
        "mr_title": mr.get("title", f"MR !{result.mr_iid}"),
        "mr_url": mr.get("url", ""),
        "project_id": payload.get("project", {}).get("id", ""),
        "verdict": result.verdict.verdict,
        "confidence": result.verdict.confidence,
        "reasoning": result.verdict.reasoning,
        "affected_scenarios": result.verdict.affected_scenarios
        if hasattr(result.verdict, "affected_scenarios")
        else [],
        "comment_draft": result.comment_draft,
        "injection_blocked": result.injection_blocked,
        "posted": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        # Pipeline CI status
        "pipeline_status": {
            "overall": ps.overall if ps else "none",
            "pipeline_url": ps.pipeline_url if ps else "",
            "failing_jobs": ps.failing_jobs if ps else [],
            "coverage": ps.coverage if ps else None,
        },
        # Stored for inline comments during approve — stripped from list API
        "diffs": result.diffs,
        "changed_functions": result.changed_functions,
        # Scenario stats for PASS/BLOCK card display
        "throughput_delta_pct": result.throughput_delta_pct,
        "scenarios_passed": result.scenarios_passed,
        "scenarios_total": result.scenarios_total,
    }

    _verdicts[result.mr_iid] = entry
    if len(_verdicts) > 50:
        _verdicts.popitem(last=False)


# ---------------------------------------------------------------------------
# Diff helpers (line number extraction for inline comments)
# ---------------------------------------------------------------------------

def _find_function_in_diffs(
    diffs: list[dict[str, Any]], func_name: str
) -> tuple[str, int] | None:
    """Find (file_path, new_file_line_number) for a function in the diff list."""
    for d in diffs:
        file_path = d.get("new_path", "")
        diff_text = d.get("diff", "")
        line_num = _parse_function_line(diff_text, func_name)
        if line_num is not None:
            return (file_path, line_num)
    return None


def _parse_function_line(diff_text: str, func_name: str) -> int | None:
    """Return the new-file line number where func_name appears in a unified diff."""
    new_line = 0

    for raw in diff_text.splitlines():
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)", raw)
        if m:
            # new_line will be incremented on first non-removed line to equal hunk start
            new_line = int(m.group(1)) - 1
            continue

        if raw.startswith("-"):
            continue  # removed line: no new-file line consumed

        new_line += 1  # context or added line

        if raw.startswith("+") and func_name in raw:
            return new_line

    return None


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("agent.webhooks:app", host="0.0.0.0", port=8080, reload=False)

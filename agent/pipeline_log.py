"""In-process pipeline log store — emit from orchestrator, stream via SSE from webhooks."""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

# stored log entries per MR IID — replayed on SSE connect
_stored: dict[int, list[dict[str, Any]]] = defaultdict(list)
# live listener queues per MR IID
_listeners: dict[int, set[asyncio.Queue]] = defaultdict(set)

_MAX_STORED = 200


def emit(mr_iid: int, step: int, total: int, label: str, done: bool = False) -> None:
    """Called from orchestrator at each pipeline step."""
    entry: dict[str, Any] = {
        "step": step, "total": total,
        "label": label, "done": done,
    }
    _stored[mr_iid].append(entry)
    if len(_stored[mr_iid]) > _MAX_STORED:
        _stored[mr_iid] = _stored[mr_iid][-_MAX_STORED:]
    for q in list(_listeners.get(mr_iid, set())):
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            pass


def get_stored(mr_iid: int) -> list[dict[str, Any]]:
    return list(_stored.get(mr_iid, []))


def subscribe(mr_iid: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _listeners[mr_iid].add(q)
    return q


def unsubscribe(mr_iid: int, q: asyncio.Queue) -> None:
    _listeners[mr_iid].discard(q)

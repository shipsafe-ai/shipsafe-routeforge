"""Shared MCP Streamable HTTP client — initialize → tools/call → parse."""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
import structlog

log = structlog.get_logger()

MCP_URL = os.environ.get(
    "ZEREIGHT_MCP_URL",
    "https://routeforge-mcp-336382452417.us-central1.run.app/mcp",
)


def _parse_sse(body: str) -> dict[str, Any]:
    for line in body.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(body)


def _extract_text(result: dict[str, Any]) -> str:
    """Pull first text content item from an MCP tool result."""
    for item in result.get("content", []):
        if isinstance(item, dict) and item.get("type") == "text":
            return item.get("text", "")
    return ""


async def call_tool(pat: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Call one MCP tool. Returns the raw result dict (has 'content' key)."""
    headers = {
        "Private-Token": pat,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        init_resp = await client.post(
            MCP_URL,
            headers=headers,
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
        session_headers = {**headers, "mcp-session-id": session_id}

        await client.post(
            MCP_URL,
            headers=session_headers,
            json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        )

        call_resp = await client.post(
            MCP_URL,
            headers=session_headers,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            },
        )
        call_resp.raise_for_status()

    data = _parse_sse(call_resp.text)
    result = data.get("result", {})
    log.debug("mcp.tool_called", tool=tool_name, content_items=len(result.get("content", [])))
    return result


async def call_tool_json(pat: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Call MCP tool and parse first text content as JSON."""
    result = await call_tool(pat, tool_name, arguments)
    text = _extract_text(result)
    return json.loads(text) if text else {}


async def call_tool_text(pat: str, tool_name: str, arguments: dict[str, Any]) -> str:
    """Call MCP tool and return first text content as string."""
    result = await call_tool(pat, tool_name, arguments)
    return _extract_text(result)

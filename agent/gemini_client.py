"""Shared Gemini client — google-genai SDK against Agent Platform (Vertex AI)."""
from __future__ import annotations

import functools
import structlog
from google import genai
from google.genai import types

from agent.config import gemini_model, gcp_project, vertex_location

log = structlog.get_logger()


@functools.lru_cache(maxsize=1)
def get_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=gcp_project(),
        location=vertex_location(),
    )


def _thinking_config(budget: int | None) -> types.ThinkingConfig | None:
    if budget and budget > 0:
        return types.ThinkingConfig(thinking_budget=budget, include_thoughts=True)
    return None


def _log_thinking(response: genai.types.GenerateContentResponse, caller: str) -> int:
    """Log thinking token usage and return thinking token count."""
    usage = getattr(response, "usage_metadata", None)
    thinking_tokens = getattr(usage, "thoughts_token_count", 0) or 0
    if thinking_tokens:
        log.info("gemini.thinking", caller=caller, thinking_tokens=thinking_tokens,
                 total_tokens=getattr(usage, "total_token_count", 0))
    return thinking_tokens


def _extract_thoughts(response: genai.types.GenerateContentResponse) -> str:
    """Extract Gemini's chain-of-thought text (parts marked thought=True)."""
    thoughts: list[str] = []
    for cand in getattr(response, "candidates", []) or []:
        content = getattr(cand, "content", None)
        for part in (getattr(content, "parts", []) or []):
            if getattr(part, "thought", False) and getattr(part, "text", ""):
                thoughts.append(part.text)
    return "\n\n".join(thoughts)


async def generate_json(prompt: str, schema: dict, thinking_budget: int | None = None) -> str:
    """Call Gemini with JSON response schema. Returns raw JSON string."""
    client = get_client()
    tc = _thinking_config(thinking_budget)
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=tc,
    )
    response = await client.aio.models.generate_content(
        model=gemini_model(),
        contents=prompt,
        config=config,
    )
    _log_thinking(response, "generate_json")
    return response.text


async def generate_text(prompt: str, thinking_budget: int | None = None) -> str:
    """Call Gemini for free-form text."""
    client = get_client()
    tc = _thinking_config(thinking_budget)
    config = types.GenerateContentConfig(thinking_config=tc) if tc else None
    response = await client.aio.models.generate_content(
        model=gemini_model(),
        contents=prompt,
        config=config,
    )
    _log_thinking(response, "generate_text")
    return response.text


async def generate_json_with_thinking(
    prompt: str, schema: dict, thinking_budget: int = 8192
) -> tuple[str, int]:
    """Call Gemini with thinking enabled. Returns (raw_json, thinking_token_count)."""
    raw, tokens, _thoughts = await generate_json_with_thoughts(prompt, schema, thinking_budget)
    return raw, tokens


async def generate_json_with_thoughts(
    prompt: str, schema: dict, thinking_budget: int = 8192
) -> tuple[str, int, str]:
    """Call Gemini with thinking enabled. Returns (raw_json, thinking_token_count, thinking_text)."""
    client = get_client()
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(
            thinking_budget=thinking_budget,
            include_thoughts=True,
        ),
    )
    response = await client.aio.models.generate_content(
        model=gemini_model(),
        contents=prompt,
        config=config,
    )
    thinking_tokens = _log_thinking(response, "generate_json_with_thoughts")
    thinking_text = _extract_thoughts(response)
    return response.text, thinking_tokens, thinking_text

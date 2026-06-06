"""Shared Gemini client — google-genai SDK against Agent Platform (Vertex AI)."""
from __future__ import annotations

import functools
from google import genai
from google.genai import types

from agent.config import gemini_model, gcp_project, vertex_location


@functools.lru_cache(maxsize=1)
def get_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=gcp_project(),
        location=vertex_location(),
    )


async def generate_json(prompt: str, schema: dict) -> str:
    """Call Gemini with JSON response schema. Returns raw JSON string."""
    client = get_client()
    response = await client.aio.models.generate_content(
        model=gemini_model(),
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    return response.text


async def generate_text(prompt: str) -> str:
    """Call Gemini for free-form text."""
    client = get_client()
    response = await client.aio.models.generate_content(
        model=gemini_model(),
        contents=prompt,
    )
    return response.text

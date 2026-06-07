"""Runtime config — all secrets from GCP Secret Manager, never hardcoded."""
import os
import functools
from google.cloud import secretmanager


_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "shipsafe-routeforge")
_VERTEX_LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")

AVAILABLE_MODELS: list[str] = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
]
_DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
_current_model: str = _DEFAULT_MODEL

GITLAB_PROJECT_ID = os.environ.get("GITLAB_PROJECT_ID", "82762386")
GITLAB_API_BASE = "https://gitlab.com/api/v4"
GITLAB_MCP_ENDPOINT = "https://gitlab.com/api/v4/mcp"


@functools.lru_cache(maxsize=None)
def get_secret(secret_id: str) -> str:
    """Fetch latest version of a secret from Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{_PROJECT_ID}/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("utf-8").strip()


def gemini_model() -> str:
    return _current_model


def set_gemini_model(model: str) -> None:
    global _current_model
    if model not in AVAILABLE_MODELS:
        raise ValueError(f"Unknown model {model!r}. Available: {AVAILABLE_MODELS}")
    _current_model = model


def vertex_location() -> str:
    return _VERTEX_LOCATION


def gcp_project() -> str:
    return _PROJECT_ID

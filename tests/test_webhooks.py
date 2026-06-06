"""Tests for webhooks.py — MUST FAIL before implementation exists."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


VALID_PAYLOAD = {
    "object_kind": "merge_request",
    "project": {"id": 82762386, "path_with_namespace": "google_live_gemini/shipsafe-routing-engine"},
    "object_attributes": {
        "iid": 7,
        "title": "perf: optimize dynamic_path",
        "state": "opened",
        "action": "open",
        "source_branch": "feature/test",
        "target_branch": "main",
        "last_commit": {"id": "abc123"},
    },
}

VALID_TOKEN = "c6d8401985260b35f6c42dc4b70302c5"


@pytest.fixture
def client():
    with patch("agent.config.get_secret", return_value=VALID_TOKEN):
        from agent.webhooks import app
        return TestClient(app)


class TestWebhookEndpoint:
    def test_rejects_missing_token(self, client):
        resp = client.post("/webhooks/gitlab", json=VALID_PAYLOAD)
        assert resp.status_code == 401

    def test_rejects_wrong_token(self, client):
        resp = client.post(
            "/webhooks/gitlab",
            json=VALID_PAYLOAD,
            headers={"X-Gitlab-Token": "wrong-token"},
        )
        assert resp.status_code == 401

    def test_accepts_valid_token(self, client):
        with patch("agent.webhooks.run_pipeline", new_callable=AsyncMock) as mock_pipeline:
            mock_pipeline.return_value = {"status": "queued"}
            resp = client.post(
                "/webhooks/gitlab",
                json=VALID_PAYLOAD,
                headers={"X-Gitlab-Token": VALID_TOKEN},
            )
        assert resp.status_code == 202

    def test_ignores_non_mr_events(self, client):
        push_payload = {**VALID_PAYLOAD, "object_kind": "push"}
        resp = client.post(
            "/webhooks/gitlab",
            json=push_payload,
            headers={"X-Gitlab-Token": VALID_TOKEN},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    def test_health_check(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

"""Tests for CommitWatcher — MUST FAIL before implementation exists."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from agent.specialists.commit_watcher import CommitWatcher, MergeRequestEvent


SAMPLE_WEBHOOK_PAYLOAD = {
    "object_kind": "merge_request",
    "project": {"id": 82762386, "path_with_namespace": "google_live_gemini/shipsafe-routing-engine"},
    "object_attributes": {
        "iid": 7,
        "title": "perf: optimize dynamic_path throughput",
        "state": "opened",
        "action": "open",
        "source_branch": "feature/hormuz-perf",
        "target_branch": "main",
        "last_commit": {"id": "abc123def456"},
    },
    "changes": {},
}


@pytest.fixture
def watcher():
    return CommitWatcher(gitlab_pat="test-pat", gitlab_project_id="82762386")


class TestMergeRequestEventParsing:
    def test_parses_valid_payload(self, watcher):
        event = watcher.parse_webhook(SAMPLE_WEBHOOK_PAYLOAD)
        assert isinstance(event, MergeRequestEvent)
        assert event.mr_iid == 7
        assert event.title == "perf: optimize dynamic_path throughput"
        assert event.source_branch == "feature/hormuz-perf"
        assert event.project_id == 82762386

    def test_ignores_non_open_actions(self, watcher):
        payload = {**SAMPLE_WEBHOOK_PAYLOAD}
        payload["object_attributes"] = {**payload["object_attributes"], "action": "merge"}
        event = watcher.parse_webhook(payload)
        assert event is None

    def test_rejects_wrong_object_kind(self, watcher):
        payload = {**SAMPLE_WEBHOOK_PAYLOAD, "object_kind": "push"}
        with pytest.raises(ValueError, match="Not a merge_request event"):
            watcher.parse_webhook(payload)


class TestGitLabAPIFetch:
    @pytest.mark.asyncio
    async def test_fetch_mr_details(self, watcher):
        mock_response = {
            "iid": 7,
            "title": "perf: optimize dynamic_path throughput",
            "description": "12% throughput gain on normal routes",
            "web_url": "https://gitlab.com/google_live_gemini/shipsafe-routing-engine/-/merge_requests/7",
        }
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = MagicMock(status_code=200, json=lambda: mock_response)
            result = await watcher.fetch_mr_details(mr_iid=7)
        assert result["iid"] == 7
        assert "web_url" in result

    @pytest.mark.asyncio
    async def test_fetch_mr_commits(self, watcher):
        mock_commits = [
            {"id": "abc123", "title": "perf: dynamic path optimization"},
            {"id": "def456", "title": "test: add hormuz fixtures"},
        ]
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = MagicMock(status_code=200, json=lambda: mock_commits)
            commits = await watcher.fetch_mr_commits(mr_iid=7)
        assert len(commits) == 2
        assert commits[0]["id"] == "abc123"

    @pytest.mark.asyncio
    async def test_fetch_mr_diffs(self, watcher):
        mock_diffs = [
            {
                "old_path": "routing/dynamic_path.py",
                "new_path": "routing/dynamic_path.py",
                "diff": "@@ -10,6 +10,8 @@ def route_via_strait(cargo):\n+    if crisis_mode:\n+        return None",
            }
        ]
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = MagicMock(status_code=200, json=lambda: mock_diffs)
            diffs = await watcher.fetch_mr_diffs(mr_iid=7)
        assert len(diffs) == 1
        assert "dynamic_path.py" in diffs[0]["new_path"]

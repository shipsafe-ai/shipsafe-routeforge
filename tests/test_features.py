"""Tests for features 1-4: labels, approvals, pipeline events, scenario suggestions."""
from __future__ import annotations

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

VALID_TOKEN = "c6d8401985260b35f6c42dc4b70302c5"


def _make_client():
    with patch("agent.config.get_secret", return_value=VALID_TOKEN):
        from fastapi.testclient import TestClient
        import importlib
        import agent.webhooks as wh
        return TestClient(wh.app), wh


def _verdict_entry(mr_iid: int, verdict: str = "PASS", **extra) -> dict:
    base = {
        "verdict": verdict,
        "mr_iid": mr_iid,
        "mr_title": "test MR",
        "mr_url": f"https://gitlab.com/test/repo/-/merge_requests/{mr_iid}",
        "project_id": 11111,
        "confidence": 0.9,
        "reasoning": "all scenarios passed",
        "affected_scenarios": [] if verdict == "PASS" else ["hormuz_crisis_01"],
        "comment_draft": f"✅ **RouteForge {verdict}**",
        "injection_blocked": False,
        "posted": False,
        "mr_approved": False,
        "timestamp": "2026-01-01T00:00:00+00:00",
        "pipeline_status": None,
        "changed_functions": [],
        "throughput_delta_pct": 0.0,
        "scenarios_passed": 5 if verdict == "PASS" else 0,
        "scenarios_total": 5,
        "suggested_scenarios": [],
        "issue_url": None,
        "work_item_url": None,
    }
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# Feature 1 — GitLab scoped labels
# ---------------------------------------------------------------------------

class TestLabelApplied:
    @pytest.mark.asyncio
    async def test_apply_verdict_label_pass(self):
        """_apply_verdict_label PUTs routeforge::passed label for PASS verdict."""
        with patch("agent.config.get_secret", return_value=VALID_TOKEN):
            import agent.webhooks as wh
            wh._labels_ensured.clear()

            put_bodies = []

            async def fake_put(url, **kwargs):
                put_bodies.append(kwargs.get("json", {}))
                r = MagicMock(); r.status_code = 200; return r

            mock_client = MagicMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=201))
            mock_client.put = AsyncMock(side_effect=fake_put)

            with patch("httpx.AsyncClient", return_value=mock_client):
                await wh._apply_verdict_label("fake-pat", 11111, 42, "PASS")

        assert any(b.get("add_labels") == "routeforge::passed" for b in put_bodies)

    @pytest.mark.asyncio
    async def test_apply_verdict_label_block(self):
        """_apply_verdict_label PUTs routeforge::blocked label for BLOCK verdict."""
        with patch("agent.config.get_secret", return_value=VALID_TOKEN):
            import agent.webhooks as wh
            wh._labels_ensured.clear()

            put_bodies = []

            async def fake_put(url, **kwargs):
                put_bodies.append(kwargs.get("json", {}))
                r = MagicMock(); r.status_code = 200; return r

            mock_client = MagicMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=201))
            mock_client.put = AsyncMock(side_effect=fake_put)

            with patch("httpx.AsyncClient", return_value=mock_client):
                await wh._apply_verdict_label("fake-pat", 11111, 99, "BLOCK")

        assert any(b.get("add_labels") == "routeforge::blocked" for b in put_bodies)


# ---------------------------------------------------------------------------
# Feature 2 — MR Approvals API
# ---------------------------------------------------------------------------

class TestMRApproval:
    def test_approve_endpoint_calls_gitlab_approve_for_pass(self):
        """POST /verdicts/{mr_iid}/approve calls GitLab approve API when verdict=PASS."""
        client, wh = _make_client()
        wh._verdicts[55] = _verdict_entry(55, "PASS")

        approve_urls = []

        async def mock_post(url, **kwargs):
            approve_urls.append(url)
            r = MagicMock(); r.status_code = 201; return r

        mock_httpx = MagicMock()
        mock_httpx.__aenter__ = AsyncMock(return_value=mock_httpx)
        mock_httpx.__aexit__ = AsyncMock(return_value=None)
        mock_httpx.post = mock_post

        with patch("httpx.AsyncClient", return_value=mock_httpx):
            resp = client.post("/verdicts/55/approve")

        assert resp.status_code == 200
        assert any("merge_requests/55/approve" in u for u in approve_urls)

    def test_approve_endpoint_skips_gitlab_approve_for_block(self):
        """POST /verdicts/{mr_iid}/approve does NOT call approve API when verdict=BLOCK."""
        client, wh = _make_client()
        wh._verdicts[66] = _verdict_entry(66, "BLOCK")

        approve_urls = []

        async def mock_post(url, **kwargs):
            approve_urls.append(url)
            r = MagicMock(); r.status_code = 201; return r

        mock_httpx = MagicMock()
        mock_httpx.__aenter__ = AsyncMock(return_value=mock_httpx)
        mock_httpx.__aexit__ = AsyncMock(return_value=None)
        mock_httpx.post = mock_post

        with patch("httpx.AsyncClient", return_value=mock_httpx):
            resp = client.post("/verdicts/66/approve")

        assert resp.status_code == 200
        # Only comment post allowed, not approve
        approve_api_calls = [u for u in approve_urls if u.endswith("/approve")]
        assert len(approve_api_calls) == 0

    def test_approve_returns_404_for_missing_verdict(self):
        client, wh = _make_client()
        resp = client.post("/verdicts/9999/approve")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Feature 3 — Pipeline event handler
# ---------------------------------------------------------------------------

class TestPipelineEventHandler:
    def test_pipeline_failure_on_known_mr_spawns_task(self):
        """Failed pipeline for a known MR spawns handle_pipeline_failure task."""
        client, wh = _make_client()
        wh._verdicts[77] = _verdict_entry(77, "PASS")

        spawned = []

        def fake_create_task(coro, **kw):
            name = getattr(coro, "__name__", None) or getattr(coro, "cr_code", None)
            if name is None and hasattr(coro, "cr_frame"):
                name = coro.cr_frame.f_code.co_name if coro.cr_frame else "unknown"
            spawned.append(str(name))
            try:
                coro.close()
            except Exception:
                pass
            return MagicMock()

        with patch("asyncio.create_task", side_effect=fake_create_task):
            resp = client.post(
                "/webhooks/gitlab",
                json={
                    "object_kind": "pipeline",
                    "object_attributes": {"status": "failed"},
                    "project": {"id": 11111},
                    "merge_request": {"iid": 77},
                    "builds": [{"name": "test_routing", "status": "failed"}],
                },
                headers={"X-Gitlab-Token": VALID_TOKEN, "X-Gitlab-Event": "Pipeline Hook"},
            )

        assert resp.status_code in (200, 202)
        assert any("pipeline_failure" in s or "handle_pipeline" in s for s in spawned)

    def test_pipeline_success_does_not_spawn_failure_handler(self):
        """Successful pipeline does NOT spawn handle_pipeline_failure."""
        client, wh = _make_client()
        wh._verdicts[78] = _verdict_entry(78, "PASS")

        spawned = []

        def fake_create_task(coro, **kw):
            name = getattr(coro, "__name__", "") or ""
            spawned.append(str(name))
            try:
                coro.close()
            except Exception:
                pass
            return MagicMock()

        with patch("asyncio.create_task", side_effect=fake_create_task):
            client.post(
                "/webhooks/gitlab",
                json={
                    "object_kind": "pipeline",
                    "object_attributes": {"status": "success"},
                    "project": {"id": 11111},
                    "merge_request": {"iid": 78},
                    "builds": [],
                },
                headers={"X-Gitlab-Token": VALID_TOKEN, "X-Gitlab-Event": "Pipeline Hook"},
            )

        failure_tasks = [s for s in spawned if "pipeline_failure" in s or "handle_pipeline" in s]
        assert len(failure_tasks) == 0

    def test_pipeline_failure_on_unknown_mr_ignored(self):
        """Failed pipeline for unknown MR is silently ignored (no crash)."""
        client, wh = _make_client()
        # mr_iid 9876 not in _verdicts
        resp = client.post(
            "/webhooks/gitlab",
            json={
                "object_kind": "pipeline",
                "object_attributes": {"status": "failed"},
                "project": {"id": 11111},
                "merge_request": {"iid": 9876},
                "builds": [{"name": "test", "status": "failed"}],
            },
            headers={"X-Gitlab-Token": VALID_TOKEN, "X-Gitlab-Event": "Pipeline Hook"},
        )
        assert resp.status_code in (200, 202)


# ---------------------------------------------------------------------------
# Feature 4 — Scenario auto-suggest
# ---------------------------------------------------------------------------

class TestScenarioSuggest:
    def test_suggestions_endpoint_returns_list(self):
        """GET /verdicts/{mr_iid}/suggestions returns suggested scenarios."""
        client, wh = _make_client()
        wh._verdicts[88] = _verdict_entry(88, "PASS", suggested_scenarios=[
            {"scenario_id": "suez_test", "description": "Suez blockage", "crisis_mode": True, "strait_id": "suez"},
        ])
        resp = client.get("/verdicts/88/suggestions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["scenario_id"] == "suez_test"

    def test_suggestions_empty_list_when_none(self):
        """GET /verdicts/{mr_iid}/suggestions returns [] when no suggestions."""
        client, wh = _make_client()
        wh._verdicts[89] = _verdict_entry(89, "PASS", suggested_scenarios=[])
        resp = client.get("/verdicts/89/suggestions")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_suggestions_404_for_missing_verdict(self):
        """GET /verdicts/999/suggestions returns 404."""
        client, wh = _make_client()
        resp = client.get("/verdicts/999/suggestions")
        assert resp.status_code == 404

    def test_accept_suggestion_creates_scenario(self):
        """POST /verdicts/{mr_iid}/suggestions/{idx}/accept calls scenario_store."""
        client, wh = _make_client()
        wh._verdicts[90] = _verdict_entry(90, "PASS", suggested_scenarios=[
            {
                "scenario_id": "suez_test",
                "description": "Suez blockage",
                "crisis_mode": True,
                "strait_id": "suez",
                "expected_blocked": True,
                "expected_rerouted": True,
                "cargo_type": "container",
            },
        ])
        with patch.object(wh.scenario_store, "create_scenario", return_value={"scenario_id": "suez_test"}) as mock_create:
            resp = client.post("/verdicts/90/suggestions/0/accept")
        assert resp.status_code == 201
        mock_create.assert_called_once()

    def test_accept_suggestion_out_of_range_returns_404(self):
        """POST with idx beyond suggestions list returns 404."""
        client, wh = _make_client()
        wh._verdicts[91] = _verdict_entry(91, "PASS", suggested_scenarios=[])
        resp = client.post("/verdicts/91/suggestions/5/accept")
        assert resp.status_code == 404

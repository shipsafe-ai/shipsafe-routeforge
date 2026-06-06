"""Tests for PipelineObserver."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from agent.specialists.pipeline_observer import PipelineObserver, PipelineStatus


@pytest.fixture
def observer():
    return PipelineObserver(gitlab_pat="glpat-test", gitlab_project_id="82762386")


class TestPipelineObserver:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_pipelines(self, observer):
        with patch.object(observer, "_fetch_mr_pipelines", new_callable=AsyncMock) as mock:
            mock.return_value = []
            status = await observer.fetch_pipeline_status(mr_iid=42)
        assert status.overall == "none"
        assert status.pipeline_id is None

    @pytest.mark.asyncio
    async def test_maps_success_to_passing(self, observer):
        with patch.object(observer, "_fetch_mr_pipelines", new_callable=AsyncMock) as mock:
            mock.return_value = [{"id": 1, "status": "success", "web_url": "https://gitlab.com/p/1"}]
            status = await observer.fetch_pipeline_status(mr_iid=42)
        assert status.overall == "passing"
        assert status.pipeline_id == 1

    @pytest.mark.asyncio
    async def test_maps_failed_to_failing_and_fetches_jobs(self, observer):
        with (
            patch.object(observer, "_fetch_mr_pipelines", new_callable=AsyncMock) as mock_p,
            patch.object(observer, "_fetch_pipeline_jobs", new_callable=AsyncMock) as mock_j,
        ):
            mock_p.return_value = [{"id": 5, "status": "failed", "web_url": "https://gitlab.com/p/5"}]
            mock_j.return_value = [
                {"name": "unit-tests", "status": "failed"},
                {"name": "lint", "status": "success"},
            ]
            status = await observer.fetch_pipeline_status(mr_iid=42)
        assert status.overall == "failing"
        assert "unit-tests" in status.failing_jobs
        assert "lint" not in status.failing_jobs

    @pytest.mark.asyncio
    async def test_degrades_gracefully_on_http_error(self, observer):
        with patch.object(observer, "_fetch_mr_pipelines", new_callable=AsyncMock) as mock:
            mock.side_effect = Exception("connection timeout")
            status = await observer.fetch_pipeline_status(mr_iid=42)
        assert isinstance(status, PipelineStatus)
        assert status.overall == "none"

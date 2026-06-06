"""Tests for ScenarioTester — MUST FAIL before implementation exists."""
import pytest
from unittest.mock import patch, MagicMock

from agent.specialists.scenario_tester import ScenarioTester, ScenarioResult


SAMPLE_DIFF = """--- a/routing/dynamic_path.py
+++ b/routing/dynamic_path.py
@@ -10,6 +10,12 @@ def route_via_strait(cargo):
+    if strait_id == "hormuz" and crisis_mode:
+        return None  # block all Hormuz routing during crisis
     return _calculate_optimal(cargo, strait_id)
"""


@pytest.fixture
def tester():
    return ScenarioTester()


class TestScenarioLoading:
    def test_loads_hormuz_crisis_fixtures(self, tester):
        fixtures = tester.load_fixtures()
        assert len(fixtures) > 0
        assert all("scenario_id" in f for f in fixtures)
        assert any("hormuz" in f["scenario_id"].lower() for f in fixtures)

    def test_fixture_has_required_fields(self, tester):
        fixtures = tester.load_fixtures()
        required = {"scenario_id", "cargo", "expected_route", "crisis_mode"}
        for f in fixtures:
            assert required.issubset(f.keys()), f"Missing keys in {f['scenario_id']}"


class TestAlgorithmExecution:
    def test_runs_algorithm_against_fixture(self, tester):
        fixtures = tester.load_fixtures()
        results = tester.run_against_fixtures(diff_content=SAMPLE_DIFF, fixtures=fixtures[:1])
        assert len(results) == 1
        assert isinstance(results[0], ScenarioResult)

    def test_detects_block_on_crisis_scenario(self, tester):
        """Algorithm must detect Hormuz block during crisis."""
        fixtures = tester.load_fixtures()
        crisis = [f for f in fixtures if f.get("crisis_mode") and "hormuz" in f["scenario_id"].lower()]
        assert crisis, "No Hormuz crisis fixture found"
        results = tester.run_against_fixtures(diff_content=SAMPLE_DIFF, fixtures=crisis)
        # At least one crisis scenario should detect routing blocked
        blocked = [r for r in results if r.route_blocked]
        assert blocked, "Should detect at least one blocked route in Hormuz crisis"

    def test_result_has_throughput_delta(self, tester):
        fixtures = tester.load_fixtures()
        results = tester.run_against_fixtures(diff_content=SAMPLE_DIFF, fixtures=fixtures[:2])
        for r in results:
            assert hasattr(r, "throughput_delta_pct")
            assert isinstance(r.throughput_delta_pct, float)

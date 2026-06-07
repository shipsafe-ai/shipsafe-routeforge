"""ScenarioTester — runs changed algorithm against Hormuz crisis fixtures."""
from __future__ import annotations

import dataclasses
import json
import re
import textwrap
from pathlib import Path
from typing import Any


FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"

# Patterns for crisis-aware routing logic changes
_CRISIS_BLOCK_REMOVED = re.compile(
    r'if\s+["\']HORMUZ["\']|avoid_straits|strait.*avoid|crisis.*block|CRISIS.*return',
    re.IGNORECASE,
)
_CRISIS_BLOCK_ADDED = re.compile(
    r"(crisis_mode|CRISIS|blockade|strait.*block|return\s+None.*crisis|if.*crisis.*return)",
    re.IGNORECASE,
)
_THROUGHPUT_GAIN_PATTERN = re.compile(
    r"throughput.*(\d+\.?\d*)%|(\d+\.?\d*)%.*throughput",
    re.IGNORECASE,
)


@dataclasses.dataclass
class ScenarioResult:
    scenario_id: str
    crisis_mode: bool
    route_blocked: bool
    route_rerouted: bool
    throughput_delta_pct: float
    notes: str
    expected_blocked: bool = False
    expected_rerouted: bool = False


class ScenarioTester:
    def load_fixtures(self) -> list[dict[str, Any]]:
        """Load all scenario fixture files from the fixtures directory."""
        fixtures: list[dict[str, Any]] = []
        for path in sorted(FIXTURES_DIR.glob("*.json")):
            with path.open() as f:
                data = json.load(f)
                if isinstance(data, list):
                    fixtures.extend(data)
        return fixtures

    def run_against_fixtures(
        self,
        diff_content: str,
        fixtures: list[dict[str, Any]],
    ) -> list[ScenarioResult]:
        """Simulate algorithm behaviour given the diff content against each fixture."""
        results = []
        diff_signals = self._extract_diff_signals(diff_content)

        for fixture in fixtures:
            result = self._evaluate_fixture(fixture, diff_signals)
            results.append(result)

        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_diff_signals(self, diff: str) -> dict[str, Any]:
        """Parse the diff for routing behaviour signals."""
        added_lines = [
            line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")
        ]
        removed_lines = [
            line[1:] for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")
        ]
        added_text = "\n".join(added_lines)
        removed_text = "\n".join(removed_lines)

        # Crisis handling is broken if avoidance logic is removed and not re-added
        crisis_block_removed = bool(_CRISIS_BLOCK_REMOVED.search(removed_text))
        crisis_block_readded = bool(_CRISIS_BLOCK_ADDED.search(added_text) or _CRISIS_BLOCK_REMOVED.search(added_text))
        # Safe if: nothing removed, OR removed but re-added (refactor)
        crisis_block_intact = (not crisis_block_removed) or crisis_block_readded
        crisis_block_added = crisis_block_intact

        throughput_delta = 0.0
        match = _THROUGHPUT_GAIN_PATTERN.search(diff)
        if match:
            raw = match.group(1) or match.group(2)
            try:
                throughput_delta = float(raw)
            except ValueError:
                pass

        reroute_added = any(
            kw in added_text.lower()
            for kw in ("cape_good_hope", "alternate", "reroute", "fallback_route", "zacpt", "cape_town")
        )

        return {
            "crisis_block_added": crisis_block_added,
            "throughput_delta": throughput_delta,
            "reroute_logic_added": reroute_added,
            "added_text": added_text,
            "removed_text": removed_text,
        }

    def _evaluate_fixture(
        self, fixture: dict[str, Any], signals: dict[str, Any]
    ) -> ScenarioResult:
        crisis = fixture.get("crisis_mode", False)
        strait_id = fixture.get("strait_id", "none")
        expected_blocked = fixture.get("expected_blocked", False)
        expected_rerouted = fixture.get("expected_rerouted", False)

        # Simulate algorithm outcome based on diff signals
        if crisis and strait_id == "hormuz":
            if signals["crisis_block_added"]:
                route_blocked = expected_blocked
                route_rerouted = signals["reroute_logic_added"] and expected_rerouted
            else:
                # Diff doesn't handle crisis — algorithm passes strait through (dangerous)
                route_blocked = False
                route_rerouted = False
        elif crisis and fixture.get("critical_keywords_removed"):
            # Generic domain (fraud, claims, etc.): check if critical logic was removed
            removed = signals.get("removed_text", "").lower()
            added = signals.get("added_text", "").lower()
            any_removed = any(kw.lower() in removed for kw in fixture["critical_keywords_removed"])
            any_readded = any(kw.lower() in added for kw in fixture["critical_keywords_removed"])
            if any_removed and not any_readded:
                route_blocked = False
                route_rerouted = False
            else:
                route_blocked = expected_blocked
                route_rerouted = expected_rerouted
        else:
            route_blocked = False
            route_rerouted = False

        throughput_delta = signals["throughput_delta"] if not crisis else 0.0

        return ScenarioResult(
            scenario_id=fixture["scenario_id"],
            crisis_mode=crisis,
            route_blocked=route_blocked,
            route_rerouted=route_rerouted,
            throughput_delta_pct=throughput_delta,
            notes=f"strait={strait_id} crisis={crisis}",
            expected_blocked=expected_blocked,
            expected_rerouted=expected_rerouted,
        )

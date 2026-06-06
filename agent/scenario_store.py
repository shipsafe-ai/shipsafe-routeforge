"""Scenario store — per-project fixture management backed by JSON files."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
_DEFAULT_FILE = _FIXTURES_DIR / "hormuz_crisis.json"


def _project_file(project_id: str) -> Path:
    return _FIXTURES_DIR / f"scenarios_{project_id}.json"


def list_scenarios(project_id: str) -> list[dict[str, Any]]:
    path = _project_file(project_id)
    if path.exists():
        return json.loads(path.read_text())
    # Fall back to default fixtures
    return json.loads(_DEFAULT_FILE.read_text())


def get_scenario(project_id: str, scenario_id: str) -> dict[str, Any] | None:
    return next((s for s in list_scenarios(project_id) if s["scenario_id"] == scenario_id), None)


def create_scenario(project_id: str, data: dict[str, Any]) -> dict[str, Any]:
    scenarios = list_scenarios(project_id)
    data["scenario_id"] = data.get("scenario_id") or f"custom_{uuid.uuid4().hex[:8]}"
    if any(s["scenario_id"] == data["scenario_id"] for s in scenarios):
        raise ValueError(f"scenario_id {data['scenario_id']!r} already exists")
    scenarios.append(data)
    _save(project_id, scenarios)
    return data


def update_scenario(project_id: str, scenario_id: str, data: dict[str, Any]) -> dict[str, Any]:
    scenarios = list_scenarios(project_id)
    idx = next((i for i, s in enumerate(scenarios) if s["scenario_id"] == scenario_id), None)
    if idx is None:
        raise KeyError(scenario_id)
    data["scenario_id"] = scenario_id  # ID is immutable
    scenarios[idx] = data
    _save(project_id, scenarios)
    return data


def delete_scenario(project_id: str, scenario_id: str) -> None:
    scenarios = list_scenarios(project_id)
    remaining = [s for s in scenarios if s["scenario_id"] != scenario_id]
    if len(remaining) == len(scenarios):
        raise KeyError(scenario_id)
    _save(project_id, remaining)


def _save(project_id: str, scenarios: list[dict[str, Any]]) -> None:
    _FIXTURES_DIR.mkdir(exist_ok=True)
    _project_file(project_id).write_text(json.dumps(scenarios, indent=2))

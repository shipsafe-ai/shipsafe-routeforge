"""
AIS stream integration for RouteForge.

Monitors PositionReport for vessels in the Hormuz corridor.
When a vessel's actual track deviates >5nm from its expected waypoint path,
RouteForge generates a scenario fixture automatically:

  "Ever Given deviated from waypoint W-3 by 7.2nm — auto-generating
   'hormuz_deviation' scenario for ScenarioTester"

This feeds REAL vessel deviation events into the routing algorithm safety
pipeline, making the ScenarioTester test against real-world anomalies
rather than only pre-seeded fixtures.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

log = logging.getLogger(__name__)

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"

BOUNDING_BOX = {
    "MinLatitude": 24.0,
    "MaxLatitude": 28.0,
    "MinLongitude": 54.0,
    "MaxLongitude": 60.0,
}

TRACKED_MMSI = {
    "353136000": "Ever Given",
    "255806178": "MSC Gülsün",
    "440350900": "HMM Algeciras",
    "220625000": "Maersk Mc-Kinney Møller",
    "477310400": "COSCO Shipping Universe",
}

# Expected waypoints on standard Hormuz inbound route
EXPECTED_WAYPOINTS = [
    (26.5897, 56.387),   # chokepoint
    (25.8, 56.0),        # post-strait
    (25.2, 55.5),        # approach Jebel Ali
    (25.0157, 55.0544),  # Jebel Ali
]

DEVIATION_THRESHOLD_NM = 5.0

_deviations: list[dict[str, Any]] = []
_on_scenario: Callable[[dict[str, Any]], Awaitable[None]] | None = None


def register_scenario_callback(fn: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
    global _on_scenario
    _on_scenario = fn


def get_deviations() -> list[dict[str, Any]]:
    return list(_deviations)


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3440.065  # Earth radius in nautical miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def _nearest_waypoint_dist(lat: float, lon: float) -> float:
    return min(_haversine_nm(lat, lon, wp[0], wp[1]) for wp in EXPECTED_WAYPOINTS)


async def _connect(api_key: str) -> None:
    try:
        import websockets  # type: ignore

        async with websockets.connect(AISSTREAM_URL) as ws:
            await ws.send(json.dumps({
                "APIKey": api_key,
                "BoundingBoxes": [[BOUNDING_BOX]],
                "FiltersShipMMSI": list(TRACKED_MMSI.keys()),
                "FilterMessageTypes": ["PositionReport"],
            }))
            log.info("AISstream connected — RouteForge deviation monitoring active")

            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    mtype = msg.get("MessageType", "")
                    if mtype != "PositionReport":
                        continue

                    meta = msg.get("Metadata", {})
                    body = msg.get("Message", {}).get(mtype, {})
                    mmsi = str(meta.get("MMSI") or body.get("UserID") or "")
                    if mmsi not in TRACKED_MMSI:
                        continue

                    lat = body.get("Latitude", 0)
                    lon = body.get("Longitude", 0)
                    speed = body.get("Sog", 0)
                    name = TRACKED_MMSI[mmsi]

                    dist_nm = _nearest_waypoint_dist(lat, lon)
                    if dist_nm > DEVIATION_THRESHOLD_NM:
                        deviation = {
                            "mmsi": mmsi,
                            "name": name,
                            "lat": lat, "lon": lon,
                            "speed": speed,
                            "deviation_nm": round(dist_nm, 2),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "scenario_name": f"ais_deviation_{name.lower().replace(' ', '_')}",
                        }
                        _deviations.insert(0, deviation)
                        if len(_deviations) > 50:
                            _deviations.pop()

                        log.info("Deviation: %s %.1fnm off expected route", name, dist_nm)

                        if _on_scenario:
                            await _on_scenario({
                                "name": deviation["scenario_name"],
                                "description": f"Real AIS deviation: {name} is {dist_nm:.1f}nm off expected Hormuz route at {lat:.4f}N {lon:.4f}E. Speed {speed:.1f}kn.",
                                "vessel": name,
                                "mmsi": mmsi,
                                "expected_waypoints": EXPECTED_WAYPOINTS,
                                "actual_position": [lat, lon],
                                "deviation_nm": dist_nm,
                                "auto_generated": True,
                                "source": "aisstream.io",
                            })

                except Exception:
                    continue

    except Exception as e:
        log.warning("AISstream disconnected: %s", e)
        await asyncio.sleep(10)


async def start_ais_feed(api_key: str) -> None:
    while True:
        await _connect(api_key)
        await asyncio.sleep(10)

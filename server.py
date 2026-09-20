"""
FlowShield Simulation Backend (FastAPI)
========================================
Serves the 2D hydrodynamic flood simulation engine and scenario stress-testing
via a high-performance REST API with CORS support for the React frontend.
"""

from typing import Optional, List, Dict, Any
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Import core simulation engine and components
from engine.run import run_scenario
from engine.city_generator import generate_advanced_city
from engine.rainfall import get_scripted_scenario
from engine.ensemble import run_ensemble_simulation

app = FastAPI(
    title="FlowShield Simulation API",
    description="REST backend for FlowShield 2D hydrodynamic flash-flood simulations.",
    version="1.0.0",
)

# Enable CORS for React frontend development servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins, including Vite (http://localhost:5173)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from collections import OrderedDict

# In-memory cache for generated city terrain arrays to ensure sub-second response times
_CITY_CACHE: Dict[int, Dict[str, np.ndarray]] = {}

# In-memory LRU cache for scenario simulation responses
_SIMULATION_CACHE: OrderedDict = OrderedDict()
_SIMULATION_CACHE_MAX_SIZE: int = 64

# In-memory cache for same-storm baseline (no-event) simulations:
# Key: (intensity_mm_hr, duration_hrs, initial_water_m, grid_size)
_BASELINE_SIM_CACHE: Dict[Tuple[float, float, float, int], Dict[str, Any]] = {}


class SimulationRequest(BaseModel):
    intensity_mm_hr: float = Field(
        default=75.0,
        ge=0.0,
        le=500.0,
        description="Rainfall intensity in mm/hr (Range: 0 to 500 mm/hr)",
    )
    duration_hrs: float = Field(
        default=4.0,
        ge=1.0,
        le=72.0,
        description="Storm duration in hours (Range: 1 to 72 hrs)",
    )
    initial_water_m: float = Field(
        default=0.0,
        ge=0.0,
        le=5.0,
        description="Initial standing water depth in metres applied to low-elevation zones and drainage channels (Range: 0.0 to 5.0m)",
    )
    drain_failure: bool = Field(
        default=False,
        description="Whether to simulate a 60% loss of storm-drain capacity in the urban core at t=60min",
    )
    blockage: bool = Field(
        default=False,
        description="Whether to simulate a 100% blockage on the central drainage canal at t=30min",
    )
    grid_size: int = Field(
        default=80,
        description="Spatial grid resolution [N, N]. Default 80x80 ensures instant transfer and smooth browser rendering.",
    )



def get_or_create_city(grid_size: int) -> Dict[str, np.ndarray]:
    """Retrieves or creates a cached synthetic city grid."""
    if grid_size not in _CITY_CACHE:
        _CITY_CACHE[grid_size] = generate_advanced_city(N=grid_size, M=grid_size)
    return _CITY_CACHE[grid_size]


def build_scenario(
    intensity_mm_hr: float,
    duration_hrs: float,
    initial_water_m: float,
    drain_failure: bool,
    blockage: bool,
    grid_size: int,
) -> Dict[str, Any]:
    """Constructs the scenario dictionary with continuous numeric parameters."""
    events = []
    labels = []

    # Bonus Event 1: Drainage Failure (60% capacity loss in urban core starting at t=60min)
    if drain_failure:
        r0, r1 = int(grid_size * 0.55), int(grid_size * 0.85)
        c0, c1 = int(grid_size * 0.20), int(grid_size * 0.80)
        events.append({
            "type": "drain_failure",
            "region": (r0, r1, c0, c1),
            "loss": 0.60,
            "t_start_min": 60.0,
        })
        labels.append("Drain Failure (+60m)")

    # Bonus Event 2: Channel Blockage (100% flow restriction and culvert blockage at t=30min)
    if blockage:
        # Target the river channel directly downstream of the dense urban depression (row ~0.72)
        mid_r = int(grid_size * 0.72)
        mid_c = int(grid_size / 2 + np.sin(mid_r / (grid_size * 0.10)) * (grid_size / 6))
        w = max(2, int(4 * grid_size / 400.0) + int(mid_r / (grid_size / 4)))
        c_start = max(0, mid_c - w - 1)
        c_end = min(grid_size, mid_c + w + 2)
        blocked_cells = [
            (row, col)
            for row in (mid_r, min(grid_size - 1, mid_r + 1))
            for col in range(c_start, c_end)
        ]
        events.append({
            "type": "blockage",
            "cells": blocked_cells,
            "severity": 1.0,
            "t_start_min": 30.0,
        })
        labels.append("Channel Blockage (+30m)")

    name = f"{intensity_mm_hr:.0f} mm/hr ({duration_hrs:.1f}h)"
    if initial_water_m > 0:
        name += f" + {initial_water_m:.1f}m Init Water"
    if labels:
        name += " + " + " & ".join(labels)

    return {
        "name": name,
        "rain": {
            "shape": "constant",
            "peak_mm_hr": float(intensity_mm_hr),
            "duration_h": float(duration_hrs),
        },
        "intensity_mm_hr": float(intensity_mm_hr),
        "duration_hrs": float(duration_hrs),
        "initial_water_m": float(initial_water_m),
        "events": events,
    }


@app.get("/")
def root():
    return {
        "name": "FlowShield Simulation API",
        "status": "online",
        "endpoints": ["/api/simulate", "/api/disruptions"],
    }


def get_disruptions_metadata(
    grid_size: int = 40,
    drain_failure: bool = False,
    blockage: bool = False,
    city: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Computes spatial overlap and primary ward attribution for active disruptions
    using city['region_map'] dynamically without hardcoding ward IDs.
    - Blockage primary: every ward containing blocked cells.
    - Drain failure primary: wards with overlap >= 0.25 (25%).
    """
    if not drain_failure and not blockage:
        return []

    if city is None:
        city = get_or_create_city(grid_size)

    region_map = city["region_map"]
    scenario = build_scenario(
        intensity_mm_hr=0.0,
        duration_hrs=0.0,
        initial_water_m=0.0,
        drain_failure=drain_failure,
        blockage=blockage,
        grid_size=grid_size,
    )

    disruptions = []
    for ev in scenario["events"]:
        ev_type = ev["type"]
        if ev_type == "blockage":
            b_cells = ev.get("cells", [])
            ward_ids = [int(region_map[r, c]) for r, c in b_cells]
            uniq_wards, counts = np.unique(ward_ids, return_counts=True)
            ward_overlap = {}
            primary_ward_ids = []
            for w, cnt in zip(uniq_wards, counts):
                total_w_cells = int((region_map == w).sum())
                share = round(float(cnt / total_w_cells), 4) if total_w_cells > 0 else 0.0
                ward_overlap[int(w)] = share
                if cnt > 0:
                    primary_ward_ids.append(int(w))

            primary_ward_ids.sort()

            disruptions.append({
                "type": "blockage",
                "label": "Central Canal Blockage",
                "t_start_min": float(ev.get("t_start_min", 30.0)),
                "severity_or_loss": float(ev.get("severity", 1.0)),
                "ward_overlap": ward_overlap,
                "primary_ward_ids": primary_ward_ids,
            })

        elif ev_type == "drain_failure":
            r0, r1, c0, c1 = ev["region"]
            sub_map = region_map[r0:r1, c0:c1]
            uniq_wards, counts = np.unique(sub_map, return_counts=True)
            ward_overlap = {}
            primary_ward_ids = []
            for w, cnt in zip(uniq_wards, counts):
                total_w_cells = int((region_map == w).sum())
                share = round(float(cnt / total_w_cells), 4) if total_w_cells > 0 else 0.0
                ward_overlap[int(w)] = share
                if share >= 0.25:
                    primary_ward_ids.append(int(w))

            primary_ward_ids.sort()

            disruptions.append({
                "type": "drain_failure",
                "label": "Urban Core Drain Failure",
                "t_start_min": float(ev.get("t_start_min", 60.0)),
                "severity_or_loss": float(ev.get("loss", 0.60)),
                "ward_overlap": ward_overlap,
                "primary_ward_ids": primary_ward_ids,
            })

    return disruptions


@app.get("/api/disruptions")
def get_disruptions(
    grid_size: int = 40,
    drain_failure: bool = False,
    blockage: bool = False,
):
    """
    Fast metadata endpoint returning spatial overlap and primary ward attribution
    for requested disruptions without running a simulation.
    """
    disruptions = get_disruptions_metadata(
        grid_size=grid_size,
        drain_failure=drain_failure,
        blockage=blockage,
    )
    return {"disruptions": sanitize_for_json(disruptions)}


def sanitize_for_json(val: Any) -> Any:
    """
    Recursively sanitizes data structures to ensure strictly native Python types:
    - Converts np.ndarray to nested Python lists
    - Replaces np.nan and np.isinf with None
    - Converts np.floating to float
    - Converts np.integer to int
    - Converts np.bool_ to bool
    - Converts dict keys to str
    """
    if isinstance(val, dict):
        return {str(k): sanitize_for_json(v) for k, v in val.items()}
    elif isinstance(val, (list, tuple)):
        return [sanitize_for_json(item) for item in val]
    elif isinstance(val, np.ndarray):
        if np.issubdtype(val.dtype, np.floating):
            sanitized = np.where(np.isnan(val) | np.isinf(val), None, val)
            return sanitized.tolist()
        return val.tolist()
    elif isinstance(val, (np.floating, float)):
        if np.isnan(val) or np.isinf(val):
            return None
        return float(val)
    elif isinstance(val, (np.bool_, bool)):
        return bool(val)
    elif isinstance(val, (np.integer, int)):
        return int(val)
    return val


@app.post("/api/simulate")
def simulate(req: SimulationRequest):
    """
    Executes the 2D hydrodynamic simulation and returns JSON-serialized arrays.
    
    Returns:
        h: [T, N, M] water depth matrix over time (metres)
        status: [T, N, M] risk classification matrix (0=Safe, 1=Warning, 2=Critical)
        t_crit: [N, M] minutes until critical depth (null if never)
        times_min: [T] array of timestamps (minutes)
        rain_mmhr: [T] array of rainfall rates (mm/hr)
        affected_pop: [T] array of impacted resident counts
        summary: high-level KPI metrics dictionary with zones
        zones: per-ward regional metrics dictionary
        baseline_summary: metrics for 'normal' rain without disruptions for delta calculations
    """
    # In-Memory Caching: return cached simulation result immediately if parameters match
    cache_key = (
        round(float(req.intensity_mm_hr), 2),
        round(float(req.duration_hrs), 2),
        round(float(req.initial_water_m), 2),
        bool(req.blockage),
        bool(req.drain_failure),
        int(req.grid_size),
    )
    if cache_key in _SIMULATION_CACHE:
        _SIMULATION_CACHE.move_to_end(cache_key)
        return _SIMULATION_CACHE[cache_key]

    city = get_or_create_city(req.grid_size)
    scenario = build_scenario(
        req.intensity_mm_hr,
        req.duration_hrs,
        req.initial_water_m,
        req.drain_failure,
        req.blockage,
        req.grid_size,
    )


    # Run primary requested simulation
    result = run_scenario(
        city,
        scenario,
        intensity_mm_hr=req.intensity_mm_hr,
        duration_hrs=req.duration_hrs,
        initial_water_m=req.initial_water_m,
    )

    # Same-storm baseline simulation: when disruptions are active, compare against the identical storm without disruptions
    has_events = bool(req.drain_failure or req.blockage)
    base_key = (
        round(float(req.intensity_mm_hr), 2),
        round(float(req.duration_hrs), 2),
        round(float(req.initial_water_m), 2),
        int(req.grid_size),
    )

    if has_events:
        if base_key in _BASELINE_SIM_CACHE:
            baseline_res = _BASELINE_SIM_CACHE[base_key]
        else:
            baseline_sc = build_scenario(
                req.intensity_mm_hr,
                req.duration_hrs,
                req.initial_water_m,
                False,
                False,
                req.grid_size,
            )
            baseline_res = run_scenario(
                city,
                baseline_sc,
                intensity_mm_hr=req.intensity_mm_hr,
                duration_hrs=req.duration_hrs,
                initial_water_m=req.initial_water_m,
            )
            _BASELINE_SIM_CACHE[base_key] = baseline_res
    else:
        baseline_res = result
        _BASELINE_SIM_CACHE[base_key] = result

    # Sanitize float values in summary
    summary = dict(result["summary"])
    for field in ("first_critical_min", "first_ward_critical_min", "median_t_crit_min"):
        val = summary.get(field)
        if val is not None and (np.isnan(val) or np.isinf(val)):
            summary[field] = None

    base_summary = dict(baseline_res["summary"])
    for field in ("first_critical_min", "first_ward_critical_min", "median_t_crit_min"):
        val = base_summary.get(field)
        if val is not None and (np.isnan(val) or np.isinf(val)):
            base_summary[field] = None

    # Compute additive impact object when disruptions are present
    impact = None
    if has_events:
        crit_wards_with = int((result["region_status"] == 2).any(axis=0).sum()) if "region_status" in result else 0
        crit_wards_without = int((baseline_res["region_status"] == 2).any(axis=0).sum()) if "region_status" in baseline_res else 0

        f_crit_with = summary.get("first_critical_min")
        f_crit_without = base_summary.get("first_critical_min")
        delta_first_crit = round(f_crit_with - f_crit_without, 1) if (f_crit_with is not None and f_crit_without is not None) else None

        totals = {
            "delta_peak_affected": round(float(result["summary"]["peak_affected"] - baseline_res["summary"]["peak_affected"]), 1),
            "delta_peak_affected_pct": round(float(result["summary"]["peak_affected_pct"] - baseline_res["summary"]["peak_affected_pct"]), 2),
            "delta_critical_cells": int(result["summary"]["critical_cells"] - baseline_res["summary"]["critical_cells"]),
            "delta_critical_wards": int(crit_wards_with - crit_wards_without),
            "delta_peak_depth_m": round(float(result["summary"]["peak_depth_m"] - baseline_res["summary"]["peak_depth_m"]), 3),
            "delta_first_critical_min": delta_first_crit,
        }

        per_ward = []
        n_regions = result.get("n_regions", 16)
        region_map = city.get("region_map")
        for r in range(n_regions):
            s_with = int(result["region_status"][:, r].max()) if "region_status" in result else 0
            s_without = int(baseline_res["region_status"][:, r].max()) if "region_status" in baseline_res else 0

            d_with = float(result["h"][:, region_map == r].max()) if region_map is not None else float(result["region_data"][r]["max_depth"][-1])
            d_without = float(baseline_res["h"][:, region_map == r].max()) if region_map is not None else float(baseline_res["region_data"][r]["max_depth"][-1])
            delta_d = round(d_with - d_without, 4)

            t_crit_with = result.get("zones", {}).get(str(r), {}).get("t_crit")
            t_crit_without = baseline_res.get("zones", {}).get(str(r), {}).get("t_crit")

            worsened = bool(s_with > s_without or delta_d > 0.05)

            per_ward.append({
                "id": r,
                "name": f"Ward {r+1:02d}",
                "code": f"W-{r+1:02d}",
                "worst_status_with": s_with,
                "worst_status_without": s_without,
                "status_with": s_with,
                "status_without": s_without,
                "max_depth_with": round(d_with, 4),
                "max_depth_without": round(d_without, 4),
                "delta_max_depth": delta_d,
                "first_critical_min_with": t_crit_with,
                "first_critical_min_without": t_crit_without,
                "worsened": worsened,
            })

        impact = {
            "totals": totals,
            "per_ward": per_ward,
            "baseline_region_status": baseline_res["region_status"].tolist() if "region_status" in baseline_res else None,
            "baseline_affected_pop": baseline_res["affected_pop"].tolist() if "affected_pop" in baseline_res else None,
        }

    # Global 2D t_crit matrix with None for unbreached cells
    t_crit_arr = result["t_crit"]
    t_crit_clean = np.where(np.isnan(t_crit_arr) | np.isinf(t_crit_arr), None, np.round(t_crit_arr, 2)).tolist()

    # Crucial: Convert all NumPy arrays into JSON-serializable Python lists
    response_data = {
        "scenario": scenario["name"],
        "grid_size": req.grid_size,
        "times_min": result["times_min"].tolist(),
        "rain_mmhr": result["rain_mmhr"].tolist(),
        "affected_pop": result["affected_pop"].tolist(),
        "h": result["h"].tolist(),
        "status": result["status"].tolist(),
        "t_crit": t_crit_clean,
        "first_critical_min": summary.get("first_critical_min"),
        "first_ward_critical_min": summary.get("first_ward_critical_min"),
        "median_t_crit_min": summary.get("median_t_crit_min"),
        "summary": summary,
        "zones": summary.get("zones", {}),
        "baseline_summary": base_summary,
        "impact": impact,
        "disruptions": get_disruptions_metadata(req.grid_size, req.drain_failure, req.blockage, city=city),
        "baseline_region_status": baseline_res["region_status"].tolist() if (impact is not None and "region_status" in baseline_res) else None,
        "baseline_affected_pop": baseline_res["affected_pop"].tolist() if (impact is not None and "affected_pop" in baseline_res) else None,
    }

    # Region-Based / Ward-Based data structures
    if "region_status" in result:
        response_data["region_status"] = result["region_status"].tolist()
        response_data["region_affected"] = result["region_affected"].tolist()
        response_data["region_depth"] = result["region_depth"].tolist() if "region_depth" in result else []
        response_data["region_data"] = result.get("region_data", [])
        response_data["region_info"] = result.get("region_info", [])
        response_data["n_regions"] = result.get("n_regions", 16)
        # 4x4 layout of 16 ward IDs for choropleth block visualization
        response_data["region_grid_layout"] = [
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [8, 9, 10, 11],
            [12, 13, 14, 15],
        ]
        if "flux_timeline" in result:
            response_data["flux_timeline"] = result["flux_timeline"]
        if "edge_flows" in result:
            response_data["edge_flows"] = result["edge_flows"]
        if "flux_matrix" in result:
            response_data["flux_matrix"] = result["flux_matrix"]
        if "timeline" in result:
            response_data["timeline"] = result["timeline"]

    # Run probabilistic ensemble early warning (20 Monte Carlo iterations with +/-10% variance)
    try:
        ensemble_res = run_ensemble_simulation(
            city,
            intensity_mm_hr=req.intensity_mm_hr,
            duration_hrs=req.duration_hrs,
            initial_water_m=req.initial_water_m,
            drain_failure=req.drain_failure,
            blockage=req.blockage,
            n_runs=20,
        )
        response_data["early_warning"] = ensemble_res
        if "zones" in response_data and isinstance(response_data["zones"], dict):
            for r_str, r_warn in ensemble_res.get("wards", {}).items():
                if r_str in response_data["zones"]:
                    response_data["zones"][r_str]["early_warning"] = r_warn
    except Exception as e:
        print(f"[Ensemble Early Warning] Execution note: {e}")

    sanitized_response = sanitize_for_json(response_data)

    # In-memory LRU cache update
    if len(_SIMULATION_CACHE) >= _SIMULATION_CACHE_MAX_SIZE:
        _SIMULATION_CACHE.popitem(last=False)
    _SIMULATION_CACHE[cache_key] = sanitized_response

    return sanitized_response



@app.post("/api/early-warning")
def get_early_warning(req: SimulationRequest):
    """
    Runs an ultra-fast Monte Carlo ensemble simulation (20 runs) with Gaussian perturbations
    on rainfall intensity (+/- 10%) and drainage capacity (+/- 10%) to compute P10, P50, and P90
    percentiles of critical breach times for all 16 city wards.
    """
    city = get_or_create_city(req.grid_size)
    ensemble_res = run_ensemble_simulation(
        city,
        intensity_mm_hr=req.intensity_mm_hr,
        duration_hrs=req.duration_hrs,
        initial_water_m=req.initial_water_m,
        drain_failure=req.drain_failure,
        blockage=req.blockage,
        n_runs=20,
    )
    return sanitize_for_json(ensemble_res)


@app.get("/api/early-warning")
def get_early_warning_get(
    intensity_mm_hr: float = 75.0,
    duration_hrs: float = 4.0,
    initial_water_m: float = 0.0,
    drain_failure: bool = False,
    blockage: bool = False,
    grid_size: int = 80,
):
    """GET endpoint for ensemble probabilistic early warning."""
    city = get_or_create_city(grid_size)
    ensemble_res = run_ensemble_simulation(
        city,
        intensity_mm_hr=intensity_mm_hr,
        duration_hrs=duration_hrs,
        initial_water_m=initial_water_m,
        drain_failure=drain_failure,
        blockage=blockage,
        n_runs=20,
    )
    return sanitize_for_json(ensemble_res)


# In-memory cache for live physics stress matrix runs
_STRESS_MATRIX_CACHE = None

STRESS_SCENARIO_CONFIGS = [
    {
        "id": "normal_baseline",
        "title": "Normal Rainfall",
        "subtitle": "Baseline Standard Drainage",
        "intensity_mm_hr": 10.0,
        "duration_hrs": 3.0,
        "initial_water_m": 0.0,
        "drain_failure": False,
        "blockage": False,
    },
    {
        "id": "moderate_blocked",
        "title": "Moderate Monsoon",
        "subtitle": "Central Canal Blockage (+30m)",
        "intensity_mm_hr": 30.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.0,
        "drain_failure": False,
        "blockage": True,
    },
    {
        "id": "heavy_drain_failure",
        "title": "Heavy Monsoon",
        "subtitle": "Urban Core Drain Failure (+60m)",
        "intensity_mm_hr": 30.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.0,
        "drain_failure": True,
        "blockage": False,
    },
    {
        "id": "extreme_flashburst",
        "title": "Extreme Flashburst",
        "subtitle": "High-Intensity Cloudburst",
        "intensity_mm_hr": 60.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.0,
        "drain_failure": False,
        "blockage": False,
    },
    {
        "id": "extreme_compound",
        "title": "Compound Catastrophe",
        "subtitle": "Compound Failure (Block + Drain Failure + Standing Water)",
        "intensity_mm_hr": 60.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.15,
        "drain_failure": True,
        "blockage": True,
    },
]


@app.get("/api/stress-matrix")
def get_stress_matrix():
    """
    Returns comparative stress matrix data computed using the actual hydrodynamic physics engine:
    1. Normal Rainfall (Baseline)
    2. Moderate Monsoon + Canal Blockage
    3. Heavy Monsoon + Urban Drain Failure
    4. Extreme Flashburst
    5. Compound Catastrophe (Extreme + Block + Drain Failure + Standing Water)
    """
    global _STRESS_MATRIX_CACHE
    if _STRESS_MATRIX_CACHE is not None:
        return {"scenarios": _STRESS_MATRIX_CACHE}

    # Use 40x40 grid for high-speed, mathematically accurate ward benchmarking
    sim_grid_size = 40
    city = get_or_create_city(sim_grid_size)
    runs = []

    for cfg in STRESS_SCENARIO_CONFIGS:
        sc = build_scenario(
            cfg["intensity_mm_hr"],
            cfg["duration_hrs"],
            cfg["initial_water_m"],
            cfg["drain_failure"],
            cfg["blockage"],
            sim_grid_size,
        )
        sim_res = run_scenario(
            city,
            sc,
            intensity_mm_hr=cfg["intensity_mm_hr"],
            duration_hrs=cfg["duration_hrs"],
            initial_water_m=cfg["initial_water_m"],
        )

        peak_depth = float(sim_res["summary"]["peak_depth_m"])
        peak_affected = float(sim_res["summary"]["peak_affected"])
        first_crit = sim_res["summary"].get("first_critical_min")
        if first_crit is not None and (np.isnan(first_crit) or np.isinf(first_crit)):
            first_crit = None

        # Count wards where status ever reaches 2 (Critical)
        crit_wards = 0
        if "region_status" in sim_res:
            crit_wards = int((sim_res["region_status"] == 2).any(axis=0).sum())

        runs.append({
            "cfg": cfg,
            "peak_depth": peak_depth,
            "peak_affected": peak_affected,
            "first_crit": first_crit,
            "crit_wards": crit_wards,
        })

    # Map same-storm baselines: for each scenario with disruptions, compute the identical storm without disruptions
    same_storm_bases = {}
    for cfg in STRESS_SCENARIO_CONFIGS:
        k = (cfg["intensity_mm_hr"], cfg["duration_hrs"], cfg["initial_water_m"])
        if (cfg["drain_failure"] or cfg["blockage"]) and k not in same_storm_bases:
            sc_no_event = build_scenario(
                cfg["intensity_mm_hr"],
                cfg["duration_hrs"],
                cfg["initial_water_m"],
                False,
                False,
                sim_grid_size,
            )
            base_res = run_scenario(
                city,
                sc_no_event,
                intensity_mm_hr=cfg["intensity_mm_hr"],
                duration_hrs=cfg["duration_hrs"],
                initial_water_m=cfg["initial_water_m"],
            )
            same_storm_bases[k] = base_res

    scenarios_output = []
    for r in runs:
        cfg = r["cfg"]
        p_depth = r["peak_depth"]
        p_pop = r["peak_affected"]
        f_crit = r["first_crit"]
        c_wards = r["crit_wards"]

        has_events = bool(cfg["drain_failure"] or cfg["blockage"])
        if has_events:
            k = (cfg["intensity_mm_hr"], cfg["duration_hrs"], cfg["initial_water_m"])
            base_r = same_storm_bases[k]
            d_depth = p_depth - float(base_r["summary"]["peak_depth_m"])
            d_pop = p_pop - float(base_r["summary"]["peak_affected"])
            delta_depth_str = f"+{max(0.0, d_depth):.2f}m"
            delta_pop_str = f"+{int(max(0, d_pop)):,} citizens"
        else:
            delta_depth_str = "+0.00m (Ref)"
            delta_pop_str = "+0 (Ref)"

        # Severity & Risk classification
        if c_wards >= 10 or p_depth >= 1.2:
            risk_pill = "CRITICAL EMERGENCY"
            risk_color = "text-red-400 border-red-500/50 bg-red-500/10"
            badge_bg = "bg-red-500"
        elif c_wards >= 4 or p_depth >= 0.6:
            risk_pill = "ELEVATED DANGER"
            risk_color = "text-orange-400 border-orange-500/50 bg-orange-500/10"
            badge_bg = "bg-orange-500"
        elif c_wards >= 1 or p_depth >= 0.3:
            risk_pill = "MODERATE RISK"
            risk_color = "text-amber-400 border-amber-500/50 bg-amber-500/10"
            badge_bg = "bg-amber-500"
        else:
            risk_pill = "CONTROLLED"
            risk_color = "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
            badge_bg = "bg-emerald-500"

        # Dynamically generate narrative description based on computed hydrodynamic results
        cid = cfg["id"]
        if cid == "normal_baseline":
            narrative = (
                f"Controlled baseline under {cfg['intensity_mm_hr']:.0f} mm/hr rain ({cfg['duration_hrs']:.0f}h). "
                f"Peak depth {p_depth:.2f}m with {int(p_pop):,} affected citizens across {c_wards} critical wards; "
                f"storm drainage network operates within designed capacity."
            )
        elif cid == "moderate_blocked":
            narrative = (
                f"Moderate storm ({cfg['intensity_mm_hr']:.0f} mm/hr) with 100% canal culvert blockage at t=30m. "
                f"Localized ponding at the obstruction reaches {p_depth:.2f}m peak depth, impacting {int(p_pop):,} residents "
                f"across {c_wards} critical wards."
            )
        elif cid == "heavy_drain_failure":
            narrative = (
                f"Monsoon storm ({cfg['intensity_mm_hr']:.0f} mm/hr) paired with 60% urban core storm-drain capacity loss at t=60m. "
                f"Water accumulates to {p_depth:.2f}m affecting {int(p_pop):,} citizens across {c_wards} critical wards."
            )
        elif cid == "extreme_flashburst":
            narrative = (
                f"Severe {cfg['intensity_mm_hr']:.0f} mm/hr cloudburst inundates natural channels. "
                f"Water depth peaks at {p_depth:.2f}m, impacting {int(p_pop):,} residents with {c_wards} wards breaching critical thresholds."
            )
        elif cid == "extreme_compound":
            narrative = (
                f"Catastrophic compound event ({cfg['intensity_mm_hr']:.0f} mm/hr + {cfg['initial_water_m']:.2f}m initial water) "
                f"with simultaneous canal blockage and drain failure. Peak depth reaches {p_depth:.2f}m, impacting {int(p_pop):,} citizens across {c_wards} wards."
            )
        else:
            narrative = (
                f"Simulation of {cfg['intensity_mm_hr']:.0f} mm/hr rain over {cfg['duration_hrs']:.1f}h. "
                f"Resulting peak depth is {p_depth:.2f}m with {int(p_pop):,} affected residents across {c_wards} critical wards."
            )

        scenarios_output.append({
            "id": cfg["id"],
            "title": cfg["title"],
            "name": cfg["title"],
            "subtitle": cfg["subtitle"],
            "intensity_mm_hr": cfg["intensity_mm_hr"],
            "duration_hrs": cfg["duration_hrs"],
            "initial_water_m": cfg["initial_water_m"],
            "drainFailure": cfg["drain_failure"],
            "drain_failure": cfg["drain_failure"],
            "blockage": cfg["blockage"],
            "peakDepth": f"{p_depth:.2f} m",
            "peak_depth_m": round(p_depth, 3),
            "peakPop": f"{int(p_pop):,} citizens",
            "peak_affected": round(p_pop, 1),
            "firstCrit": f"T+{int(f_crit)} min" if f_crit is not None else "None (Safe)",
            "first_critical_min": f_crit,
            "critWards": f"{c_wards} / 16 Wards",
            "critical_wards": c_wards,
            "riskPill": risk_pill,
            "riskColor": risk_color,
            "badgeBg": badge_bg,
            "deltaDepth": delta_depth_str,
            "deltaPop": delta_pop_str,
            "description": narrative,
        })

    _STRESS_MATRIX_CACHE = scenarios_output
    return {"scenarios": sanitize_for_json(_STRESS_MATRIX_CACHE)}



if __name__ == "__main__":
    print("Starting FlowShield FastAPI server on http://localhost:8000...")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)

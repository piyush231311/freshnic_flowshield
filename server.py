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

# In-memory cache for generated city terrain arrays to ensure sub-second response times
_CITY_CACHE: Dict[int, Dict[str, np.ndarray]] = {}


class SimulationRequest(BaseModel):
    intensity_mm_hr: float = Field(
        default=75.0,
        ge=0.0,
        le=500.0,
        description="Rainfall intensity in mm/hr (Range: 0 to 300 mm/hr)",
    )
    duration_hrs: float = Field(
        default=4.0,
        gt=0.0,
        le=48.0,
        description="Storm duration in hours (Range: 1 to 24 hrs)",
    )
    initial_water_m: float = Field(
        default=0.0,
        ge=0.0,
        le=10.0,
        description="Initial standing water depth in metres across the city (Range: 0.0 to 2.5m)",
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
        "endpoints": ["/api/simulate"],
    }


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
    elif isinstance(val, (np.integer, int)):
        return int(val)
    elif isinstance(val, (np.bool_, bool)):
        return bool(val)
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

    # Compute baseline scenario for frontend delta comparisons (35 mm/hr, 0 initial water, no disruptions)
    baseline_sc = build_scenario(
        35.0,
        req.duration_hrs,
        0.0,
        False,
        False,
        req.grid_size,
    )
    baseline_res = run_scenario(
        city,
        baseline_sc,
        intensity_mm_hr=35.0,
        duration_hrs=req.duration_hrs,
        initial_water_m=0.0,
    )

    # Sanitize float values in summary
    summary = dict(result["summary"])
    if summary.get("first_critical_min") is not None and (np.isnan(summary["first_critical_min"]) or np.isinf(summary["first_critical_min"])):
        summary["first_critical_min"] = None

    base_summary = dict(baseline_res["summary"])
    if base_summary.get("first_critical_min") is not None and (np.isnan(base_summary["first_critical_min"]) or np.isinf(base_summary["first_critical_min"])):
        base_summary["first_critical_min"] = None

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
        "summary": summary,
        "zones": summary.get("zones", {}),
        "baseline_summary": base_summary,
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

    return sanitize_for_json(response_data)


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
        "intensity_mm_hr": 35.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.0,
        "drain_failure": False,
        "blockage": False,
        "description": "Standard precipitation envelope under full storm-drain capacity. Natural river channels handle total runoff with no structural inundation.",
    },
    {
        "id": "moderate_blocked",
        "title": "Moderate Monsoon",
        "subtitle": "Central Canal Blockage (+30m)",
        "intensity_mm_hr": 45.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.0,
        "drain_failure": False,
        "blockage": True,
        "description": "Moderate rain combined with a 100% culvert obstruction at t=30m. Backwater buildup inundates low-lying eastern arterial zones.",
    },
    {
        "id": "heavy_drain_failure",
        "title": "Heavy Monsoon",
        "subtitle": "Urban Core Drain Failure (+60m)",
        "intensity_mm_hr": 75.0,
        "duration_hrs": 6.0,
        "initial_water_m": 0.2,
        "drain_failure": True,
        "blockage": False,
        "description": "Intense sustained monsoon paired with a 60% loss of pumping capacity in the central business district. Commercial core breaches critical threshold.",
    },
    {
        "id": "extreme_flashburst",
        "title": "Extreme Flashburst",
        "subtitle": "High-Intensity Cloudburst",
        "intensity_mm_hr": 120.0,
        "duration_hrs": 4.0,
        "initial_water_m": 0.3,
        "drain_failure": False,
        "blockage": False,
        "description": "Severe 100-year convective cloudburst. Natural channels overflow and inundate vulnerable lowlands.",
    },
    {
        "id": "extreme_compound",
        "title": "Compound Catastrophe",
        "subtitle": "Compound Failure (Block + Drain Failure + Standing Water)",
        "intensity_mm_hr": 150.0,
        "duration_hrs": 6.0,
        "initial_water_m": 0.5,
        "drain_failure": True,
        "blockage": True,
        "description": "100-year convective cloudburst combined with simultaneous drain and canal failures over pre-existing standing water.",
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

    base_depth = runs[0]["peak_depth"]
    base_pop = runs[0]["peak_affected"]

    scenarios_output = []
    for r in runs:
        cfg = r["cfg"]
        p_depth = r["peak_depth"]
        p_pop = r["peak_affected"]
        f_crit = r["first_crit"]
        c_wards = r["crit_wards"]

        d_depth = p_depth - base_depth
        d_pop = p_pop - base_pop

        is_base = cfg["id"] == "normal_baseline"
        delta_depth_str = "+0.00m (Ref)" if is_base else f"+{max(0.0, d_depth):.2f}m"
        delta_pop_str = "+0 (Ref)" if is_base else f"+{int(max(0, d_pop)):,} citizens"

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
            "description": cfg["description"],
        })

    _STRESS_MATRIX_CACHE = scenarios_output
    return {"scenarios": sanitize_for_json(_STRESS_MATRIX_CACHE)}



if __name__ == "__main__":
    print("Starting FlowShield FastAPI server on http://localhost:8000...")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)

import numpy as np
from engine.run import run_scenario, rain_series
from tests.toy_city import make_toy_city

CITY = make_toy_city()
BOX  = (30, 45, 10, 40)
FAIL = {"type": "drain_failure", "region": BOX, "loss": 0.6, "t_start_min": 60}
BLOCK = {"type": "blockage", "cells": [(41, 25), (42, 25)], "severity": 1.0, "t_start_min": 30}
def storm(peak, shape="triangular"): return {"shape": shape, "peak_mm_hr": peak, "duration_h": 3}
def sc(peak, events=(), shape="triangular"): return {"name": "t", "rain": storm(peak, shape), "events": list(events)}

def test_result_matches_contract():
    r = run_scenario(CITY, sc(60))
    T = r["h"].shape[0]
    assert r["h"].shape == (T,) + CITY["z"].shape
    assert r["status"].shape == r["h"].shape and set(np.unique(r["status"])) <= {0, 1, 2}
    assert r["t_crit"].shape == CITY["z"].shape
    assert r["affected_pop"].shape == (T,) and len(r["times_min"]) == T
    assert {"peak_depth_m", "critical_cells", "first_critical_min", "peak_affected", "mass_err_rel"} <= set(r["summary"])

def test_normal_rain_is_safe():                       # the model must not "cry wolf"
    r = run_scenario(CITY, sc(8, shape="constant"))
    assert r["summary"]["critical_cells"] == 0 and r["summary"]["peak_affected"] == 0

def test_each_event_makes_things_worse():
    base = run_scenario(CITY, sc(60))
    fail = run_scenario(CITY, sc(60, [FAIL]))
    blk  = run_scenario(CITY, sc(60, [BLOCK]))
    up = (slice(None), slice(28, 41), slice(20, 31))  # cells upstream of the blockage
    assert fail["summary"]["peak_affected"] > base["summary"]["peak_affected"]
    assert blk["h"][up].max() > base["h"][up].max()

def test_worst_case_is_worst():
    a = run_scenario(CITY, sc(60))["summary"]["peak_affected"]
    b = run_scenario(CITY, sc(100, [FAIL, BLOCK]))["summary"]["peak_affected"]
    assert b > a

def test_mass_balance_with_events():
    r = run_scenario(CITY, sc(100, [FAIL, BLOCK]))
    assert abs(r["summary"]["mass_err_rel"]) < 1e-9
    assert r["h"].min() >= 0

def test_affected_never_exceeds_population_and_city_not_mutated():
    z0, D0 = CITY["z"].copy(), CITY["D"].copy()
    r = run_scenario(CITY, sc(100, [FAIL, BLOCK]))
    assert r["affected_pop"].max() <= CITY["pop"].sum() + 1e-6
    assert np.array_equal(CITY["z"], z0) and np.array_equal(CITY["D"], D0)

def test_triangular_storm_total_depth():              # area under triangle = 0.5 * peak * duration
    n = 3 * 3600 // 10
    total_mm = rain_series(storm(60), n, 10.0).sum() * 10 / 3600
    assert abs(total_mm - 0.5 * 60 * 3) < 0.5

def test_impact_null_with_no_events():
    from server import simulate, SimulationRequest
    req = SimulationRequest(
        intensity_mm_hr=25.0,
        duration_hrs=2.0,
        initial_water_m=0.0,
        drain_failure=False,
        blockage=False,
        grid_size=40,
    )
    res = simulate(req)
    assert res["impact"] is None
    assert res["baseline_summary"] is not None

def test_impact_equals_difference_of_two_runs():
    from server import simulate, SimulationRequest
    req = SimulationRequest(
        intensity_mm_hr=50.0,
        duration_hrs=3.0,
        initial_water_m=0.0,
        drain_failure=True,
        blockage=False,
        grid_size=40,
    )
    res = simulate(req)
    assert res["impact"] is not None
    totals = res["impact"]["totals"]

    req_no = SimulationRequest(
        intensity_mm_hr=50.0,
        duration_hrs=3.0,
        initial_water_m=0.0,
        drain_failure=False,
        blockage=False,
        grid_size=40,
    )
    res_no = simulate(req_no)

    diff_aff = round(float(res["summary"]["peak_affected"] - res_no["summary"]["peak_affected"]), 1)
    diff_cells = int(res["summary"]["critical_cells"] - res_no["summary"]["critical_cells"])

    assert totals["delta_peak_affected"] == diff_aff
    assert totals["delta_critical_cells"] == diff_cells

    # Check series and per_ward fields in impact
    assert "baseline_region_status" in res["impact"]
    assert "baseline_affected_pop" in res["impact"]
    for w in res["impact"]["per_ward"]:
        assert "id" in w
        assert "worst_status_with" in w
        assert "worst_status_without" in w
        assert "delta_max_depth" in w
        assert isinstance(w["worsened"], bool)

    # Check per-ward crit_pct in region_data
    assert "region_data" in res
    for rdata in res["region_data"]:
        assert "crit_pct" in rdata

def test_reference_case_reproduces():
    from engine.city_generator import generate_advanced_city
    from server import build_scenario
    city40 = generate_advanced_city(N=40, M=40)
    sc_with = build_scenario(27.0, 9.0, 0.0, drain_failure=True, blockage=True, grid_size=40)
    res_with = run_scenario(city40, sc_with, intensity_mm_hr=27.0, duration_hrs=9.0, initial_water_m=0.0)

    sc_no = build_scenario(27.0, 9.0, 0.0, drain_failure=False, blockage=False, grid_size=40)
    res_no = run_scenario(city40, sc_no, intensity_mm_hr=27.0, duration_hrs=9.0, initial_water_m=0.0)

    crit_wards_with = [f"W-{i+1:02d}" for i in range(16) if (res_with["region_status"] == 2).any(axis=0)[i]]
    crit_wards_no = [f"W-{i+1:02d}" for i in range(16) if (res_no["region_status"] == 2).any(axis=0)[i]]

    assert crit_wards_with == ["W-10", "W-11", "W-16"]
    assert crit_wards_no == ["W-16"]
    assert res_with["summary"]["critical_cells"] == 47
    assert res_no["summary"]["critical_cells"] == 30
    assert abs(res_with["summary"]["peak_affected"] - 6659) <= 6659 * 0.02
    assert abs(res_no["summary"]["peak_affected"] - 276) <= 276 * 0.02

def test_disruptions_metadata_grid40_and_80():
    from server import get_disruptions_metadata

    # Both toggles off gives an empty list
    empty = get_disruptions_metadata(grid_size=40, drain_failure=False, blockage=False)
    assert empty == []

    for sz in [40, 80]:
        disruptions = get_disruptions_metadata(grid_size=sz, drain_failure=True, blockage=True)
        assert len(disruptions) == 2

        # Blockage: primary [10] (Ward W-11)
        blk = next(d for d in disruptions if d["type"] == "blockage")
        assert blk["primary_ward_ids"] == [10]
        blk_overlap = blk["ward_overlap"].get(10, blk["ward_overlap"].get("10"))
        if sz == 40:
            assert abs(blk_overlap - 0.14) < 0.02
        else:
            assert abs(blk_overlap - 0.035) < 0.01

        # Drain failure: primary [9, 10, 13, 14] with overlaps about 0.8, 0.8, 0.4, 0.4
        df = next(d for d in disruptions if d["type"] == "drain_failure")
        assert df["primary_ward_ids"] == [9, 10, 13, 14]

        ov = df["ward_overlap"]
        get_ov = lambda wid: ov.get(wid, ov.get(str(wid)))
        assert abs(get_ov(9) - 0.80) < 0.05
        assert abs(get_ov(10) - 0.80) < 0.05
        assert abs(get_ov(13) - 0.40) < 0.05
        assert abs(get_ov(14) - 0.40) < 0.05

        # Partial ids 8 and 11 (~0.16), 12 and 15 (~0.08)
        assert abs(get_ov(8) - 0.16) < 0.05
        assert abs(get_ov(11) - 0.16) < 0.05
        assert abs(get_ov(12) - 0.08) < 0.05
        assert abs(get_ov(15) - 0.08) < 0.05


def test_stress_matrix_five_scenarios():
    from server import get_stress_matrix

    res = get_stress_matrix()
    scenarios = res["scenarios"]
    assert len(scenarios) == 5

    # 1. Normal (15 mm/hr, 4 h, no events)
    normal = scenarios[0]
    assert normal["intensity_mm_hr"] == 15.0
    assert normal["duration_hrs"] == 4.0
    assert normal["peak_affected"] == 0.0
    assert normal["deltaDepth"] == "Ref"
    assert normal["deltaPop"] == "Ref"
    assert "backwater" not in normal["description"].lower()
    assert "0 people affected" in normal["description"]

    # 2. Heavy Base (50 mm/hr, 4 h, no events)
    heavy_base = scenarios[1]
    assert heavy_base["intensity_mm_hr"] == 50.0
    assert heavy_base["duration_hrs"] == 4.0
    assert heavy_base["drain_failure"] is False
    assert heavy_base["blockage"] is False
    assert abs(heavy_base["peak_affected"] - 4632) < 5
    assert heavy_base["deltaDepth"] == "Ref"
    assert heavy_base["deltaPop"] == "Ref"
    assert "backwater" not in heavy_base["description"].lower()

    # 3. Heavy Drain Failure (50 mm/hr, 4 h, drain failure)
    heavy_drain = scenarios[2]
    assert heavy_drain["intensity_mm_hr"] == 50.0
    assert heavy_drain["drain_failure"] is True
    assert heavy_drain["blockage"] is False
    # +998 people over heavy base
    diff_drain = heavy_drain["peak_affected"] - heavy_base["peak_affected"]
    assert abs(diff_drain - 998) < 5
    assert "+998" in heavy_drain["deltaPop"]
    assert "backwater" not in heavy_drain["description"].lower()

    # 4. Heavy Blockage (50 mm/hr, 4 h, blockage)
    heavy_block = scenarios[3]
    assert heavy_block["intensity_mm_hr"] == 50.0
    assert heavy_block["drain_failure"] is False
    assert heavy_block["blockage"] is True
    # +2,319 people over heavy base
    diff_block = heavy_block["peak_affected"] - heavy_base["peak_affected"]
    assert abs(diff_block - 2319) < 5
    assert "+2,319" in heavy_block["deltaPop"]
    assert "backwater" not in heavy_block["description"].lower()
    assert "ponding in the blocked cells" in heavy_block["description"]

    # 5. Extreme Compound (75 mm/hr, 4 h, both)
    extreme = scenarios[4]
    assert extreme["intensity_mm_hr"] == 75.0
    assert extreme["drain_failure"] is True
    assert extreme["blockage"] is True
    # Base 75 mm/hr is ~41,182, delta is +154%
    assert abs(extreme["peak_affected"] - 104638) < 100
    assert "+154%" in extreme["deltaPop"]
    assert "backwater" not in extreme["description"].lower()


def test_default_grid_size_is_40():
    from server import SimulationRequest
    req = SimulationRequest()
    assert req.grid_size == 40


def test_initial_water_low_ground_and_grid_dependency():
    from server import get_or_create_city, build_scenario
    from engine.run import run_scenario

    # 1. Initial water 0.5m applied only to low ground (<=20th percentile elevation + channel)
    city40 = get_or_create_city(40)
    sc40 = build_scenario(0.0, 4.0, 0.5, False, False, 40)
    res40 = run_scenario(city40, sc40, intensity_mm_hr=0.0, duration_hrs=4.0, initial_water_m=0.5)

    total_pop40 = float(city40["pop"].sum())
    t0_aff40 = float(res40["affected_pop"][0])
    pct40 = (t0_aff40 / total_pop40) * 100.0

    # Must be clearly below 100% (measured at ~27.38%)
    assert pct40 < 50.0
    assert abs(pct40 - 27.38) < 2.0

    # Verify high ground cells remain dry at t=0
    z40 = np.asarray(city40["z"], float)
    ch40 = np.asarray(city40["channel_mask"], bool)
    z_thresh40 = float(np.percentile(z40, 20))
    high_ground = (z40 > z_thresh40) & (~ch40)
    assert np.all(res40["h"][0][high_ground] == 0.0)

    # 2. Grid dependency: 50 mm/hr x 4 h with no events
    sc_base40 = build_scenario(50.0, 4.0, 0.0, False, False, 40)
    res_base40 = run_scenario(city40, sc_base40, intensity_mm_hr=50.0, duration_hrs=4.0, initial_water_m=0.0)
    assert abs(res_base40["summary"]["peak_affected"] - 4632) < 5

    city80 = get_or_create_city(80)
    sc_base80 = build_scenario(50.0, 4.0, 0.0, False, False, 80)
    res_base80 = run_scenario(city80, sc_base80, intensity_mm_hr=50.0, duration_hrs=4.0, initial_water_m=0.0)
    assert abs(res_base80["summary"]["peak_affected"] - 22619) < 10
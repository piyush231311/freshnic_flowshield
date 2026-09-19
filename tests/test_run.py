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
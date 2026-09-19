"""Run the five demo scenarios and print the comparison table. `python demo_scenarios.py`"""
from engine.run import run_scenario
from engine.city_generator import generate_advanced_city   # later: from city.generator import make_city

city = generate_advanced_city()
fail  = {"type": "drain_failure", "region": (30, 45, 10, 40), "loss": 0.6, "t_start_min": 60}
block = {"type": "blockage", "cells": [(41, 25), (42, 25)], "severity": 1.0, "t_start_min": 30}
tri = lambda peak: {"shape": "triangular", "peak_mm_hr": peak, "duration_h": 3}
SCENARIOS = [
    {"name": "1 Normal",                  "rain": {"shape": "constant", "peak_mm_hr": 8, "duration_h": 3}, "events": []},
    {"name": "2 Heavy",                   "rain": tri(60),  "events": []},
    {"name": "3 Heavy + drain failure",   "rain": tri(60),  "events": [fail]},
    {"name": "4 Heavy + blocked channel", "rain": tri(60),  "events": [block]},
    {"name": "5 Extreme + both",          "rain": tri(100), "events": [fail, block]},
]
print(f"{'scenario':<27}{'peak m':>7}{'crit cells':>11}{'first crit':>11}{'affected':>10}{'% pop':>7}")
for sc in SCENARIOS:
    s = run_scenario(city, sc)["summary"]
    fc = "-" if s["first_critical_min"] is None else f"{s['first_critical_min']:.0f} min"
    print(f"{sc['name']:<27}{s['peak_depth_m']:>7.2f}{s['critical_cells']:>11}{fc:>11}{s['peak_affected']:>10,.0f}{s['peak_affected_pct']:>7.1f}")

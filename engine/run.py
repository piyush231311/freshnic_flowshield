"""
run_scenario(): the ONE function the dashboard calls.

    city     = {"z", "D", "channel_mask", "pop"}       (arrays [N, M])
    scenario = {"name", "rain": {...}, "events": [...]}
    params   = optional overrides of DEFAULTS
    returns  = the result dict described in CONTRACT.md
"""
import numpy as np
from .simulate import step, MM_HR
from .metrics import classify, time_to_critical, critical_zones

DEFAULTS = dict(
    hours=6,            # simulated horizon (storm + recession)
    dt=10.0,            # seconds per internal step
    k=0.005,            # flow coefficient, 1/s   (k*dt = base fraction of level difference moved per step)
    channel_gain=4.0,   # channel cells move water this many times faster (keep k*dt*gain <= ~0.25)
    f_mmhr=2.0,         # infiltration, mm/hr
    save_every=30,      # save a frame every 30 steps = 5 min at dt=10
    h_crit=0.5,         # metres, "Critical" depth
    warn_frac=0.5,      # Warning starts at warn_frac * h_crit
    h0=0.10, h1=0.50,   # exposure ramp: 0% affected at h0, 100% at h1 (metres)
)


def rain_series(cfg, n_steps, dt):
    """Rain intensity (mm/hr) at every internal time step."""
    t_h = np.arange(n_steps) * dt / 3600.0
    shape, peak, dur = cfg["shape"], cfg.get("peak_mm_hr", 0.0), cfg.get("duration_h", 0.0)
    if shape == "constant":
        return np.where(t_h < dur, peak, 0.0)
    if shape == "triangular":                       # rises to peak at mid-storm, then falls
        return np.where(t_h < dur, peak * (1 - np.abs(2 * t_h / dur - 1)), 0.0)
    if shape == "series":                           # hourly values, e.g. from a forecast API
        return np.interp(t_h, np.arange(len(cfg["mm_hr"])), cfg["mm_hr"], right=0.0)
    raise ValueError(f"unknown rain shape: {shape}")


def _event_mask(ev, shape):
    if "cells" in ev:
        m = np.zeros(shape, bool)
        for r, c in ev["cells"]:
            m[r, c] = True
        return m
    reg = ev["region"]
    if isinstance(reg, tuple):                      # (row0, row1, col0, col1) box
        m = np.zeros(shape, bool); m[reg[0]:reg[1], reg[2]:reg[3]] = True
        return m
    return np.asarray(reg, bool)


def run_scenario(city, scenario, params=None):
    p = {**DEFAULTS, **(params or {})}
    z = np.asarray(city["z"], float)
    N, M = z.shape
    dt, k, h_crit = p["dt"], p["k"], p["h_crit"]
    n_steps = int(p["hours"] * 3600 / dt)

    # ---- inputs (DATA ENTERS HERE) -------------------------------------------------
    rain_mmhr = rain_series(scenario["rain"], n_steps, dt)      # storm -> mm/hr per step
    D = np.asarray(city["D"], float) * MM_HR                    # drainage map -> m/s (own copy)
    f = p["f_mmhr"] * MM_HR
    gain = np.ones((4, N, M))
    gain[:, np.asarray(city["channel_mask"], bool)] = p["channel_gain"]
    pending = sorted(scenario.get("events", []), key=lambda e: e["t_start_min"])

    # ---- time loop -------------------------------------------------------------------
    h = np.zeros_like(z)
    frames = [h.astype(np.float32)]
    rain_in = drained_out = infil_out = 0.0
    for s in range(n_steps):
        t_min = s * dt / 60.0
        while pending and t_min >= pending[0]["t_start_min"]:   # activate events on schedule
            ev = pending.pop(0)
            m = _event_mask(ev, (N, M))
            if ev["type"] == "drain_failure":
                D[m] *= (1 - ev["loss"])                        # drains lose capacity (a SINK change)
            elif ev["type"] == "blockage":
                gain[:, m] *= (1 - ev["severity"])              # water can't move on (a FLOW change)
                D[m] *= (1 - ev["severity"])                    # a blocked culvert can't drain either
            else:
                raise ValueError(f"unknown event type: {ev['type']}")
        r = rain_mmhr[s] * MM_HR
        h, dr, inf = step(h, z, r, D, f, k, dt, gain)
        rain_in += r * dt * z.size
        drained_out += dr.sum()
        infil_out += inf.sum()
        if (s + 1) % p["save_every"] == 0:
            frames.append(h.astype(np.float32))

    # ---- results (DERIVED FROM THE FLOOD MOVIE) -------------------------------------------
    hcube = np.array(frames)                                    # [T, N, M] depth in metres
    mpf = p["save_every"] * dt / 60.0                           # minutes per frame
    t_crit = time_to_critical(hcube, mpf, h_crit)               # [N, M] minutes, NaN if never
    zones, n_zones = critical_zones(t_crit)
    expo = np.clip((hcube - p["h0"]) / (p["h1"] - p["h0"]), 0, 1)
    affected = (expo * np.asarray(city["pop"], float)).sum(axis=(1, 2))   # [T] people
    mass_err = rain_in - drained_out - infil_out - float(h.sum())
    ever_crit = (hcube >= h_crit).any(axis=0)
    total_pop = float(np.sum(city["pop"]))

    return {
        "h": hcube,
        "status": classify(hcube, h_crit, p["warn_frac"]).astype(np.int8),
        "t_crit": t_crit,
        "zones": zones, "n_zones": n_zones,
        "affected_pop": affected,
        "times_min": np.arange(len(hcube)) * mpf,
        "rain_mmhr": rain_mmhr[np.minimum(np.arange(len(hcube)) * p["save_every"], n_steps - 1)],
        "summary": {
            "scenario": scenario.get("name", ""),
            "peak_depth_m": float(hcube.max()),
            "critical_cells": int(ever_crit.sum()),
            "first_critical_min": float(np.nanmin(t_crit)) if ever_crit.any() else None,
            "peak_affected": float(affected.max()),
            "peak_affected_pct": float(100 * affected.max() / total_pop),
            "mass_err": float(mass_err),
            "mass_err_rel": float(mass_err / max(rain_in, 1e-12)),
        },
    }
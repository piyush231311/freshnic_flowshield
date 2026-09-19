"""
run_scenario(): the ONE function the dashboard calls.

    city     = {"z", "D", "channel_mask", "pop"}       (arrays [N, M])
    scenario = {"name", "rain": {...}, "events": [...]}
    params   = optional overrides of DEFAULTS
    returns  = the result dict described in CONTRACT.md
"""
import numpy as np
from .simulate import step, MM_HR
from .metrics import classify, time_to_critical, critical_zones, compute_regional_metrics

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


def run_scenario(city, scenario, params=None, intensity_mm_hr=None, duration_hrs=None, initial_water_m=None):
    p = {**DEFAULTS, **(params or {})}
    z = np.asarray(city["z"], float)
    N, M = z.shape
    dt, k, h_crit = p["dt"], p["k"], p["h_crit"]

    # Continuous numeric hydrologic parameters:
    # 1. intensity_mm_hr (scales rain linearly)
    if intensity_mm_hr is not None:
        intensity = float(intensity_mm_hr)
    elif "intensity_mm_hr" in scenario:
        intensity = float(scenario["intensity_mm_hr"])
    elif "rain" in scenario and "peak_mm_hr" in scenario["rain"]:
        intensity = float(scenario["rain"]["peak_mm_hr"])
    else:
        intensity = 60.0

    # 2. duration_hrs (stops applying rain after duration_hrs)
    if duration_hrs is not None:
        duration = float(duration_hrs)
    elif "duration_hrs" in scenario:
        duration = float(scenario["duration_hrs"])
    elif "rain" in scenario and "duration_h" in scenario["rain"]:
        duration = float(scenario["rain"]["duration_h"])
    else:
        duration = 4.0

    # 3. initial_water_m (initializes standing water depth)
    if initial_water_m is not None:
        init_water = float(initial_water_m)
    elif "initial_water_m" in scenario:
        init_water = float(scenario["initial_water_m"])
    else:
        init_water = 0.0

    # Simulation horizon covers storm duration plus recession
    sim_hours = max(duration + 1.0, float(p.get("hours", 6.0)))
    n_steps = int(sim_hours * 3600 / dt)

    # ---- inputs (DATA ENTERS HERE) -------------------------------------------------
    t_h = np.arange(n_steps) * dt / 3600.0
    rain_mmhr = np.where(t_h < duration, intensity, 0.0)      # linear intensity, cuts off at duration

    D = np.asarray(city["D"], float) * MM_HR                    # drainage map -> m/s (own copy)
    f = p["f_mmhr"] * MM_HR
    gain = np.ones((4, N, M))
    gain[:, np.asarray(city["channel_mask"], bool)] = p["channel_gain"]
    pending = sorted(scenario.get("events", []), key=lambda e: e["t_start_min"])

    # ---- time loop -------------------------------------------------------------------
    # Initial Water Level: initialized with initial_water_m value across the grid
    h = np.full((N, M), init_water, dtype=np.float64)
    frames = [h.astype(np.float32)]
    rain_in = drained_out = infil_out = 0.0

    region_map_raw = city.get("region_map")
    reg_map = np.asarray(region_map_raw, int) if region_map_raw is not None else None
    num_reg = int(city.get("n_regions", int(reg_map.max()) + 1)) if reg_map is not None else 16
    flux_matrix = np.zeros((num_reg, num_reg), dtype=np.float64) if reg_map is not None else None
    frame_flux = np.zeros((num_reg, num_reg), dtype=np.float64) if reg_map is not None else None
    flux_timeline = [np.zeros((num_reg, num_reg), dtype=np.float64)] if reg_map is not None else []

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
        h, dr, inf, out_dir = step(h, z, r, D, f, k, dt, gain, return_out=True)
        rain_in += r * dt * z.size
        drained_out += dr.sum()
        infil_out += inf.sum()

        # Vectorized Water Attribution: calculate cross-ward boundary fluxes rapidly (Hydraulic Head driven)
        if reg_map is not None:
            # 1. North: [1:, :] -> [:-1, :]
            s_n, t_n, f_n = reg_map[1:, :], reg_map[:-1, :], out_dir[0][1:, :]
            m_n = (s_n != t_n) & (f_n > 0)

            # 2. South: [:-1, :] -> [1:, :]
            s_s, t_s, f_s = reg_map[:-1, :], reg_map[1:, :], out_dir[1][:-1, :]
            m_s = (s_s != t_s) & (f_s > 0)

            # 3. West: [:, 1:] -> [:, :-1]
            s_w, t_w, f_w = reg_map[:, 1:], reg_map[:, :-1], out_dir[2][:, 1:]
            m_w = (s_w != t_w) & (f_w > 0)

            # 4. East: [:, :-1] -> [:, 1:]
            s_e, t_e, f_e = reg_map[:, :-1], reg_map[:, 1:], out_dir[3][:, :-1]
            m_e = (s_e != t_e) & (f_e > 0)

            s_all = np.concatenate([s_n[m_n], s_s[m_s], s_w[m_w], s_e[m_e]])
            t_all = np.concatenate([t_n[m_n], t_s[m_s], t_w[m_w], t_e[m_e]])
            f_all = np.concatenate([f_n[m_n], f_s[m_s], f_w[m_w], f_e[m_e]])

            if len(s_all) > 0:
                pair_idx = s_all * num_reg + t_all
                step_flux = np.bincount(pair_idx, weights=f_all, minlength=num_reg * num_reg).reshape((num_reg, num_reg))
                flux_matrix += step_flux
                frame_flux += step_flux

        if (s + 1) % p["save_every"] == 0:
            frames.append(h.astype(np.float32))
            if reg_map is not None:
                flux_timeline.append(frame_flux.copy())
                frame_flux.fill(0.0)

    # ---- results (DERIVED FROM THE FLOOD MOVIE) -------------------------------------------
    hcube = np.array(frames)                                    # [T, N, M] depth in metres
    mpf = p["save_every"] * dt / 60.0                           # minutes per frame
    t_crit = time_to_critical(hcube, mpf, h_crit)               # [N, M] minutes, NaN if never
    zones, n_zones = critical_zones(t_crit)
    expo = np.clip((hcube - p["h0"]) / (p["h1"] - p["h0"]), 0, 1)
    affected = (expo * np.asarray(city["pop"], float)).sum(axis=(1, 2))   # [T] people
    mass_err = (init_water * z.size) + rain_in - drained_out - infil_out - float(h.sum())
    ever_crit = (hcube >= h_crit).any(axis=0)
    total_pop = float(np.sum(city["pop"]))

    # ---- region-level aggregation (WARD-BASED TRACKING) -----------------------
    region_status = None
    region_affected = None
    region_info = None

    if "region_map" in city:
        region_map = np.asarray(city["region_map"], int)
        n_regions = int(city.get("n_regions", int(region_map.max()) + 1))
        h_warn = p["warn_frac"] * h_crit
        T = len(hcube)
        pop_arr = np.asarray(city["pop"], float)

        reg_status_list = np.zeros((T, n_regions), dtype=np.int8)
        reg_affected_list = np.zeros((T, n_regions), dtype=np.float32)
        reg_depth_list = np.zeros((T, n_regions), dtype=np.float32)
        reg_max_depth_list = np.zeros((T, n_regions), dtype=np.float32)
        reg_info_list = []

        crit_cube = (hcube >= h_crit)
        warn_cube = (hcube >= h_warn)

        for r in range(n_regions):
            mask = (region_map == r)
            cell_count = int(mask.sum())
            reg_total_pop = float(pop_arr[mask].sum())

            if cell_count > 0:
                crit_pct = crit_cube[:, mask].sum(axis=1) / cell_count
                warn_pct = warn_cube[:, mask].sum(axis=1) / cell_count

                # Critical if >5% reach critical threshold, Warning if >5% reach warning threshold
                r_status = np.where(crit_pct > 0.05, 2, np.where(warn_pct > 0.05, 1, 0)).astype(np.int8)
                reg_status_list[:, r] = r_status

                # Exact affected population per region
                r_affected = (expo[:, mask] * pop_arr[mask]).sum(axis=1)
                reg_affected_list[:, r] = r_affected

                # Mean and peak water depth per ward over time
                reg_depth_list[:, r] = hcube[:, mask].mean(axis=1)
                reg_max_depth_list[:, r] = hcube[:, mask].max(axis=1)

                r_avg_z = float(z[mask].mean()) if cell_count > 0 else 0.0
            else:
                r_avg_z = 0.0

            reg_info_list.append({
                "id": r,
                "name": f"Ward {r+1:02d}",
                "code": f"W-{r+1:02d}",
                "cell_count": cell_count,
                "total_pop": reg_total_pop,
                "total_population": reg_total_pop,
                "average_elevation": round(r_avg_z, 2),
            })

        region_status = reg_status_list
        region_affected = reg_affected_list
        region_depth = reg_depth_list
        region_info = reg_info_list

        regional_zones = compute_regional_metrics(
            hcube, t_crit, region_map, pop_arr, expo,
            z=z, flux_matrix=flux_matrix, n_regions=n_regions, h_crit=h_crit
        )

        region_data = [
            {
                "id": r,
                "name": f"Ward {r+1:02d}",
                "code": f"W-{r+1:02d}",
                "depth": [round(float(d), 4) for d in reg_depth_list[:, r]],
                "max_depth": [round(float(d), 4) for d in reg_max_depth_list[:, r]],
                "affected": [round(float(a), 1) for a in reg_affected_list[:, r]],
                "status": [int(s) for s in reg_status_list[:, r]],
                "cell_count": reg_info_list[r]["cell_count"],
                "total_pop": reg_info_list[r]["total_pop"],
                "total_population": reg_info_list[r]["total_population"],
                "average_elevation": reg_info_list[r]["average_elevation"],
                "primary_flood_source": regional_zones.get(str(r), {}).get("primary_flood_source", "Self-Contained"),
                "primary_flood_source_id": regional_zones.get(str(r), {}).get("primary_flood_source_id"),
            }
            for r in range(n_regions)
        ]
    else:
        regional_zones = {}

    out = {
        "h": hcube,
        "status": classify(hcube, h_crit, p["warn_frac"]).astype(np.int8),
        "t_crit": t_crit,
        "zones": regional_zones if region_status is not None else zones,
        "n_zones": n_regions if region_status is not None else n_zones,
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
            "zones": regional_zones,
        },
    }

    if region_status is not None:
        out["region_status"] = region_status
        out["region_affected"] = region_affected
        out["region_depth"] = region_depth
        out["region_data"] = region_data
        out["region_info"] = region_info
        out["n_regions"] = n_regions

        # Topography-Driven Dynamic Conduit Flows (24 edges per frame)
        edge_flows = []
        conduit_pairs = []
        for r in range(4):
            for c in range(3):
                conduit_pairs.append((r * 4 + c, r * 4 + c + 1, f"h-{r}-{c}"))
        for r in range(3):
            for c in range(4):
                conduit_pairs.append((r * 4 + c, (r + 1) * 4 + c, f"v-{r}-{c}"))

        for mat in flux_timeline:
            frame_edges = []
            for u, v, key in conduit_pairs:
                f_uv = float(mat[u, v])
                f_vu = float(mat[v, u])
                net = f_uv - f_vu
                if net > 1e-5:
                    src, tgt, direction = u, v, 1
                    vol = net
                elif net < -1e-5:
                    src, tgt, direction = v, u, -1
                    vol = -net
                else:
                    src, tgt, direction = u, v, 0
                    vol = 0.0
                frame_edges.append({
                    "key": key,
                    "from": u,
                    "to": v,
                    "source": src,
                    "target": tgt,
                    "net_flow": round(float(vol), 4),
                    "flow_u_to_v": round(float(f_uv), 4),
                    "flow_v_to_u": round(float(f_vu), 4),
                    "direction": direction,
                })
            edge_flows.append(frame_edges)

        out["flux_timeline"] = [mat.tolist() for mat in flux_timeline]
        out["edge_flows"] = edge_flows
        out["flux_matrix"] = flux_matrix.tolist()

    return out
import numpy as np
from typing import Dict, Any, Optional

MM_HR = 1.0 / 1000.0 / 3600.0  # converts mm/hr to m/s


def run_ensemble_simulation(
    city: Dict[str, Any],
    intensity_mm_hr: float = 75.0,
    duration_hrs: float = 4.0,
    initial_water_m: float = 0.0,
    drain_failure: bool = False,
    blockage: bool = False,
    n_runs: int = 20,
    critical_depth_m: float = 0.30,
    dt: float = 10.0,
    k: float = 0.01,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Runs an ultra-fast, batched Monte Carlo ensemble simulation (15-20 runs) with
    Gaussian perturbations (+/- 10%) on rainfall intensity and drainage capacity.

    Computes P10, P50, and P90 percentiles of critical breach times (t_crit) for each
    of the 16 city wards in well under 8 seconds.
    """
    z_full = np.asarray(city["z"], dtype=np.float64)
    D_full = np.asarray(city["D"], dtype=np.float64) * MM_HR
    reg_full = np.asarray(city.get("region_map", np.zeros_like(z_full, dtype=int)), dtype=int)
    mask_full = np.asarray(city.get("channel_mask", np.zeros_like(z_full, dtype=bool)), dtype=bool)

    N_orig, M_orig = z_full.shape
    num_reg = int(city.get("n_regions", int(reg_full.max()) + 1))

    # To guarantee execution well under 8 seconds regardless of input grid resolution,
    # downsample to 40x40 if input is larger.
    target_dim = 40
    if N_orig > target_dim or M_orig > target_dim:
        sr = max(1, N_orig // target_dim)
        sc = max(1, M_orig // target_dim)
        z = z_full[::sr, ::sc][:target_dim, :target_dim]
        D_base = D_full[::sr, ::sc][:target_dim, :target_dim]
        region_map = reg_full[::sr, ::sc][:target_dim, :target_dim]
        channel_mask = mask_full[::sr, ::sc][:target_dim, :target_dim]
    else:
        z = z_full.copy()
        D_base = D_full.copy()
        region_map = reg_full.copy()
        channel_mask = mask_full.copy()

    N, M = z.shape
    reg_masks = [(region_map == r) for r in range(num_reg)]

    # Simulation horizon covers storm duration + recession window
    sim_hours = max(duration_hrs + 1.0, 5.0)
    n_steps = int(sim_hours * 3600.0 / dt)

    rng = np.random.default_rng(seed)

    # 1. Perturb rainfall intensity with Gaussian noise (+/- 10% bounds) -> shape [n_runs, 1, 1]
    noise_intensity = np.clip(rng.normal(0.0, 0.05, size=(n_runs, 1, 1)), -0.10, 0.10)
    p_intensity = float(intensity_mm_hr) * (1.0 + noise_intensity) * MM_HR

    # 2. Perturb drainage capacity D with spatial Gaussian noise (+/- 10% bounds) -> shape [n_runs, N, M]
    noise_D = np.clip(rng.normal(0.0, 0.05, size=(n_runs, N, M)), -0.10, 0.10)
    p_D = np.maximum(0.0, D_base[None, :, :] * (1.0 + noise_D))

    # 3. Flow gain multiplier for channels and blockage events -> shape [4, n_runs, N, M]
    gain = np.ones((4, n_runs, N, M), dtype=np.float64)
    if channel_mask.any():
        gain[:, :, channel_mask] = 2.0  # Faster river channel conveyance

    # Water depth state tensor initialized with initial_water_m on low ground (<=20th percentile elevation + channel)
    h = np.zeros((n_runs, N, M), dtype=np.float64)
    if float(initial_water_m) > 0:
        z_thresh = float(np.percentile(z, 20))
        low_mask = (z <= z_thresh) | channel_mask
        h[:, low_mask] = float(initial_water_m)

    breach_times = np.full((n_runs, num_reg), np.nan, dtype=np.float64)
    breached = np.zeros((n_runs, num_reg), dtype=bool)

    alpha = min(0.25, k * dt)

    # Pre-calculated event masks if applicable
    drain_applied = False
    blockage_applied = False

    # Main Batched Simulation Loop
    for s in range(n_steps):
        t_min = s * dt / 60.0

        # Event 1: Drainage Failure at t=60min (60% capacity loss in urban core)
        if drain_failure and not drain_applied and t_min >= 60.0:
            r0, r1 = int(N * 0.55), int(N * 0.85)
            c0, c1 = int(M * 0.20), int(M * 0.80)
            p_D[:, r0:r1, c0:c1] *= 0.40
            drain_applied = True

        # Event 2: River Canal Blockage at t=30min (100% flow & culvert stoppage)
        if blockage and not blockage_applied and t_min >= 30.0:
            mid_r = int(N * 0.72)
            mid_c = int(M / 2 + np.sin(mid_r / (N * 0.10)) * (M / 6))
            w = max(2, int(4 * M / 400.0) + int(mid_r / (N / 4)))
            c_start = max(0, mid_c - w - 1)
            c_end = min(M, mid_c + w + 2)
            for br in (mid_r, min(N - 1, mid_r + 1)):
                gain[:, :, br, c_start:c_end] = 0.0
                p_D[:, br, c_start:c_end] = 0.0
            blockage_applied = True

        # 1. Rain input (stops after duration_hrs)
        r_step = p_intensity if (t_min / 60.0) < duration_hrs else 0.0
        h = h + r_step * dt

        # 2. Vectorized 4-directional flow across all ensemble runs
        H = z[None, :, :] + h
        Hp = np.pad(H, ((0, 0), (1, 1), (1, 1)), mode="edge")
        nbr = [
            Hp[:, :-2, 1:-1],  # North
            Hp[:, 2:, 1:-1],   # South
            Hp[:, 1:-1, :-2],  # West
            Hp[:, 1:-1, 2:],   # East
        ]

        out = np.stack([alpha * np.maximum(0.0, H - Hn) for Hn in nbr])  # [4, n_runs, N, M]
        out = out * gain

        total_out = out.sum(axis=0)
        out *= np.minimum(1.0, h / np.maximum(total_out, 1e-12))

        inflow = np.zeros_like(h)
        inflow[:, :-1, :] += out[0, :, 1:, :]
        inflow[:, 1:, :]  += out[1, :, :-1, :]
        inflow[:, :, :-1] += out[2, :, :, 1:]
        inflow[:, :, 1:]  += out[3, :, :, :-1]

        h = h - out.sum(axis=0) + inflow

        # 3. Drainage
        drained = np.minimum(p_D * dt, h)
        h = h - drained

        # 4. Check critical ward breaches every 6 steps (every 1 minute)
        if s % 6 == 0:
            for r in range(num_reg):
                mask = reg_masks[r]
                if mask.any():
                    # Mean water depth in region r for all runs: shape (n_runs,)
                    reg_mean_depth = h[:, mask].mean(axis=1)
                    new_breaches = (~breached[:, r]) & (reg_mean_depth >= critical_depth_m)
                    if new_breaches.any():
                        breached[new_breaches, r] = True
                        breach_times[new_breaches, r] = t_min

            # If all runs and all wards have breached, terminate early
            if breached.all():
                break

    # Calculate P10, P50, P90 percentiles per ward
    ward_results = {}
    for r in range(num_reg):
        times = breach_times[:, r]
        valid_times = times[~np.isnan(times)]
        ward_code = f"W-{r+1:02d}"
        ward_name = f"Ward {r+1:02d}"

        if len(valid_times) > 0:
            p10 = round(float(np.percentile(valid_times, 10)), 1)
            p50 = round(float(np.percentile(valid_times, 50)), 1)
            p90 = round(float(np.percentile(valid_times, 90)), 1)
            breach_prob = round(float(len(valid_times) / n_runs), 2)
            is_breached = True
            warning_text = (
                f"CRITICAL WARNING: Ward projected to reach critical levels in ~{round(p50)} mins. "
                f"(Confidence Interval P10-P90: {round(p10)}m to {round(p90)}m)"
            )
        else:
            p10 = None
            p50 = None
            p90 = None
            breach_prob = 0.0
            is_breached = False
            warning_text = "SAFE: Ward projected to remain below critical depth throughout simulation window."

        ward_results[str(r)] = {
            "ward_id": r,
            "ward_code": ward_code,
            "ward_name": ward_name,
            "breached": is_breached,
            "breach_probability": breach_prob,
            "p10": p10,
            "p50": p50,
            "p90": p90,
            "warning_text": warning_text,
            "runs_breached": int(len(valid_times)),
            "total_runs": n_runs,
        }

    return {
        "n_runs": n_runs,
        "intensity_mm_hr": float(intensity_mm_hr),
        "duration_hrs": float(duration_hrs),
        "initial_water_m": float(initial_water_m),
        "drain_failure": bool(drain_failure),
        "blockage": bool(blockage),
        "critical_depth_m": float(critical_depth_m),
        "wards": ward_results,
    }

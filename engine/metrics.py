import numpy as np
from scipy.ndimage import label

def classify(h, h_crit=0.5, warn_frac=0.5):
    """0 = Safe, 1 = Warning, 2 = Critical. h can be [T,N,M] or [N,M]."""
    return np.digitize(h / h_crit, [warn_frac, 1.0])

def time_to_critical(h, minutes_per_frame, h_crit=0.5):
    """Minutes until each cell first reaches h_crit; NaN if it never does. h is [T,N,M]."""
    crit = h >= h_crit
    first = crit.argmax(axis=0)                   # index of first True along time (0 if none)
    return np.where(crit.any(axis=0), first * minutes_per_frame, np.nan)

def critical_zones(t_crit):
    """Group touching critical cells into numbered zones. Returns (zone_map, n_zones)."""
    return label(~np.isnan(t_crit))

def compute_regional_metrics(hcube, t_crit, region_map, pop_arr, expo, z=None, flux_matrix=None, n_regions=16, h_crit=0.5):
    """
    Computes per-ward statistics across all 16 regions:
    For each region r:
      - t_crit: exact minute the region first hits the critical depth threshold (or None)
      - peak_depth: maximum water depth (metres) reached anywhere in the region
      - affected_population: peak affected population for the region
      - total_population / total_pop: total resident count for the region
      - average_elevation: mean terrain elevation (metres above datum)
      - primary_flood_source: ID of neighboring region that dumped the most water into it
    Returns a zones dictionary mapping region ID to per-ward metrics.
    """
    zones_dict = {}
    pop_arr = np.asarray(pop_arr, float)
    region_map = np.asarray(region_map, int)
    z_arr = np.asarray(z, float) if z is not None else None
    f_mat = np.asarray(flux_matrix, float) if flux_matrix is not None else None

    for r in range(n_regions):
        mask = (region_map == r)
        cell_count = int(mask.sum())

        if cell_count > 0:
            cell_t = t_crit[mask]
            valid_t = cell_t[~np.isnan(cell_t)]
            r_t_crit = float(np.nanmin(valid_t)) if len(valid_t) > 0 else None
            r_peak_depth = float(hcube[:, mask].max())
            r_affected = float((expo[:, mask] * pop_arr[mask]).sum(axis=1).max())
            r_total_pop = float(pop_arr[mask].sum())
            r_avg_elevation = float(z_arr[mask].mean()) if z_arr is not None else 0.0
        else:
            r_t_crit = None
            r_peak_depth = 0.0
            r_affected = 0.0
            r_total_pop = 0.0
            r_avg_elevation = 0.0

        # Vectorized Water Attribution: determine Primary Flood Source
        if f_mat is not None and f_mat.shape == (n_regions, n_regions):
            inflow_vec = f_mat[:, r].copy()
            inflow_vec[r] = 0.0  # exclude intra-ward self-flux
            if inflow_vec.max() > 0:
                src_id = int(np.argmax(inflow_vec))
                primary_source = f"Ward-{src_id + 1:02d}"
                primary_source_id = src_id
                primary_inflow_vol = float(inflow_vec[src_id])
            else:
                primary_source = "Self-Contained"
                primary_source_id = None
                primary_inflow_vol = 0.0
        else:
            primary_source = "Self-Contained"
            primary_source_id = None
            primary_inflow_vol = 0.0

        zones_dict[str(r)] = {
            "id": int(r),
            "name": f"Ward {r+1:02d}",
            "code": f"W-{r+1:02d}",
            "t_crit": r_t_crit,
            "peak_depth": round(r_peak_depth, 4),
            "affected_population": round(r_affected, 1),
            "total_pop": round(r_total_pop, 1),
            "total_population": round(r_total_pop, 0),
            "average_elevation": round(r_avg_elevation, 2),
            "cell_count": cell_count,
            "primary_flood_source": primary_source,
            "primary_flood_source_id": primary_source_id,
            "primary_inflow_volume": round(primary_inflow_vol, 2),
        }

    return zones_dict
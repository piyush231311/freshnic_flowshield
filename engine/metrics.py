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
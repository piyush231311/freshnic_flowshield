# API Contract & System Specification

**Document Version:** 1.0.0  
**Target:** FlowShield Flood Simulation Platform  
**Purpose:** Formal API contract between Person A (Core Engine & Data) and Person B (Front-End & UI) to enable parallel, unblocked development.

---

## 1. Division of Labor

To maintain clear separation of concerns and avoid merge conflicts during rapid iteration:

| Role | Engineer | Scope & Responsibilities |
| :--- | :--- | :--- |
| **Core Engine & Data** | **Person A** | • Mathematical simulation core (`engine/`): hydrodynamic step simulation, infiltration, flow dynamics, and metrics.<br>• Data input generation, synthetic city generators, and terrain/drainage preprocessing.<br>• Automated test suite (`tests/`): numerical validation, mass balance checks, and regression tests. |
| **Front-End & UI** | **Person B** | • Streamlit application and dashboard architecture.<br>• Interactive 2D/3D map visualizations, terrain layers, and flood depth overlays.<br>• Interactive time slider, scenario selection widgets, metric KPI cards, and alert components.<br>• Consuming engine endpoints strictly conforming to this contract. |

---

## 2. Function Signature: `run_scenario()`

The core entry point imported and called by the front-end is:

```python
from engine.run import run_scenario

result = run_scenario(city: dict, scenario: dict, params: dict | None = None) -> dict
```

---

## 3. Data Inputs

### 3.1. The `city` Dictionary

The `city` dictionary represents the spatial domain, topography, drainage infrastructure, and population distribution of the simulated area.

> **Crucial Invariant:** All array attributes in `city` **MUST** be 2-dimensional NumPy arrays sharing the **exact same shape `[N, M]`** (where $N$ = rows, $M$ = columns).

| Key | Type | Shape | Units / Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `"z"` | `np.ndarray` (`float64` / `float32`) | `[N, M]` | Metres ($m$) | Ground surface elevation map. Water flows gravitationally down total hydraulic head ($z + h$). |
| `"D"` | `np.ndarray` (`float64` / `float32`) | `[N, M]` | Millimetres / hour ($mm/hr$) | Storm-drain design capacity for each grid cell. |
| `"channel_mask"` | `np.ndarray` (`bool`) | `[N, M]` | `True` / `False` | Boolean mask identifying fast-flowing channels, streams, rivers, or culverts. |
| `"pop"` | `np.ndarray` (`float64` / `float32`) | `[N, M]` | Persons (count $\ge 0$) | Population distribution count residing within each grid cell. |

#### Example `city` Schema
```python
import numpy as np

city = {
    "z": np.zeros((50, 50), dtype=float),             # [50, 50] elevation in metres
    "D": np.full((50, 50), 20.0, dtype=float),        # [50, 50] drainage capacity in mm/hr
    "channel_mask": np.zeros((50, 50), dtype=bool),   # [50, 50] boolean channel indicators
    "pop": np.ones((50, 50), dtype=float) * 200.0     # [50, 50] population per cell
}
```

---

### 3.2. The `scenario` Dictionary

The `scenario` dictionary configures the meteorological conditions (rainfall hyetograph) and scheduled infrastructure disruptions.

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `"name"` | `str` | Yes | Human-readable scenario name (e.g., `"Extreme + drain failure"`). |
| `"rain"` | `dict` | Yes | Precipitation configuration defining intensity over time. |
| `"events"` | `list[dict]` | Yes | Chronological list of disruption events scheduled during simulation. |
| `"initial_water_m"` | `float` | No | Initial standing water depth in metres applied to low ground ($\le 20\text{th}$ percentile elevation and channels). Default: `0.0`. |

#### 3.2.1. Rain Configuration (`scenario["rain"]`)

The rainfall intensity profile is configured via one of three shapes:

1. **Constant Storm:**
   ```python
   {
       "shape": "constant",
       "peak_mm_hr": 8.0,      # Rainfall intensity in mm/hr
       "duration_h": 3.0       # Duration in hours
   }
   ```

2. **Triangular Storm (Rises to peak at mid-storm, then falls):**
   ```python
   {
       "shape": "triangular",
       "peak_mm_hr": 60.0,     # Peak rainfall intensity in mm/hr at duration / 2
       "duration_h": 3.0       # Duration in hours
   }
   ```

3. **Discrete Time Series:**
   ```python
   {
       "shape": "series",
       "mm_hr": [10.0, 25.0, 50.0, 30.0, 5.0]  # Hourly rainfall rates in mm/hr
   }
   ```

#### 3.2.2. Disruption Events (`scenario["events"]`)

Each entry in `events` represents an infrastructure failure occurring at a specified time:

| Event Type (`"type"`) | Spatial Specification | Disruption Metric | Description |
| :--- | :--- | :--- | :--- |
| `"drain_failure"` | `"cells"` or `"region"` | `"loss"` (`float` in $[0.0, 1.0]$) | Drains in target area lose specified fraction of capacity ($D \times (1 - \text{loss})$). |
| `"blockage"` | `"cells"` or `"region"` | `"severity"` (`float` in $[0.0, 1.0]$) | Channel or culvert blockage: restricts flow ($gain \times (1 - \text{severity})$) and drainage. |

**Spatial Targeting Options:**
- **Cell list:** `"cells": [(r0, c0), (r1, c1), ...]` (list of row-column tuples)
- **Bounding Box:** `"region": (row_min, row_max, col_min, col_max)` (slice tuple $[r_0:r_1, c_0:c_1]$)
- **Boolean Mask:** `"region": np.ndarray[N, M]` (2D boolean array)

**Activation Time:**
- `"t_start_min"`: `float` or `int` (simulation time in minutes at which the event triggers).

#### Example `scenario` Schema
```python
scenario = {
    "name": "Heavy + drain failure + channel blockage",
    "rain": {
        "shape": "triangular",
        "peak_mm_hr": 60.0,
        "duration_h": 3.0
    },
    "events": [
        {
            "type": "drain_failure",
            "region": (30, 45, 10, 40),
            "loss": 0.6,
            "t_start_min": 60.0
        },
        {
            "type": "blockage",
            "cells": [(41, 25), (42, 25)],
            "severity": 1.0,
            "t_start_min": 30.0
        }
    ]
}
```

---

### 3.3. Optional Simulation Overrides (`params`)

When `params` is provided to `run_scenario(city, scenario, params)`, it overrides default parameters in `engine.run.DEFAULTS`:

| Parameter | Default | Type | Description |
| :--- | :--- | :--- | :--- |
| `hours` | `6.0` | `float` | Simulated horizon in hours (storm + recession). |
| `dt` | `10.0` | `float` | Internal simulation time step in seconds. |
| `k` | `0.005` | `float` | Flow coefficient ($1/s$). Base fraction of head difference transferred per step. |
| `channel_gain`| `4.0` | `float` | Outflow multiplier for cells marked in `channel_mask`. |
| `f_mmhr` | `2.0` | `float` | Soil infiltration rate ($mm/hr$). |
| `save_every` | `30` | `int` | Output frame interval in steps (e.g., $30 \times 10s = 300s = 5$ min). |
| `h_crit` | `0.5` | `float` | Critical flood depth threshold in metres ($m$). |
| `warn_frac` | `0.5` | `float` | Warning status threshold as a fraction of `h_crit` ($h \ge warn\_frac \times h\_crit$). |
| `h0` | `0.10` | `float` | Lower bound for affected population ramp ($0\%$ affected at $\le h_0$). |
| `h1` | `0.50` | `float` | Upper bound for affected population ramp ($100\%$ affected at $\ge h_1$). |

---

## 4. The Engine Output (`run_scenario()` Return Value)

The function returns a Python dictionary containing temporal arrays, spatial matrices, and scalar summary statistics.

Let $T$ be the total number of saved time frames:
$$T = 1 + \left\lfloor \frac{\text{hours} \times 3600}{\text{dt} \times \text{save\_every}} \right\rfloor$$
*(e.g., for 6 hours, $dt = 10s$, $save\_every = 30$, $T = 1 + \frac{21600}{300} = 73$ frames).*

| Output Key | Data Type | Dimensions | Physical Unit / Encoding | Description |
| :--- | :--- | :--- | :--- | :--- |
| `"h"` | `np.ndarray` (`float32`) | `[T, N, M]` | Metres ($m$) | Complete spatio-temporal flood depth cube. `h[t, r, c]` is the water depth at frame `t` in cell `(r, c)`. |
| `"status"` | `np.ndarray` (`int8`) | `[T, N, M]` | Enum: `{0, 1, 2}` | Spatio-temporal severity classification:<br>• `0` = Safe ($h < warn\_frac \cdot h_{crit}$)<br>• `1` = Warning ($warn\_frac \cdot h_{crit} \le h < h_{crit}$)<br>• `2` = Critical ($h \ge h_{crit}$) |
| `"t_crit"` | `np.ndarray` (`float64`) | `[N, M]` | Minutes ($min$) | Time when each cell first reaches critical depth $h_{crit}$. Contains `np.nan` for cells that never reach $h_{crit}$. |
| `"zones"` | `np.ndarray` (`int32`) | `[N, M]` | Integer ID | Morphological connected components grouping contiguous critical cells into numbered danger zones ($0$ = safe/non-critical). |
| `"n_zones"` | `int` | Scalar | Count | Total number of distinct critical zones identified across the city. |
| `"affected_pop"` | `np.ndarray` (`float64`) | `[T]` | Persons | Estimated total affected population at each saved time frame $t \in [0, T-1]$. |
| `"times_min"` | `np.ndarray` (`float64`) | `[T]` | Minutes ($min$) | Simulation timestamp in minutes corresponding to each frame $t$: `[0.0, 5.0, 10.0, ...]`. |
| `"rain_mmhr"` | `np.ndarray` (`float64`) | `[T]` | Millimetres / hour ($mm/hr$) | Rainfall intensity at each saved frame. |
| `"summary"` | `dict` | Scalar dict | Key-Value Metrics | High-level KPI summary dictionary (defined below). |

### 4.1. The `"summary"` Dictionary

Designed for instant rendering of KPI cards and dashboard header metrics:

| Key | Type | Description |
| :--- | :--- | :--- |
| `"scenario"` | `str` | Scenario identifier from `scenario["name"]`. |
| `"peak_depth_m"` | `float` | Maximum water depth observed across all cells and frames ($\max(h)$). |
| `"critical_cells"` | `int` | Count of unique cells that ever exceeded $h_{crit}$ during the run. |
| `"first_critical_min"` | `float` or `None` | Earliest time in minutes any cell breached $h_{crit}$ (`None` if no cells breached). |
| `"first_ward_critical_min"` | `float` or `None` | Earliest time in minutes any ward reached critical status (`None` if no wards breached). |
| `"median_t_crit_min"` | `float` or `None` | Median time to critical depth across all cells that breached $h_{crit}$ (`None` if no cells breached). |
| `"peak_affected"` | `float` | Maximum number of affected people at the worst time frame. |
| `"peak_affected_pct"` | `float` | Maximum affected population expressed as percentage of total city population. |
| `"mass_err"` | `float` | Conservation of mass balance error in cubic metres equivalent. |
| `"mass_err_rel"` | `float` | Relative mass error fraction ($< 10^{-9}$ in valid simulations). |

---

## 5. Front-End Mock / Stand-In Data for Person B

To allow Person B to develop the Streamlit dashboard immediately without waiting for Person A or running full simulations, the following mock generator produces valid synthetic data matching this contract:

```python
import numpy as np

def generate_mock_results(n_rows: int = 50, n_cols: int = 50, n_frames: int = 73) -> dict:
    """Generates synthetic engine output conforming to the CONTRACT.md specification."""
    times_min = np.linspace(0.0, 360.0, n_frames)
    
    # Generate synthetic depth frames (e.g. rising then receding)
    wave = np.sin(np.linspace(0, np.pi, n_frames))[:, None, None]
    spatial_blob = np.exp(-(((np.arange(n_rows)[:, None] - 25)**2 + (np.arange(n_cols)[None, :] - 25)**2) / 150))
    h = (0.8 * wave * spatial_blob[None, :, :]).astype(np.float32)
    
    # Classify status: 0=Safe (<0.25m), 1=Warning (0.25-0.5m), 2=Critical (>=0.5m)
    status = np.zeros_like(h, dtype=np.int8)
    status[h >= 0.25] = 1
    status[h >= 0.50] = 2
    
    # t_crit: first time >= 0.5m
    crit_mask = h >= 0.50
    t_crit = np.where(crit_mask.any(axis=0), 
                      times_min[crit_mask.argmax(axis=0)], 
                      np.nan)
    
    zones = (crit_mask.any(axis=0)).astype(np.int32)
    n_zones = int(zones.max())
    
    affected_pop = (h.max(axis=(1, 2)) * 12500.0).astype(float)
    rain_mmhr = 60.0 * np.sin(np.linspace(0, np.pi, n_frames))
    
    return {
        "h": h,
        "status": status,
        "t_crit": t_crit,
        "zones": zones,
        "n_zones": n_zones,
        "affected_pop": affected_pop,
        "times_min": times_min,
        "rain_mmhr": rain_mmhr,
        "summary": {
            "scenario": "Mock Scenario",
            "peak_depth_m": float(h.max()),
            "critical_cells": int((h >= 0.5).any(axis=0).sum()),
            "first_critical_min": float(np.nanmin(t_crit)) if np.any(~np.isnan(t_crit)) else None,
            "peak_affected": float(affected_pop.max()),
            "peak_affected_pct": float(100 * affected_pop.max() / 500_000),
            "mass_err": 0.0,
            "mass_err_rel": 0.0,
        }
    }
```

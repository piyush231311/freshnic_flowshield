# FlowShield Hydrological & Simulation Assumptions

This document records the physical, numerical, and engineering assumptions governing the FlowShield simulation engine, calibrated stress scenarios, and infrastructure failure models.

---

## 1. Topography, Infiltration & Initial Conditions

### 1.1. Elevation & Drainage Domain
- **Grid Resolution:** Default $80 \times 80$ grid (benchmark matrix uses $40 \times 40$ for sub-second execution).
- **Elevation Range:** Ground elevation $z$ spans synthetic coastal/riverine terrain with an east-west gradient, meandering river channel, and localized urban depressions.
- **Hydraulic Head Routing:** Surface water routing is head-driven ($\Delta(z + h)$) using a 4-neighbor finite-difference approximation with base flow transfer coefficient $k = 0.005\text{ s}^{-1}$ and channel velocity gain multiplier $4.0\times$.

### 1.2. Soil Infiltration & Dynamic Saturation
- **Heterogeneous Soil Profiles:**
  - *Green / Parks (W-01 to W-04):* Permeable sandy loam, $f = 15\text{--}25\text{ mm/hr}$, $S_{\max} = 120\text{ mm}$.
  - *Dense Residential (W-06, W-14):* Semi-permeable silt loam, $f = 5\text{--}10\text{ mm/hr}$, $S_{\max} = 60\text{ mm}$.
  - *Impervious Urban Core (W-10, W-11, W-16):* Concrete/asphalt, $f = 0.5\text{--}2.0\text{ mm/hr}$, $S_{\max} = 15\text{ mm}$.
- **Step-by-Step Saturation:**
  At each timestep $\Delta t = 10\text{ s}$, infiltration rate is constrained by surface water availability, maximum infiltration rate, and remaining soil capacity:
  $$\Delta h_{\text{infil}} = \min\left(h, \; S_{\max} - d_{\text{absorbed}}, \; \frac{f_{\text{rate}}}{1000 \times 3600} \Delta t\right)$$
  Cumulative absorbed depth is tracked per cell and serialized into ward telemetry.

### 1.3. Initial Standing Water (`initial_water_m`)
- **Low-Ground Masking:** Rather than broadcasting standing water across elevated hilltops, `initial_water_m` is applied exclusively to low-elevation cells ($\le 20\text{th}$ percentile elevation) and channel cells ($z \le \text{percentile}(z, 20) \lor \text{channel\_mask}$).
- **Conservation of Mass:** Initial water volume is computed from $\sum h(t=0)$ rather than assuming $N \times M \times \text{depth}$, maintaining exact mass conservation ($|\text{mass\_err\_rel}| < 10^{-14}$).

---

## 2. Calibrated Stress Scenarios (Phase 1)

The stress scenario matrix provides a monotonic progression of flood impact while isolating failure modes under controlled rainfall envelopes:

| Scenario ID | Rainfall Rate | Duration | Initial Water | Drain Failure | Canal Blockage | Expected Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `normal_baseline` | $10\text{ mm/hr}$ | $3.0\text{ h}$ | $0.0\text{ m}$ | None | None | **Controlled Safe Baseline.** Drains and channels absorb/route 100% of runoff. 0 critical cells, 0 affected citizens. |
| `moderate_blocked` | $30\text{ mm/hr}$ | $4.0\text{ h}$ | $0.0\text{ m}$ | None | 100% at $t=30\text{m}$ | **Canal Failure Mode.** Compares against identical 30 mm/hr storm. Culvert blockage causes upstream backwater surcharge and localized inundation. |
| `heavy_drain_failure` | $30\text{ mm/hr}$ | $4.0\text{ h}$ | $0.0\text{ m}$ | 60% at $t=60\text{m}$ | None | **Drain Failure Mode.** Compares against identical 30 mm/hr storm. Urban core loses 60% drainage capacity, causing widespread shallow surface flooding. |
| `extreme_flashburst` | $60\text{ mm/hr}$ | $4.0\text{ h}$ | $0.0\text{ m}$ | None | None | **Severe Meteorological Event.** 100-year convective cloudburst. Natural channels breach banks; multi-ward critical inundation. |
| `extreme_compound` | $60\text{ mm/hr}$ | $4.0\text{ h}$ | $0.15\text{ m}$ | 60% at $t=60\text{m}$ | 100% at $t=30\text{m}$ | **Compound Catastrophe.** Identical 60 mm/hr storm compounded with pre-saturated lowlands and dual infrastructure failures. Maximum depth and affected population. |

---

## 3. Dynamic Narrative Generation

Scenario descriptions displayed in `/api/stress-matrix` are dynamically generated from computed hydrodynamic outputs:
- Real-time peak depth ($m$).
- Affected population count.
- Count of critical wards ($\text{status} = 2$).
- Time to first critical breach ($T+x\text{ min}$).

Static labels (`title`, `subtitle`, `id`) remain invariant to satisfy frontend layout contracts.

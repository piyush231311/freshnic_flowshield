# FlowShield: Urban Flash Flood & Infrastructure Failure Simulation Engine

FlowShield is a high-performance, 2D hydrodynamic simulation and disaster intelligence platform designed to model urban flash flooding, compound infrastructure disruptions, and population vulnerability in real time.

---

## 1. Problem Statement

Urban centers globally face mounting risks from catastrophic flash flood events driven by climate change and extreme precipitation. Traditional urban flood modeling presents severe bottlenecks:
- **High Computational Latency:** Conventional 3D and 2D Saint-Venant hydraulic solvers often require hours or days to converge, rendering them unusable during live storm events and rapid civil defense decision-making.
- **Neglect of Compound Failures:** Flood models often assume static, perfectly functioning drainage infrastructure. In reality, urban disasters are compounded by **infrastructure failures**—such as culvert blockages, storm-drain siltation, backflow, and pump station electrical outages.
- **Disconnect from Human Impact:** Standard hydrological outputs (water depth $h$ and velocity $v$) fail to translate directly into operational metrics that emergency managers need: *Which neighborhoods will become submerged first? When is the critical evacuation window? How many people are at immediate risk?*

**FlowShield** bridges this gap. It couples a vectorized 2D hydrodynamic physics engine with dynamic infrastructure failure modeling and vulnerability analytics, returning high-resolution spatial flood dynamics and actionable crisis metrics in seconds.

---

## 2. Core Physics & Simulation Architecture

FlowShield models the urban domain as a 2D digital elevation grid of dimensions $[N, M]$, where each cell $(r, c)$ possesses an elevation $z(r, c)$, storm-drain capacity $D(r, c)$, infiltration rate $f(r, c)$, and population count $pop(r, c)$.

The simulation advances over time horizon $T$ via a finite-difference discretization loop with time step $\Delta t$ (default: $10.0$ seconds).

```
                                ┌───────────────────────────┐
                                │   1. Water Accumulation   │
                                │    h += rain(t) * dt      │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │  2. Surface Flow Routing  │
                                │   H = z + h (Hydraulic)   │
                                │   outflow = alpha*(H - Hn)│
                                │   h += inflow - outflow   │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │   3. Drainage Extraction  │
                                │  drained = min(D*dt, h)   │
                                │       h -= drained        │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │  4. Infiltration Loss     │
                                │   infil = min(f*dt, h)    │
                                │        h -= infil         │
                                └─────────────┬─────────────┘
                                              │
                                              ▼
                                ┌───────────────────────────┐
                                │ 5. Mass Balance & Metrics │
                                │   mass_err < 1e-9         │
                                │   classify -> t_crit      │
                                └───────────────────────────┘
```

### 2.1. Step 1: Water Accumulation (Precipitation)
At step $s$, rainfall intensity $r(s)$ (converted from $\text{mm/hr}$ to $\text{m/s}$) deposits uniform water depth across the terrain:
$$h(r, c) \leftarrow h(r, c) + r(s) \cdot \Delta t$$

Rainfall profiles support:
- **Constant:** Sustained baseline intensity over duration $d$.
- **Triangular:** Realistic storm hydrograph peaking at $t = d/2$ before receding.
- **Time Series:** Hourly hyetographs ingested from live meteorological feeds (e.g., Open-Meteo).

### 2.2. Step 2: Surface Flow Dynamics (Gravitational Routing)
Water flows gravitationally across cells according to the total hydraulic head $H$:
$$H(r, c) = z(r, c) + h(r, c)$$

For each cell, the hydraulic head difference against its 4 cardinal neighbors (North, South, West, East) determines potential outflow:
$$\Delta H_i = \max(0, H - H_{\text{neighbor}, i}), \quad i \in \{N, S, W, E\}$$

$$\text{outflow}_i = \alpha \cdot \Delta H_i \cdot \text{gain}_i$$

- **Stability Limit ($\alpha$):** To ensure numerical stability and prevent artificial oscillations (CFL condition analogue), $\alpha$ is bounded:
  $$\alpha = \min(0.25, k \cdot \Delta t)$$
  where $k$ is the base kinematic flow coefficient ($s^{-1}$).
- **Fast Channels ($\text{gain}$):** Cells flagged in `channel_mask` (rivers, drainage canals, concrete culverts) accelerate conveyance via an outflow multiplier ($\text{gain} = 4.0$).
- **Closed Boundary Conditions:** Terrain boundaries are padded with edge values, preventing artificial mass leakage outside the modeled city.
- **Physical Conservation Limiter:** A cell cannot discharge more water than its current depth $h$:
  $$\text{outflow} \leftarrow \text{outflow} \times \min\left(1.0, \frac{h}{\sum_{i} \text{outflow}_i + \varepsilon}\right)$$
- **Inflow Update:** Outflow directed to neighbors is collected as inflow:
  $$h \leftarrow h - \sum_{i} \text{outflow}_i + \sum \text{inflow}$$

### 2.3. Step 3: Storm-Drain Extraction
Water enters municipal storm drains up to local design capacity $D(r, c)$ ($\text{m/s}$):
$$drained = \min(D \cdot \Delta t, h)$$
$$h \leftarrow h - drained$$

### 2.4. Step 4: Soil Infiltration
Pervious ground absorbs water up to infiltration capacity $f$ ($\text{m/s}$):
$$infil = \min(f \cdot \Delta t, h)$$
$$h \leftarrow h - infil$$

### 2.5. Dynamic Infrastructure Disruption Events
During simulation, scheduled disaster events alter physical parameters in real time:
- **Drainage Failure (`drain_failure`):** Siltation, debris buildup, or electrical pump trips reduce localized drainage capacity:
  $$D_{\text{affected}} \leftarrow D \times (1 - \text{loss})$$
- **Channel Blockage (`blockage`):** Culvert collapses or bridge debris dams obstruct flow and disable drainage:
  $$\text{gain}_{\text{affected}} \leftarrow \text{gain} \times (1 - \text{severity})$$
  $$D_{\text{affected}} \leftarrow D \times (1 - \text{severity})$$

### 2.6. Mass Conservation Invariant
To ensure physical validity, FlowShield continuously tracks global mass balance:
$$\text{Mass Error} = \sum \text{Rainfall}_{\text{in}} - \sum \text{Drainage}_{\text{out}} - \sum \text{Infiltration}_{\text{out}} - \sum h$$
The automated test suite verifies that relative mass error satisfies:
$$\frac{|\text{Mass Error}|}{\sum \text{Rainfall}_{\text{in}}} < 10^{-9}$$

---

## 3. Vulnerability & Emergency Response Metrics

Beyond raw water depths, the engine derives actionable decision metrics:

1. **Hazard Classification (`status`):**
   - **$0$ (Safe):** $h < \text{warn\_frac} \cdot h_{\text{crit}}$ ($< 0.25\text{m}$)
   - **$1$ (Warning):** $\text{warn\_frac} \cdot h_{\text{crit}} \le h < h_{\text{crit}}$ ($0.25\text{m} - 0.50\text{m}$)
   - **$2$ (Critical):** $h \ge h_{\text{crit}}$ ($\ge 0.50\text{m}$, dangerous to vehicles and pedestrians)
2. **Time-to-Critical ($t_{\text{crit}}$):** Exact simulation minute when a cell first breaches critical depth ($h \ge 0.5\text{m}$). Allows emergency services to map evacuation lead times.
3. **Morphological Danger Zones (`zones`, `n_zones`):** Contiguous clusters of critical cells are grouped using 8-connectivity connected-component labeling (`scipy.ndimage.label`) to identify isolated islands and primary disaster hotspots.
4. **Impacted Population (`affected_pop`):** Calculated using a continuous exposure ramp:
   $$\text{Exposure}(h) = \text{clip}\left(\frac{h - h_0}{h_1 - h_0}, 0, 1\right)$$
   $$\text{Affected Population}(t) = \sum_{r,c} \left( \text{Exposure}(h(t, r, c)) \times pop(r, c) \right)$$
   *(where $h_0 = 0.10\text{m}$ represents onset of disruption and $h_1 = 0.50\text{m}$ represents full displacement).*

---

## 4. Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | **Python 3.11+** | Modern typed, performant base runtime. |
| **Numerical Computing** | **NumPy** | High-performance vectorized 2D/3D array physics, finite-difference hydraulic routing, and mass conservation. |
| **Spatial Image Processing** | **SciPy (`scipy.ndimage`)** | Connected component labeling (`label`) for critical zone clustering and Gaussian spatial filters for terrain synthesis. |
| **Automated Testing** | **Pytest** | Regression test suite verifying numerical stability, mass conservation ($<10^{-9}$), monotonicity of failure events, and strict API contract conformity. |
| **Weather Ingestion** | **Requests** | Ingestion of live and forecasted precipitation data from the **Open-Meteo API**. |
| **Interactive Dashboard** | **Streamlit** | Rapid, reactive web application framework for scenario controls, event scheduling, and KPI displays. |
| **Data Visualization** | **Plotly** | Interactive 2D flood heatmaps, 3D digital elevation surface meshes, hydrograph time-series, and dynamic time slider integration. |

---

## 5. Repository Structure

```
Freshnic_Flowshield/
├── CONTRACT.md           # Strict API contract between Person A (Engine) and Person B (UI)
├── README.md             # System architecture, physics loop, and tech stack documentation
├── demo_scenario.py      # Multi-scenario benchmarking script comparing baseline vs disruptions
├── run_full_sim.py       # Full-scale simulation runner with live Open-Meteo or scripted storms
├── engine/               # Core mathematical simulation engine (Person A)
│   ├── __init__.py
│   ├── run.py            # Primary run_scenario() entry point, event scheduling, result packaging
│   ├── simulate.py       # Vectorized 2D hydrodynamic step() loop and flux routing
│   ├── metrics.py        # Hazard classification, time-to-critical, and critical zone labeling
│   ├── city_generator.py # Advanced procedural city & terrain generator (Perlin noise, channels, pop)
│   └── rainfall.py       # Scripted storm presets and live Open-Meteo API weather fetching
└── tests/                # Automated verification and test suite (Person A)
    ├── __init__.py
    ├── toy_city.py       # Synthetic city generator (topography, drainage network, population)
    └── test_run.py       # Unit & integration tests (physics, mass balance, contract validation)
```

---

## 6. Getting Started

### 6.1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/piyush231311/freshnic_flowshield.git
cd freshnic_flowshield

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install requirements
pip install numpy scipy pytest requests streamlit plotly
```

### 6.2. Running Automated Tests

Verify physics equations, mass conservation, and contract adherence:

```bash
pytest tests/ -v
```

### 6.3. Running the Simulations

Execute the benchmark suite comparing normal rain, heavy storms, and compound infrastructure failures:

```bash
python demo_scenario.py
```

Or run the full-scale $200 \times 200$ grid simulation with procedural city generation and live weather:

```bash
python run_full_sim.py
```

Sample benchmark output:
```
scenario                      peak m  crit cells  first crit  affected   % pop
1 Normal                        0.00           0           -         0     0.0
2 Heavy                         0.74         214      75 min    63,450    12.7
3 Heavy + drain failure         0.89         382      65 min    98,210    19.6
4 Heavy + blocked channel       0.81         298      70 min    79,140    15.8
5 Extreme + both                1.22         641      45 min   184,320    36.9
```

---

## 7. API Contract & Parallel Development

Development is strictly partitioned between:
- **Person A:** Core Engine, Physics, Test Suite, Data Generators ([`engine/`](engine/), [`tests/`](tests/)).
- **Person B:** Streamlit Front-End, Plotly 2D/3D visualizer, Time Slider, UI widgets.

Refer to [`CONTRACT.md`](CONTRACT.md) for the exact schema, array shapes (`[T, N, M]`, `[N, M]`, `[T]`), units, and mock endpoints.

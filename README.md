# FlowShield: Tactical Digital Twin Flood Defense Platform

FlowShield is a high-performance 2D hydrodynamic simulation and disaster intelligence platform designed to model urban flash flooding, compound infrastructure disruptions, and population vulnerability in real time. It couples a vectorized physical simulation engine with a modern tactical digital twin web console for civil defense and emergency decision-makers.

---

## 1. System Architecture & Core Physics

FlowShield models an urban domain as a 2D digital elevation grid of dimensions $[N, M]$, where each cell $(r, c)$ possesses an elevation $z(r, c)$, storm-drain capacity $D(r, c)$, infiltration rate $f(r, c)$, and population count $pop(r, c)$.

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

### Physics Components
1. **Precipitation Accumulation:** Uniform water deposition scaled from intensity (mm/hr) to depth (m/s) across constant, triangular, or live Open-Meteo time series.
2. **Gravitational Surface Routing:** Water moves along the hydraulic head gradient $H = z + h$ across 4 cardinal neighbors with a physical conservation limiter and accelerated channel gain along natural waterways.
3. **Drainage & Infiltration:** Dual-sink extraction accounting for municipal drain intake capacity and soil pervious absorption.
4. **Dynamic Infrastructure Disruptions:** Real-time scheduling of drainage network failures (pump outages, siltation) and channel blockages (debris dams, culvert collapses).
5. Cross-Ward Water Attribution: Vectorized 16x16 boundary flux tracking that calculates inter-district flood cascading and identifies primary inflow sources.
6. Mass Conservation: Continuous global conservation verification ensuring relative mass balance error satisfies mass_err / sum(rain_in) < 1e-9.

### Grid Resolution & Grid Dependency

FlowShield defaults to a **40x40 grid** (`grid_size = 40`) everywhere (FastAPI server, React tactical digital twin UI, and stress testing matrix) for instantaneous simulation execution (<1 second) and smooth 60 FPS browser rendering.

> [!NOTE] Hydrodynamic Results are Grid-Dependent
> Spatial discretization directly influences local elevation gradients, flow accumulation, and channel conveyance. For example, during a storm of **50 mm/hr over 4 h with no events**:
> - **Grid 40 ($40 \times 40$):** **4,632** people affected.
> - **Grid 80 ($80 \times 80$):** **22,619** people affected.
> 
> Higher resolution grids resolve narrower topographical depressions and local drainage bottlenecks, capturing localized inundation that is averaged over larger cell areas at coarser resolutions.

### Antecedent Standing Water (`initial_water_m`)

To reflect realistic hydrology, `initial_water_m` is applied **only to low ground** (cells at or below the 20th elevation percentile plus river channel cells) rather than uniformly across the whole city:
- Applying a critical water depth of $0.5\text{ m}$ ($h_{crit}$) results in **27.38%** of people affected at $t=0$ on grid 40 (**24.38%** on grid 80) — clearly below 100%.
- Higher ground remains completely dry ($h = 0\text{ m}$) at $t=0$.

---

## 2. Complete Tech Stack & Dependencies

### Backend Engine & API
- **Runtime:** Python 3.10+
- **API Framework:** [FastAPI](https://fastapi.tiangolo.com/) (high-performance asynchronous REST endpoints)
- **ASGI Server:** [Uvicorn](https://www.uvicorn.org/) (lightweight, lightning-fast server implementation)
- **Data Validation:** [Pydantic v2](https://docs.pydantic.dev/) (strict request/response data schemas)
- **Numerical Computing:** [NumPy](https://numpy.org/) (vectorized 2D/3D array physics, hydraulic routing, boundary flux calculations)
- **Spatial Processing:** [SciPy](https://scipy.org/) (`scipy.ndimage` for connected-component hazard zone labeling and Gaussian terrain synthesis)
- **Live Weather Ingestion:** [Requests](https://requests.readthedocs.io/) (real-time precipitation ingestion from Open-Meteo API)
- **Automated Testing:** [Pytest](https://pytest.org/) (regression suite verifying mass conservation, physics invariants, and contract schemas)
- **Alternative Dashboard:** [Streamlit](https://streamlit.io/) & [Plotly](https://plotly.com/) (optional rapid exploratory interface in `app.py`)

### Frontend Tactical Digital Twin
- **UI Framework:** [React 18](https://react.dev/) (declarative, component-driven user interface)
- **Build Tooling:** [Vite 6](https://vitejs.dev/) (fast HMR development and optimized production bundling)
- **Styling & Design System:** [Tailwind CSS 3](https://tailwindcss.com/) (tactical dark-mode design system and HUD aesthetics)
- **State Management:** [Zustand](https://zustand-demo.pmnd.rs/) (centralized, decoupled reactive store)
- **Icons:** [Lucide React](https://lucide.dev/) (tactical iconography)
- **Data Animation:** [React CountUp](https://github.com/glennreyes/react-countup) (smooth numerical metric transitions)
- **Conduit Fluid Dynamics:** Native SVG `<animate>` elements with mathematically synchronized dash offsets and Bézier curves
- **Weather Simulation:** HTML5 Canvas (multi-threaded, status-linked dynamic rainfall overlay)

---

## 3. Project Structure

```
Freshnic_Flowshield/
├── CONTRACT.md                  # Strict API specification and schema contract
├── README.md                    # System architecture, tech stack, and setup guide
├── server.py                    # FastAPI application & /api/simulate endpoint
├── app.py                       # Alternative Streamlit interactive dashboard
├── demo_scenario.py             # Multi-scenario benchmarking script (CLI)
├── run_full_sim.py              # Full simulation execution script (CLI)
├── engine/                      # Vectorized 2D hydrodynamic simulation engine
│   ├── __init__.py
│   ├── run.py                   # Simulation coordinator, flux matrix & conduit tracking
│   ├── simulate.py              # Vectorized 2D hydrodynamic solver (finite-difference step)
│   ├── metrics.py               # Hazard classification, time-to-critical & zone clustering
│   ├── city_generator.py        # Procedural city & terrain generator (topography, channels, pop)
│   ├── ensemble.py              # Probabilistic ensemble storm simulation
│   └── rainfall.py              # Hyetograph generators & Open-Meteo live weather client
├── tests/                       # Automated test suite
│   ├── __init__.py
│   ├── test_run.py              # Unit & physics validation tests (mass balance, contracts)
│   └── toy_city.py              # Synthetic test city generator
└── frontend/                    # Modern React + Vite Tactical Digital Twin UI
    ├── package.json             # Frontend dependencies and scripts
    ├── vite.config.js           # Vite build and dev server configuration
    ├── tailwind.config.js       # Tailwind CSS design system configuration
    ├── index.html               # Main HTML entry point
    └── src/
        ├── main.jsx             # React DOM root render
        ├── App.jsx              # Main tactical dashboard orchestrator & view controller
        ├── index.css            # Global Tailwind styling & tactical animations
        ├── store/
        │   └── useSimulationStore.js # Zustand centralized reactive state store
        └── components/
            ├── TacticalHeader.jsx     # Executive status banner & live KPI metric cards
            ├── TacticalPlaybackBar.jsx# Timeline scrubber, speed controls & play/pause loop
            ├── TacticalNodeNetwork.jsx# 16-ward schematic map with native SVG fluid animations
            ├── TacticalRainOverlay.jsx# High-performance HTML5 canvas weather simulation
            ├── AnalyticsHub.jsx       # Hydrograph analytics, ward telemetry & attribution table
            ├── StressMatrix.jsx       # Stress-testing configuration & failure scenario toggles
            └── ErrorBoundary.jsx      # Graceful error catching and recovery container
```

---

## 4. Setup & Run Instructions

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** & **npm**

### Step 1: Backend Setup (FastAPI)

1. Open a terminal in the project root:
   ```bash
   cd Freshnic_Flowshield
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # Windows (PowerShell)
   python -m venv .venv
   .venv\Scripts\Activate.ps1

   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install required Python packages:
   ```bash
   pip install fastapi uvicorn pydantic numpy scipy requests pytest streamlit plotly
   ```

4. Launch the FastAPI simulation server:
   ```bash
   python -m uvicorn server:app --port 8000 --host 0.0.0.0
   ```
   The backend API will be available at `http://localhost:8000` (interactive Swagger documentation at `http://localhost:8000/docs`).

### Step 2: Frontend Setup (React + Vite)

1. Open a second terminal and navigate to `frontend/`:
   ```bash
   cd Freshnic_Flowshield/frontend
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Launch the Vite development server:
   ```bash
   npm run dev
   ```
   Open your browser to `http://localhost:5173/`.

### Step 3: Run Automated Tests & CLI Benchmarks

Verify physics equations, mass conservation, and contract adherence:
```bash
# Run test suite
pytest tests/ -v

# Run multi-scenario comparison benchmark
python demo_scenario.py

# Run full simulation runner
python run_full_sim.py
```

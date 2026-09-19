"""
FlowShield: Urban Flash Flood Early Warning Dashboard
======================================================
Interactive Streamlit application providing real-time 2D hydrodynamic simulation,
compound infrastructure failure stress-testing, and crisis decision intelligence.

Features:
- Sidebar controls for rainfall scenario selection & infrastructure disruption toggles.
- Caching of city terrain generation and baseline scenario via @st.cache_data.
- High-visibility early warning KPI metric cards with delta indicators against 'Normal' baseline.
- Interactive time slider spanning the full simulation horizon.
- Dual side-by-side Plotly Express maps for Water Accumulation (sequential Blues)
  and Risk Classification (accessible discrete Green/Yellow/Red).
"""

import streamlit as st
import numpy as np
import plotly.express as px

# Import backend simulation engine, city generator, and scenario builders
from engine.run import run_scenario
from engine.city_generator import generate_advanced_city
from engine.rainfall import get_scripted_scenario

# -----------------------------------------------------------------------------
# 1. PAGE CONFIGURATION & THEME
# -----------------------------------------------------------------------------
st.set_page_config(
    page_title="FlowShield | Urban Flood Early Warning Dashboard",
    page_icon="🌊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for polished, high-contrast early warning visualization
st.markdown(
    """
    <style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E3A8A;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.05rem;
        color: #4B5563;
        margin-bottom: 1.2rem;
    }
    .metric-card-container {
        background-color: #F8FAFC;
        border-radius: 8px;
        padding: 12px;
        border: 1px solid #E2E8F0;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------------------------------------------------------
# 2. CACHING & BACKEND HELPERS
# -----------------------------------------------------------------------------
@st.cache_data(show_spinner="Generating terrain & drainage infrastructure...")
def get_cached_city(grid_size: int = 100) -> dict:
    """
    Generates and caches the baseline urban spatial arrays.
    Returns: dict with 'z', 'D', 'channel_mask', and 'pop' (all [N, M]).
    """
    return generate_advanced_city(N=grid_size, M=grid_size)


@st.cache_data(show_spinner="Computing baseline 'Normal' scenario...")
def get_cached_baseline(grid_size: int = 100) -> dict:
    """
    Simulates and caches the baseline 'Normal' rainfall scenario without disruptions.
    Used for computing dynamic delta comparisons on KPI cards.
    """
    city = get_cached_city(grid_size)
    normal_scenario = get_scripted_scenario("normal")
    return run_scenario(city, normal_scenario)


def build_scenario_dict(intensity: str, sim_drain_fail: bool, sim_blockage: bool, grid_size: int) -> dict:
    """
    Constructs a scenario dictionary conforming strictly to CONTRACT.md.
    Combines the selected rainfall hyetograph with scheduled disruption events.
    """
    # Base rainfall configuration from scripted presets
    base_sc = get_scripted_scenario(intensity.lower())
    scenario = {
        "name": f"{intensity} Rain",
        "rain": base_sc["rain"],
        "events": [],
    }

    event_labels = []

    # Bonus Event 1: Drainage Failure (60% capacity loss in urban core at t=60 min)
    if sim_drain_fail:
        r0, r1 = int(grid_size * 0.55), int(grid_size * 0.85)
        c0, c1 = int(grid_size * 0.20), int(grid_size * 0.80)
        scenario["events"].append({
            "type": "drain_failure",
            "region": (r0, r1, c0, c1),
            "loss": 0.60,
            "t_start_min": 60.0,
        })
        event_labels.append("Drain Failure (+60m)")

    # Bonus Event 2: Channel Blockage (100% flow & drainage blockage in main canal at t=30 min)
    if sim_blockage:
        mid_r = int(grid_size * 0.75)
        # Compute the river center based on the sine-wave river formula from city_generator
        mid_c = int(grid_size / 2 + np.sin(mid_r / 20.0) * (grid_size / 6))
        # Block the channel width at that row
        blocked_cells = [(mid_r, int(np.clip(mid_c + dc, 0, grid_size - 1))) for dc in range(-3, 4)]
        scenario["events"].append({
            "type": "blockage",
            "cells": blocked_cells,
            "severity": 1.0,
            "t_start_min": 30.0,
        })
        event_labels.append("Channel Blocked (+30m)")

    if event_labels:
        scenario["name"] += " + " + " & ".join(event_labels)

    return scenario


# -----------------------------------------------------------------------------
# 3. SIDEBAR: SIMULATION CONTROLS & INPUTS
# -----------------------------------------------------------------------------
with st.sidebar:
    st.image("https://img.icons8.com/fluency/96/flood.png", width=64)
    st.title("FlowShield Controls")
    st.markdown("Configure meteorology and stress-test urban drainage resilience.")
    st.divider()

    # Grid Resolution selection
    st.subheader("🏙️ City Domain")
    resolution_choice = st.selectbox(
        "Grid Resolution",
        options=["100 x 100 (Fast, Recommended)", "200 x 200 (High-Detail)"],
        index=0,
        help="100x100 runs in ~0.8s for smooth slider scrubbing; 200x200 provides maximum spatial fidelity."
    )
    grid_size = 100 if "100" in resolution_choice else 200

    st.divider()

    # Rainfall Configuration
    st.subheader("🌧️ Rainfall Configuration")
    rain_intensity = st.selectbox(
        "Rainfall Intensity",
        options=["Normal", "Heavy", "Extreme"],
        index=1,
        help="Normal: 8 mm/hr constant | Heavy: 60 mm/hr peak triangular | Extreme: 100 mm/hr peak triangular"
    )

    st.divider()

    # Bonus Disruption Events
    st.subheader("⚡ Infrastructure Disruptions")
    st.markdown("Toggle bonus infrastructure failure events:")
    sim_drain_fail = st.checkbox(
        "Simulate Drainage Failure",
        value=False,
        help="Simulates 60% loss of storm-drain capacity in the high-density urban core starting at t=60 min."
    )
    sim_blockage = st.checkbox(
        "Simulate Blocked Drainage Channel",
        value=False,
        help="Simulates 100% flow restriction and culvert blockage on the main drainage canal starting at t=30 min."
    )

    st.divider()

    # Trigger simulation button
    run_button = st.button("🚀 Run Simulation", type="primary", use_container_width=True)


# -----------------------------------------------------------------------------
# 4. STATE MANAGEMENT & SIMULATION EXECUTION
# -----------------------------------------------------------------------------
# Initialize session state variables to prevent unexpected resets during interaction
if "sim_result" not in st.session_state or run_button:
    with st.spinner("Running 2D hydrodynamic simulation..."):
        city = get_cached_city(grid_size)
        scenario = build_scenario_dict(rain_intensity, sim_drain_fail, sim_blockage, grid_size)
        st.session_state["sim_result"] = run_scenario(city, scenario)
        st.session_state["scenario_name"] = scenario["name"]
        st.session_state["grid_size"] = grid_size

# Retrieve active simulation results and baseline for delta comparison
sim_result = st.session_state["sim_result"]
scenario_name = st.session_state["scenario_name"]
active_grid_size = st.session_state.get("grid_size", grid_size)
baseline_result = get_cached_baseline(active_grid_size)

summary = sim_result["summary"]
base_summary = baseline_result["summary"]
times_min = sim_result["times_min"]

# -----------------------------------------------------------------------------
# 5. TOP LAYOUT: EARLY WARNING OUTPUT & KPI METRICS
# -----------------------------------------------------------------------------
st.markdown('<div class="main-header">🌊 FlowShield: Urban Flash Flood Early Warning Dashboard</div>', unsafe_allow_html=True)
st.markdown(
    f'<div class="sub-header">Active Scenario: <strong>{scenario_name}</strong> | Domain: {active_grid_size}&times;{active_grid_size} Grid (500,000 residents)</div>',
    unsafe_allow_html=True,
)

# High-visibility metric cards with delta indicators against the baseline 'Normal' scenario
col1, col2, col3 = st.columns(3)

with col1:
    depth_val = summary["peak_depth_m"]
    base_depth = base_summary["peak_depth_m"]
    depth_delta = depth_val - base_depth
    st.metric(
        label="Peak Water Depth",
        value=f"{depth_val:.2f} m",
        delta=f"{depth_delta:+.2f} m vs Normal" if abs(depth_delta) > 0.001 else "Baseline (Normal)",
        delta_color="inverse",  # Greater depth = increased risk (red)
        help="Maximum water depth observed anywhere in the city across the entire simulation."
    )

with col2:
    t_crit_val = summary["first_critical_min"]
    base_t_crit = base_summary["first_critical_min"]

    if t_crit_val is not None:
        t_crit_display = f"{t_crit_val:.0f} min"
        if base_t_crit is not None:
            t_crit_delta = f"{t_crit_val - base_t_crit:+.0f} min vs Normal"
        else:
            t_crit_delta = "Critical breach!"
        d_color = "normal"  # Negative delta = earlier breach (red)
    else:
        t_crit_display = "Never (Safe)"
        t_crit_delta = "No breach"
        d_color = "off"

    st.metric(
        label="Estimated Time to Critical",
        value=t_crit_display,
        delta=t_crit_delta,
        delta_color=d_color,
        help="Simulation time at which the first grid cell reaches or exceeds critical depth (0.50m)."
    )

with col3:
    pop_val = summary["peak_affected"]
    base_pop = base_summary["peak_affected"]
    pop_delta = pop_val - base_pop
    st.metric(
        label="Estimated Affected Population",
        value=f"{pop_val:,.0f}",
        delta=f"{pop_delta:+,.0f} vs Normal ({summary['peak_affected_pct']:.1f}% of city)" if abs(pop_delta) > 0 else "0 (Safe)",
        delta_color="inverse",  # More people affected = increased severity (red)
        help="Estimated peak number of residents affected by floodwaters exceeding exposure threshold (>= 0.10m)."
    )

# Dynamic early warning banner alert
if summary["critical_cells"] > 0:
    st.error(
        f"🚨 **CRITICAL FLOOD WARNING**: **{summary['critical_cells']:,}** grid cells breach critical safety thresholds (≥ 0.50 m). "
        f"Earliest breach occurs at **{summary['first_critical_min']:.0f} minutes**. "
        f"Peak displacement: **{summary['peak_affected']:,.0f} residents** ({summary['peak_affected_pct']:.1f}% of total population)."
    )
else:
    st.success("✅ **CONDITIONS SAFE**: Flood depths remain strictly within safe operational limits across all municipal zones.")

st.divider()

# -----------------------------------------------------------------------------
# 6. MIDDLE LAYOUT: INTERACTIVE TIME SLIDER
# -----------------------------------------------------------------------------
st.subheader("⏱️ Flood Progression Timeline")

# Prominent time slider spanning the simulation frames
step_size = float(times_min[1] - times_min[0]) if len(times_min) > 1 else 5.0
selected_time = st.slider(
    label="Time (Minutes)",
    min_value=float(times_min[0]),
    max_value=float(times_min[-1]),
    value=float(times_min[st.session_state.get("slider_idx", 0)]),
    step=step_size,
    help="Drag the slider to observe flood progression, drainage response, and danger zone evolution over time."
)

# Determine the exact frame index corresponding to selected time
time_idx = int(np.argmin(np.abs(times_min - selected_time)))
st.session_state["slider_idx"] = time_idx

# Live status readout at current timestamp
rain_at_t = sim_result["rain_mmhr"][time_idx]
affected_at_t = sim_result["affected_pop"][time_idx]

mcol1, mcol2, mcol3, mcol4 = st.columns(4)
mcol1.info(f"🕒 **Current Time:** `{selected_time:.0f} min`")
mcol2.info(f"🌧️ **Rainfall Rate:** `{rain_at_t:.1f} mm/hr`")
mcol3.info(f"👥 **Currently Affected:** `{affected_at_t:,.0f} people`")
mcol4.info(f"📊 **Frame:** `{time_idx + 1} / {len(times_min)}`")

# -----------------------------------------------------------------------------
# 7. BOTTOM LAYOUT: FLOOD PROGRESSION & RISK CLASSIFICATION MAPS
# -----------------------------------------------------------------------------
map_col1, map_col2 = st.columns(2)

# Extract 2D array slices for the current time step
h_frame = sim_result["h"][time_idx]
status_frame = sim_result["status"][time_idx]

# Stable color scale bounds to prevent flickering during slider scrubbing
global_max_depth = max(0.50, float(sim_result["h"].max()))

with map_col1:
    st.markdown("### 🌊 Map 1: Water Accumulation")
    # Colorblind-friendly sequential color scale ('Blues')
    fig_depth = px.imshow(
        h_frame,
        color_continuous_scale="Blues",
        zmin=0.0,
        zmax=global_max_depth,
        labels=dict(x="Grid Column (East)", y="Grid Row (South)", color="Depth (m)"),
        title=f"Water Depth at t = {selected_time:.0f} min",
        aspect="equal",
    )
    fig_depth.update_layout(
        margin=dict(l=10, r=10, t=40, b=10),
        coloraxis_colorbar=dict(
            title=dict(text="Depth (m)"),
            ticks="outside",
        ),
    )
    st.plotly_chart(fig_depth, width="stretch")

with map_col2:
    st.markdown("### ⚠️ Map 2: Risk Classification")
    # Strictly mapped accessible discrete color scale: Green (Safe), Yellow (Warning), Red (Critical)
    # Status codes: 0 = Safe, 1 = Warning, 2 = Critical
    risk_colorscale = [
        [0.0, "#2ecc71"],    # Green (Safe)
        [0.333, "#2ecc71"],
        [0.333, "#f1c40f"],  # Yellow (Warning)
        [0.666, "#f1c40f"],
        [0.666, "#e74c3c"],  # Red (Critical)
        [1.0, "#e74c3c"],
    ]

    fig_risk = px.imshow(
        status_frame,
        color_continuous_scale=risk_colorscale,
        zmin=0,
        zmax=2,
        labels=dict(x="Grid Column (East)", y="Grid Row (South)", color="Risk Level"),
        title=f"Hazard Classification at t = {selected_time:.0f} min",
        aspect="equal",
    )
    fig_risk.update_layout(
        margin=dict(l=10, r=10, t=40, b=10),
        coloraxis_colorbar=dict(
            title=dict(text="Risk Level"),
            tickvals=[0.33, 1.0, 1.67],
            ticktext=["Safe", "Warning", "Critical"],
            ticks="outside",
        ),
    )
    st.plotly_chart(fig_risk, width="stretch")

# -----------------------------------------------------------------------------
# 8. FOOTER: SYSTEM DIAGNOSTICS & CONTRACT ADHERENCE
# -----------------------------------------------------------------------------
with st.expander("🛠️ System Diagnostics & Conservation of Mass"):
    st.write(f"- **Scenario Label:** {summary['scenario']}")
    st.write(f"- **Conservation of Mass Error (Relative):** `{summary['mass_err_rel']:.2e}` (Physical limit: < 1e-9)")
    st.write(f"- **Critical Danger Zones:** `{sim_result['n_zones']}` distinct clusters identified")
    st.write(f"- **Total City Population:** `{float(np.sum(city['pop'])):,.0f}`")
    st.caption("FlowShield simulation engine adheres strictly to the specifications defined in `CONTRACT.md`.")

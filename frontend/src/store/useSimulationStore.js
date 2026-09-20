import { create } from 'zustand';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * useSimulationStore
 * Global state store for FlowShield Tactical Digital Twin.
 * Decouples API simulation execution from timeline scrubbing and playback.
 * 
 * - Continuous numeric hydrologic parameters:
 *   - intensityMmHr: 0 to 300 mm/hr
 *   - durationHrs: 1 to 24 hours
 *   - initialWaterM: 0.0 to 2.5 meters
 * - Scrubbing only updates currentTimeIndex with ZERO network calls and ZERO loading toggles.
 * - API call (/api/simulate) is only invoked when a scenario is selected or 'Run Simulation' is clicked.
 */

export const useSimulationStore = create((set, get) => ({
  // Navigation & Tabs: 'map' | 'analytics' | 'stress'
  activeTab: 'map',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Continuous Numeric Hydrologic Parameters
  intensityMmHr: 75.0, // Range: 0 to 300 mm/hr
  durationHrs: 4.0,    // Range: 1 to 24 hours
  initialWaterM: 0.0,  // Range: 0.0 to 2.5 meters
  drainFailure: false,
  blockage: false,
  gridSize: 40,

  setIntensityMmHr: (intensityMmHr) => set({ intensityMmHr: Number(intensityMmHr) }),
  setDurationHrs: (durationHrs) => set({ durationHrs: Number(durationHrs) }),
  setInitialWaterM: (initialWaterM) => set({ initialWaterM: Number(initialWaterM) }),

  // Clean Baseline Comparison Toggle
  showBaseline: false,
  setShowBaseline: (showBaseline) => set({ showBaseline }),
  toggleShowBaseline: () => set((state) => ({ showBaseline: !state.showBaseline })),
  
  // Disruption preview state (for immediate feedback before running simulation)
  disruptionsPreview: null,

  fetchDisruptionsPreview: async () => {
    const { drainFailure, blockage, gridSize } = get();
    if (!drainFailure && !blockage) {
      set({ disruptionsPreview: [] });
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/disruptions?grid_size=${gridSize}&drain_failure=${drainFailure}&blockage=${blockage}`
      );
      if (!res.ok) {
        set({ disruptionsPreview: null });
        return;
      }
      const data = await res.json();
      set({ disruptionsPreview: Array.isArray(data?.disruptions) ? data.disruptions : null });
    } catch (err) {
      console.warn('Disruptions preview fetch failed:', err);
      set({ disruptionsPreview: null });
    }
  },

  setDrainFailure: (drainFailure) => {
    set({ drainFailure });
    get().fetchDisruptionsPreview();
  },
  setBlockage: (blockage) => {
    set({ blockage });
    get().fetchDisruptionsPreview();
  },
  setGridSize: (gridSize) => {
    set({ gridSize: Number(gridSize) });
    get().fetchDisruptionsPreview();
  },

  // Playback & Timeline State
  currentTimeIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,

  setTimeIndex: (index) => {
    const { simData } = get();
    const maxIndex = simData?.times_min?.length ? simData.times_min.length - 1 : 36;
    const clamped = Math.max(0, Math.min(index, maxIndex));
    set({ currentTimeIndex: clamped });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),

  // Selected Ward for deep inspection (0..15)
  selectedWardId: 0,
  setSelectedWardId: (id) => set({ selectedWardId: id }),

  // Cached Full Simulation Data & API Loading States
  simData: null,
  isLoading: false,
  error: null,

  // Fetch simulation from FastAPI backend (/api/simulate)
  // ONLY called once on scenario selection or explicit button click!
  executeSimulation: async (customParams = null) => {
    const state = get();
    set({ isLoading: true, error: null });

    try {
      const activeIntensity = customParams?.intensity_mm_hr !== undefined 
        ? Number(customParams.intensity_mm_hr) 
        : state.intensityMmHr;
      
      const activeDuration = customParams?.duration_hrs !== undefined 
        ? Number(customParams.duration_hrs) 
        : state.durationHrs;
      
      const activeInitialWater = customParams?.initial_water_m !== undefined 
        ? Number(customParams.initial_water_m) 
        : state.initialWaterM;

      const activeDrain = customParams?.drain_failure !== undefined 
        ? customParams.drain_failure 
        : (customParams?.drainFailure !== undefined ? customParams.drainFailure : state.drainFailure);

      const activeBlock = customParams?.blockage !== undefined 
        ? customParams.blockage 
        : state.blockage;

      const payload = {
        intensity_mm_hr: activeIntensity,
        duration_hrs: activeDuration,
        initial_water_m: activeInitialWater,
        drain_failure: activeDrain,
        blockage: activeBlock,
        grid_size: state.gridSize,
      };

      const res = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errDetail = await res.json().catch(() => ({}));
        throw new Error(errDetail.detail || `Server error (HTTP ${res.status})`);
      }

      const data = await res.json();
      set({
        simData: data,
        currentTimeIndex: 0,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      console.error('FastAPI fetch error:', err);
      set({
        isLoading: false,
        error: err.message || 'Unable to connect to FlowShield backend',
      });
    }
  },
}));

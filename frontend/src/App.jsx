import React, { useEffect, useRef, useMemo } from 'react';
import CountUp from 'react-countup';
import { useSimulationStore } from './store/useSimulationStore';
import TacticalHeader from './components/TacticalHeader';
import TacticalPlaybackBar from './components/TacticalPlaybackBar';
import TacticalNodeNetwork from './components/TacticalNodeNetwork';
import AnalyticsHub from './components/AnalyticsHub';
import StressMatrix from './components/StressMatrix';
import ErrorBoundary from './components/ErrorBoundary';
import { ShieldCheck, AlertCircle, RefreshCw, Cpu, Activity, Droplets, AlertTriangle, Split } from 'lucide-react';

/**
 * App: FlowShield Tactical Digital Twin
 * Performance-optimized main application:
 * - State management completely decoupled via Zustand (useSimulationStore).
 * - Scrubbing timeline only updates currentTimeIndex integer slice.
 * - Smooth metric counters using react-countup.
 * - Responsive HTML5 canvas rain animation with status-linked intensity.
 */
export default function App() {
  // Zustand store selectors
  const activeTab = useSimulationStore((state) => state.activeTab);
  const setActiveTab = useSimulationStore((state) => state.setActiveTab);
  const intensityMmHr = useSimulationStore((state) => state.intensityMmHr);
  const setIntensityMmHr = useSimulationStore((state) => state.setIntensityMmHr);
  const durationHrs = useSimulationStore((state) => state.durationHrs);
  const setDurationHrs = useSimulationStore((state) => state.setDurationHrs);
  const initialWaterM = useSimulationStore((state) => state.initialWaterM);
  const setInitialWaterM = useSimulationStore((state) => state.setInitialWaterM);
  const drainFailure = useSimulationStore((state) => state.drainFailure);
  const setDrainFailure = useSimulationStore((state) => state.setDrainFailure);
  const blockage = useSimulationStore((state) => state.blockage);
  const setBlockage = useSimulationStore((state) => state.setBlockage);
  const currentTimeIndex = useSimulationStore((state) => state.currentTimeIndex);
  const setTimeIndex = useSimulationStore((state) => state.setTimeIndex);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const setIsPlaying = useSimulationStore((state) => state.setIsPlaying);
  const playbackSpeed = useSimulationStore((state) => state.playbackSpeed);
  const setPlaybackSpeed = useSimulationStore((state) => state.setPlaybackSpeed);
  const selectedWardId = useSimulationStore((state) => state.selectedWardId);
  const setSelectedWardId = useSimulationStore((state) => state.setSelectedWardId);
  const simData = useSimulationStore((state) => state.simData);
  const isLoading = useSimulationStore((state) => state.isLoading);
  const error = useSimulationStore((state) => state.error);
  const executeSimulation = useSimulationStore((state) => state.executeSimulation);
  const showBaseline = useSimulationStore((state) => state.showBaseline);
  const toggleShowBaseline = useSimulationStore((state) => state.toggleShowBaseline);

  const playTimerRef = useRef(null);

  // Initial simulation fetch on mount ONLY
  useEffect(() => {
    executeSimulation();
  }, []);

  // Time & step telemetry
  const timesMin = simData?.times_min || [];
  const totalSteps = timesMin.length > 0 ? timesMin.length : 37;
  // Playback Index Clamping: Always clamp frame access to [0, totalSteps - 1]
  const clampedTimeIndex = Math.max(0, Math.min(currentTimeIndex, totalSteps - 1));
  const currentTimeMin = timesMin[clampedTimeIndex] !== undefined ? timesMin[clampedTimeIndex] : clampedTimeIndex * 3.33;

  // Auto-pause if playback index reaches or exceeds the final frame
  useEffect(() => {
    if (isPlaying && currentTimeIndex >= totalSteps - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, currentTimeIndex, totalSteps, setIsPlaying]);

  // Playback timer ticker (advances currentTimeIndex locally with zero network calls)
  useEffect(() => {
    if (isPlaying) {
      if (currentTimeIndex >= totalSteps - 1) {
        setIsPlaying(false);
        return;
      }
      const intervalMs = Math.max(80, 500 / playbackSpeed);
      playTimerRef.current = setInterval(() => {
        const next = currentTimeIndex + 1;
        if (next >= totalSteps - 1) {
          setTimeIndex(totalSteps - 1);
          setIsPlaying(false);
        } else {
          setTimeIndex(next);
        }
      }, intervalMs);
    } else {
      clearInterval(playTimerRef.current);
    }
    return () => clearInterval(playTimerRef.current);
  }, [isPlaying, playbackSpeed, totalSteps, currentTimeIndex, setIsPlaying, setTimeIndex]);

  // Load preset scenario from Stress Matrix
  const handleLoadScenario = (scenario) => {
    const intensity = scenario.intensity_mm_hr || (scenario.rainfallLevel === 'dry' ? 15 : scenario.rainfallLevel === 'moderate' ? 35 : scenario.rainfallLevel === 'monsoon' ? 75 : 120);
    const duration = scenario.duration_hrs || 4.0;
    const initialWater = scenario.initial_water_m || 0.0;
    const drain = scenario.drainFailure !== undefined ? scenario.drainFailure : scenario.drain_failure || false;
    const block = scenario.blockage || false;

    setIntensityMmHr(intensity);
    setDurationHrs(duration);
    setInitialWaterM(initialWater);
    setDrainFailure(drain);
    setBlockage(block);

    executeSimulation({
      intensity_mm_hr: intensity,
      duration_hrs: duration,
      initial_water_m: initialWater,
      drain_failure: drain,
      blockage: block,
    });
    setActiveTab('map');
  };

  // High-level Global KPI telemetry derived from current slice
  const globalSummary = useMemo(() => {
    if (!simData?.summary) {
      return {
        peakDepth: 0.74,
        totalAffected: 18500,
        peakAffected: 18500,
        firstCrit: 38,
        critWards: 6,
      };
    }

    const frame = Math.max(0, Math.min(currentTimeIndex, (simData?.times_min?.length || 1) - 1));

    const currentAffected = simData.affected_pop && simData.affected_pop[frame] !== undefined
      ? (simData.affected_pop[frame] ?? 0)
      : (simData.summary.peak_affected ?? 0);

    let critCount = 0;
    if (simData.region_status && simData.region_status[frame]) {
      critCount = simData.region_status[frame].filter((s) => s === 2).length;
    }

    return {
      peakDepth: simData.summary.peak_depth_m ?? 0,
      totalAffected: currentAffected ?? 0,
      peakAffected: simData.summary.peak_affected ?? 0,
      firstCrit: simData.summary.first_critical_min ?? null,
      critWards: critCount ?? 0,
    };
  }, [simData, currentTimeIndex]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-teal-500 selection:text-slate-950">
      
      {/* 1. TOP TACTICAL HEADER */}
      <TacticalHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        systemStatus={isLoading ? "SIMULATING" : error ? "DEGRADED" : "OPTIMAL"}
        scenarioName={simData?.scenario || "Heavy Rain"}
      />

      {/* 2. GLOBAL CONTROLS (PLAYBACK BAR & RAINFALL CONFIG) */}
      <TacticalPlaybackBar
        currentStep={clampedTimeIndex}
        totalSteps={totalSteps}
        currentTimeMin={currentTimeMin}
        timesMin={timesMin}

        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        onStepChange={(step) => setTimeIndex(step)}
        onReset={() => {
          setIsPlaying(false);
          setTimeIndex(0);
        }}
        intensityMmHr={intensityMmHr}
        setIntensityMmHr={setIntensityMmHr}
        durationHrs={durationHrs}
        setDurationHrs={setDurationHrs}
        initialWaterM={initialWaterM}
        setInitialWaterM={setInitialWaterM}
        drainFailure={drainFailure}
        setDrainFailure={setDrainFailure}
        blockage={blockage}
        setBlockage={setBlockage}
        onRunSimulation={() => executeSimulation()}
        isLoading={isLoading}
        simData={simData}
      />

      {/* 3. MAIN TACTICAL WORKSPACE */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Error Alert if backend unreachable */}
        {error && (
          <div className="bg-red-950/80 border border-red-500/60 p-4 rounded-xl flex items-center justify-between text-red-200 text-sm font-mono shadow-lg">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <span className="font-bold text-white">BACKEND CONNECTION ALERT: </span>
                <span>{error}</span>
              </div>
            </div>
            <button
              onClick={() => executeSimulation()}
              className="px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white font-bold text-xs flex items-center space-x-1 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>RETRY</span>
            </button>
          </div>
        )}

        {/* Global KPI Telemetry Quick Bar with Smooth CountUp Counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          
          {/* SIM PEAK INUNDATION */}
          <div className="bg-slate-900/90 border border-teal-500/30 p-3.5 rounded-xl shadow-lg">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              SIM PEAK INUNDATION
            </span>
            <div className="text-xl font-bold font-mono text-white mt-0.5">
              <CountUp
                end={globalSummary.peakDepth}
                decimals={2}
                duration={0.5}
                preserveValue={true}
              />{' '}
              m
            </div>
            <span className="text-[10px] font-mono text-teal-400">Max flood height</span>
          </div>

          {/* CURRENT AFFECTED (Smooth CountUp) */}
          <div className="bg-slate-900/90 border border-teal-500/30 p-3.5 rounded-xl shadow-lg">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              CURRENT AFFECTED
            </span>
            <div className="text-xl font-bold font-mono text-teal-300 mt-0.5">
              <CountUp
                end={Math.round(globalSummary.totalAffected)}
                duration={0.4}
                separator=","
                preserveValue={true}
              />
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              Peak:{' '}
              <CountUp
                end={Math.round(globalSummary.peakAffected)}
                duration={0.5}
                separator=","
                preserveValue={true}
              />
            </span>
          </div>

          {/* FIRST CRITICAL BREACH (LIVE COUNTDOWN) */}
          <div className="bg-slate-900/90 border border-teal-500/30 p-3.5 rounded-xl shadow-lg">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              FIRST CRITICAL BREACH
            </span>
            {(() => {
              const firstCrit = globalSummary.firstCrit;
              const firstCritRemaining = firstCrit != null ? Math.max(0, Math.round(firstCrit - currentTimeMin)) : null;
              if (firstCrit != null) {
                if (firstCritRemaining === 0) {
                  return (
                    <>
                      <div className="text-xl font-bold font-mono text-red-400 mt-0.5 animate-pulse">
                        BREACH ACTIVE
                      </div>
                      <span className="text-[10px] font-mono text-red-400/80">
                        Onset at T+{Math.round(firstCrit)}m
                      </span>
                    </>
                  );
                }
                return (
                  <>
                    <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
                      ~{firstCritRemaining}m left
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      Breach at T+{Math.round(firstCrit)}m
                    </span>
                  </>
                );
              }
              return (
                <>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                    NONE (SAFE)
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Threshold: 0.50m</span>
                </>
              );
            })()}
          </div>

          {/* CRITICAL WARDS NOW */}
          <div className="bg-slate-900/90 border border-teal-500/30 p-3.5 rounded-xl shadow-lg">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              CRITICAL WARDS NOW
            </span>
            <div className={`text-xl font-bold font-mono mt-0.5 ${globalSummary.critWards > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              <CountUp
                end={globalSummary.critWards}
                duration={0.3}
                preserveValue={true}
              />{' '}
              / 16
            </div>
            <span className="text-[10px] font-mono text-slate-400">Active red alert zones</span>
          </div>
        </div>

        {/* Plain-Language Disruption Additive Impact Strip */}
        {simData?.impact && (
          <div className="bg-slate-900/95 border border-amber-500/40 rounded-xl p-3.5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className="font-bold text-amber-300">DISRUPTION IMPACT: </span>
                <span className="text-slate-200">
                  {(() => {
                    const hasDrain = Boolean(drainFailure);
                    const hasBlock = Boolean(blockage);
                    const label = hasDrain && hasBlock ? 'Drain failure + blockage' : hasDrain ? 'Drain failure' : 'Canal blockage';
                    const totals = simData.impact.totals || {};
                    const worsenedWards = (simData.impact.per_ward || [])
                      .filter((w) => w.worsened)
                      .map((w) => w.code || `W-${String(w.id + 1).padStart(2, '0')}`)
                      .join(', ');
                    const wardsStr = worsenedWards ? ` (${worsenedWards})` : '';

                    return `${label}: +${Math.round(totals.delta_peak_affected || 0).toLocaleString()} people (+${totals.delta_peak_affected_pct || 0}%), +${totals.delta_critical_wards || 0} critical wards${wardsStr}, +${totals.delta_peak_depth_m || 0}m peak depth`;
                  })()}
                </span>
              </div>
            </div>

            {/* Clean Baseline Comparison Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={showBaseline}
              onClick={toggleShowBaseline}
              className={`px-3 py-1.5 rounded-lg border font-mono font-bold text-xs flex items-center space-x-2 transition cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                showBaseline
                  ? 'bg-teal-500/20 text-teal-300 border-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.3)]'
                  : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <Split className="w-3.5 h-3.5 text-teal-400" />
              <span>Clean Baseline:</span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] ${showBaseline ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                {showBaseline ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        )}

        {/* TAB 1: CITY MAP (CORE VIEW WITH STATUS-LINKED RAIN ANIMATION) */}
        {activeTab === 'map' && (
          <ErrorBoundary fallbackTitle="Tactical Node Network encountered an error.">
            <TacticalNodeNetwork
              currentStep={clampedTimeIndex}
              regionStatus={simData?.region_status}
              regionData={simData?.region_data}
              regionDepth={simData?.region_depth}
              regionAffected={simData?.region_affected}
              zones={simData?.zones}
              edgeFlows={simData?.edge_flows}
              fluxTimeline={simData?.flux_timeline}
              fluxMatrix={simData?.flux_matrix}
              timeline={simData?.timeline}
              currentTimeMin={currentTimeMin}
              selectedWardId={selectedWardId}
              onSelectWard={(id) => setSelectedWardId(id)}
            />
          </ErrorBoundary>
        )}

        {/* TAB 2: ANALYTICS HUB (HYDROGRAPH & DATA TABLE) */}
        {activeTab === 'analytics' && (
          <ErrorBoundary fallbackTitle="Analytics Hub encountered an error.">
            <AnalyticsHub
              timesMin={timesMin}
              currentStep={clampedTimeIndex}
              currentTimeMin={currentTimeMin}
              selectedWardId={selectedWardId}
              setSelectedWardId={setSelectedWardId}
              regionStatus={simData?.region_status}
              regionData={simData?.region_data}
              regionDepth={simData?.region_depth}

              regionAffected={simData?.region_affected}
            />
          </ErrorBoundary>
        )}

        {/* TAB 3: STRESS MATRIX */}
        {activeTab === 'stress' && (
          <ErrorBoundary fallbackTitle="Scenario Stress Matrix encountered an error.">
            <StressMatrix
              onLoadScenario={handleLoadScenario}
              currentScenarioName={simData?.scenario || ""}
              isLoading={isLoading}
            />
          </ErrorBoundary>
        )}

      </main>

      {/* FOOTER */}
      <footer className="w-full bg-slate-950 border-t border-slate-900 py-3 text-center text-xs font-mono text-slate-500">
        FLOWSHIELD TACTICAL DIGITAL TWIN • 16-WARD HYDRODYNAMIC FLOOD DEFENSE PLATFORM
      </footer>

    </div>
  );
}

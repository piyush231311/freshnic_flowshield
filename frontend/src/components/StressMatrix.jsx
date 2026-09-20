import React from 'react';
import { 
  ShieldAlert, Droplets, Users, AlertTriangle, ArrowUpRight, 
  CheckCircle2, Clock, Zap, Layers, RefreshCw 
} from 'lucide-react';

/**
 * StressMatrix
 * Tab 3: Multi-scenario comparative stress matrix.
 * Displays preset operational runs:
 * 1. Normal Rainfall (15 mm/hr, 4 h, no events)
 * 2. Heavy Rainfall (50 mm/hr, 4 h, no events)
 * 3. Heavy + Drain Failure (50 mm/hr, 4 h, drain failure)
 * 4. Heavy + Canal Blockage (50 mm/hr, 4 h, canal blockage)
 * 5. Extreme Compound (75 mm/hr, 4 h, drain failure + blockage)
 * Displays 'Peak Inundation Level' and 'Peak Population at Risk' for each.
 */
export default function StressMatrix({
  onLoadScenario,
  currentScenarioName = "",
  isLoading = false,
}) {
  const [scenarios, setScenarios] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const fetchMatrix = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('http://127.0.0.1:8000/api/stress-matrix');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      setScenarios(Array.isArray(data?.scenarios) ? data.scenarios : []);
    } catch (err) {
      console.error('Failed to load stress matrix:', err);
      setError(err.message || 'Unknown network error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  // Header Banner Component
  const renderHeader = (count = 0) => (
    <div className="bg-slate-900/90 rounded-2xl border border-teal-500/30 p-4 sm:p-6 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-teal-400 animate-pulse" />
            <h2 className="text-lg font-bold font-mono text-white tracking-wide">
              SCENARIO STRESS MATRIX // COMPARATIVE VULNERABILITY
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Live physics-calculated benchmarking of hydrodynamic impact, peak inundation, and exposed population
          </p>
        </div>

        <div className="px-3 py-1 rounded-lg bg-teal-950/60 border border-teal-500/40 text-teal-300 text-xs font-mono">
          {count} LIVE PHYSICS SCENARIOS
        </div>
      </div>
    </div>
  );

  // 1. Strict Loading State
  if (loading) {
    return (
      <div className="space-y-6">
        {renderHeader(0)}
        <div className="p-16 text-center bg-slate-900/60 rounded-2xl border border-teal-500/20 backdrop-blur-md shadow-2xl">
          <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="font-mono text-sm text-teal-300 tracking-wider font-semibold">
            COMPUTING LIVE 2D HYDRODYNAMIC STRESS SIMULATIONS...
          </div>
          <p className="text-xs text-slate-400 font-mono mt-2">
            Solving shallow water equations across 16 urban catchments with live boundary conditions
          </p>
        </div>
      </div>
    );
  }

  // 2. Error State with Retry
  if (error) {
    return (
      <div className="space-y-6">
        {renderHeader(0)}
        <div className="p-8 bg-red-950/40 border border-red-500/40 rounded-2xl text-center space-y-4 shadow-xl">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <div className="text-sm font-mono text-red-200">
            Failed to load live stress matrix: {error}
          </div>
          <button
            onClick={fetchMatrix}
            className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-xl font-mono text-xs font-bold transition flex items-center space-x-2 mx-auto cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>RETRY STRESS MATRIX</span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Empty State
  if (!scenarios || scenarios.length === 0) {
    return (
      <div className="space-y-6">
        {renderHeader(0)}
        <div className="p-12 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 font-mono text-sm">
          No stress scenarios returned from simulation engine.
        </div>
      </div>
    );
  }

  // 4. Main Scenario Cards Grid
  return (
    <div className="space-y-6">
      {renderHeader(scenarios.length)}

      {/* Grid of Stress Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {scenarios.map((sc, idx) => {
          const title = sc?.title || sc?.name || sc?.scenarioName || `Scenario ${idx + 1}`;
          const subtitle = sc?.subtitle || "";
          const description = sc?.description || "Simulated hydrodynamic stress scenario.";
          const riskPill = sc?.riskPill || "ASSESSING";
          const riskColor = sc?.riskColor || "text-slate-400 border-slate-500/50 bg-slate-500/10";
          const badgeBg = sc?.badgeBg || "bg-slate-700";
          const peakDepth = sc?.peakDepth || (sc?.peak_depth_m !== undefined ? `${sc.peak_depth_m.toFixed(2)} m` : "0.00 m");
          const peakPop = sc?.peakPop || (sc?.peak_affected !== undefined ? `${Math.round(sc.peak_affected).toLocaleString()} citizens` : "0 citizens");
          const deltaDepth = sc?.deltaDepth || "+0.00m";
          const deltaPop = sc?.deltaPop || "+0";
          const firstCrit = sc?.firstCrit || (sc?.first_critical_min !== undefined && sc.first_critical_min !== null ? `T+${Math.round(sc.first_critical_min)} min` : "None (Safe)");
          const critWards = sc?.critWards || (sc?.critical_wards !== undefined ? `${sc.critical_wards} / 16 Wards` : "0 / 16 Wards");

          const firstWord = title.split(' ')[0] || "";
          const isCurrent = (currentScenarioName && typeof currentScenarioName === 'string' && firstWord)
            ? currentScenarioName.toLowerCase().includes(firstWord.toLowerCase())
            : false;

          return (
            <div
              key={sc?.id || `scenario-${idx}`}
              className={`bg-slate-900/95 rounded-2xl border transition-all duration-200 p-5 sm:p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden ${
                isCurrent 
                  ? 'border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.25)] ring-1 ring-teal-400' 
                  : 'border-slate-800 hover:border-teal-500/50 hover:shadow-xl'
              }`}
            >
              {/* Top Accent Bar */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${badgeBg}`} />

              <div>
                {/* Title & Status Badge */}
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-bold font-mono text-white">
                      {title}
                    </h3>
                    {subtitle && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {subtitle}
                      </p>
                    )}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border ${riskColor}`}>
                    {riskPill}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 font-sans my-3.5 leading-relaxed">
                  {description}
                </p>

                {/* Primary Metric Highlights */}
                <div className="grid grid-cols-2 gap-3 my-4">
                  
                  {/* Peak Inundation Level */}
                  <div className="bg-slate-950/90 p-3.5 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-mono uppercase">
                      <span className="flex items-center gap-1">
                        <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                        Peak Inundation
                      </span>
                      <span className="text-amber-400 font-bold">{deltaDepth}</span>
                    </div>
                    <div className="text-xl font-bold font-mono text-white mt-1">
                      {peakDepth}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">Max flood height</span>
                  </div>

                  {/* Peak Population at Risk */}
                  <div className="bg-slate-950/90 p-3.5 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-mono uppercase">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-teal-400" />
                        Population at Risk
                      </span>
                      <span className="text-red-400 font-bold">{deltaPop}</span>
                    </div>
                    <div className="text-xl font-bold font-mono text-teal-300 mt-1">
                      {peakPop}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">Exposed residents</span>
                  </div>

                </div>

                {/* Secondary Telemetry */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400 py-2 border-t border-slate-800/80">
                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>First Breach:</span>
                    <span className="text-white font-bold">{firstCrit}</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span>Breached Wards:</span>
                    <span className="text-white font-bold">{critWards}</span>
                  </div>
                </div>
              </div>

              {/* Action Button: Load in Twin */}
              <div className="mt-5 pt-3 border-t border-slate-800">
                <button
                  onClick={() => onLoadScenario && onLoadScenario(sc)}
                  disabled={isLoading}
                  className={`w-full py-2.5 px-4 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer ${
                    isCurrent
                      ? 'bg-teal-500/20 text-teal-300 border border-teal-500/50 cursor-default'
                      : 'bg-slate-800 hover:bg-teal-500 hover:text-slate-950 text-white border border-slate-700 shadow-md active:scale-95'
                  } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isCurrent ? 'CURRENTLY LOADED IN TWIN' : 'LOAD SCENARIO IN TWIN'}</span>
                  {!isCurrent && <ArrowUpRight className="w-3.5 h-3.5 ml-1" />}
                </button>
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
}

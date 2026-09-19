import React from 'react';
import { 
  Play, Pause, RotateCcw, CloudRain, AlertTriangle, 
  Droplets, Zap, Clock 
} from 'lucide-react';

/**
 * TacticalPlaybackBar
 * Controls the digital twin execution:
 * - Run Simulation button
 * - SIM CLOCK display (T+XX min)
 * - Play/Pause & Speed Multipliers (1x, 2x, 5x)
 * - Timeline Scrubber Slider
 * - Continuous Numeric Hydrologic Sliders:
 *   1. Rainfall Intensity (0 to 300 mm/hr)
 *   2. Storm Duration (1 to 24 hrs)
 *   3. Initial Water Level (0.0 to 2.5 m)
 * - Event Toggles (Drain Failure, Block Canal)
 */
function TacticalPlaybackBar({
  currentStep,
  totalSteps,
  currentTimeMin,
  timesMin = [],
  isPlaying,
  setIsPlaying,
  playbackSpeed,
  setPlaybackSpeed,
  onStepChange,
  onReset,
  // Continuous Numeric Hydrologic Parameters
  intensityMmHr = 75,
  setIntensityMmHr,
  durationHrs = 4,
  setDurationHrs,
  initialWaterM = 0.0,
  setInitialWaterM,
  drainFailure,
  setDrainFailure,
  blockage,
  setBlockage,
  onRunSimulation,
  isLoading = false,
}) {
  const speeds = [1, 2, 5];

  // Format SIM CLOCK to T+000 MIN or HH:MM
  const formatSimClock = (mins) => {
    const totalMinutes = Math.floor(mins || 0);
    const hours = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `T+${String(totalMinutes).padStart(3, '0')} MIN (${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')})`;
  };

  return (
    <div className="w-full bg-slate-900/95 border-b border-teal-500/20 shadow-xl backdrop-blur-md px-4 sm:px-6 py-3.5 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-3.5">
        
        {/* ROW 1: PRIMARY PLAYBACK & RUN ENGINE */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          
          {/* SIM CLOCK & RUN BUTTON */}
          <div className="flex items-center space-x-3 w-full lg:w-auto justify-between lg:justify-start">
            {/* Run Simulation Button */}
            <button
              onClick={onRunSimulation}
              disabled={isLoading}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-mono font-bold text-sm tracking-wide transition-all cursor-pointer ${
                isLoading
                  ? 'bg-teal-950 text-teal-400/60 border border-teal-800 cursor-not-allowed'
                  : 'bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-[0_0_20px_rgba(20,184,166,0.5)] active:scale-95'
              }`}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>CALCULATING...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current text-slate-950" />
                  <span>RUN SIMULATION</span>
                </>
              )}
            </button>

            {/* SIM CLOCK HUD DISPLAY */}
            <div className="flex items-center space-x-2.5 bg-slate-950 px-4 py-2 rounded-lg border border-teal-500/40 shadow-inner">
              <Clock className="w-4 h-4 text-teal-400 animate-pulse" />
              <div className="flex flex-col">
                <span className="text-[9px] font-mono text-slate-400 uppercase tracking-widest leading-none">
                  SIM CLOCK
                </span>
                <span className="font-mono text-sm sm:text-base font-bold text-teal-300 tracking-wider">
                  {formatSimClock(currentTimeMin)}
                </span>
              </div>
            </div>
          </div>

          {/* PLAYBACK CONTROLS (Play, Pause, Speed) */}
          <div className="flex items-center space-x-2 w-full lg:w-auto justify-center">
            {/* Reset */}
            <button
              onClick={onReset}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Reset to T+000"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-mono font-bold text-xs tracking-wider transition cursor-pointer ${
                isPlaying
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                  : 'bg-teal-500/20 text-teal-300 border border-teal-500/50 hover:bg-teal-500/30 shadow-[0_0_15px_rgba(20,184,166,0.25)]'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>PAUSE</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>PLAY</span>
                </>
              )}
            </button>

            {/* Speed Multipliers */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => setPlaybackSpeed(s)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition cursor-pointer ${
                    playbackSpeed === s
                      ? 'bg-teal-500 text-slate-950 shadow-[0_0_8px_#14b8a6]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* TIMELINE SLIDER WITH SCRUBBER */}
          <div className="flex items-center space-x-3 w-full lg:w-1/3">
            <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">0m</span>
            <div className="relative w-full flex items-center">
              <input
                type="range"
                min={0}
                max={Math.max(0, totalSteps - 1)}
                value={currentStep}
                onChange={(e) => onStepChange(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer border border-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-400 accent-teal-400"
              />
              {/* Event markers on timeline */}
              <div 
                className="absolute top-3 text-[9px] font-mono text-amber-400 flex items-center pointer-events-none"
                style={{ left: '25%' }}
                title="Canal Blockage event (t=30m)"
              >
                ▲ 30m
              </div>
              <div 
                className="absolute top-3 text-[9px] font-mono text-red-400 flex items-center pointer-events-none"
                style={{ left: '50%' }}
                title="Drain Failure event (t=60m)"
              >
                ▲ 60m
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
              {timesMin.length > 0 ? `${Math.round(timesMin[timesMin.length - 1])}m` : '120m'}
            </span>
          </div>

        </div>

        {/* ROW 2: THREE CONTINUOUS HYDROLOGIC SLIDERS & EVENT TOGGLES */}
        <div className="pt-2.5 border-t border-slate-800/80 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 text-xs">
          
          {/* THREE CONTINUOUS SLIDERS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full xl:w-3/4">
            
            {/* Slider 1: Rainfall Intensity (0 to 300 mm/hr) */}
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 flex flex-col space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-slate-400 font-mono">
                <span className="flex items-center space-x-1.5 text-teal-400 font-bold">
                  <CloudRain className="w-3.5 h-3.5" />
                  <span>RAINFALL INTENSITY</span>
                </span>
                <span className="text-white font-bold px-1.5 py-0.5 rounded bg-teal-950/80 border border-teal-500/40 text-[11px]">
                  {intensityMmHr} mm/hr
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                step={1}
                value={intensityMmHr}
                onChange={(e) => setIntensityMmHr && setIntensityMmHr(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-teal-400 border border-teal-500/30"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>0 mm/h (Dry)</span>
                <span>150</span>
                <span>300 (Torrential)</span>
              </div>
            </div>

            {/* Slider 2: Storm Duration (1 to 24 hrs) */}
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 flex flex-col space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-slate-400 font-mono">
                <span className="flex items-center space-x-1.5 text-cyan-400 font-bold">
                  <Clock className="w-3.5 h-3.5" />
                  <span>STORM DURATION</span>
                </span>
                <span className="text-white font-bold px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-[11px]">
                  {durationHrs} hrs
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={24}
                step={0.5}
                value={durationHrs}
                onChange={(e) => setDurationHrs && setDurationHrs(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-500/30"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>1 hr (Flash)</span>
                <span>12 hrs</span>
                <span>24 hrs (Monsoon)</span>
              </div>
            </div>

            {/* Slider 3: Initial Water Level (0.0 to 2.5 m, step 0.1m) */}
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 flex flex-col space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-slate-400 font-mono">
                <span className="flex items-center space-x-1.5 text-blue-400 font-bold">
                  <Droplets className="w-3.5 h-3.5" />
                  <span>INITIAL WATER LEVEL</span>
                </span>
                <span className="text-white font-bold px-1.5 py-0.5 rounded bg-blue-950/80 border border-blue-500/40 text-[11px]">
                  {initialWaterM.toFixed(1)} m
                </span>
              </div>
              <input
                type="range"
                min={0.0}
                max={2.5}
                step={0.1}
                value={initialWaterM}
                onChange={(e) => setInitialWaterM && setInitialWaterM(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-blue-400 border border-blue-500/30"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>0.0m (Dry)</span>
                <span>1.2m</span>
                <span>2.5m (Standing Flood)</span>
              </div>
            </div>

          </div>

          {/* BONUS EVENT TOGGLE BUTTONS */}
          <div className="flex items-center space-x-3 w-full xl:w-auto justify-end">
            <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">DISRUPTIONS:</span>
            
            {/* Drain Failure Toggle */}
            <button
              onClick={() => setDrainFailure(!drainFailure)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg font-mono text-xs font-semibold border transition cursor-pointer ${
                drainFailure
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${drainFailure ? 'text-amber-400' : 'text-slate-400'}`} />
              <span>Drain Failure (60%)</span>
              <span className={`w-2 h-2 rounded-full ${drainFailure ? 'bg-amber-400 animate-ping' : 'bg-slate-700'}`} />
            </button>

            {/* Block Canal Toggle */}
            <button
              onClick={() => setBlockage(!blockage)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg font-mono text-xs font-semibold border transition cursor-pointer ${
                blockage
                  ? 'bg-red-500/20 text-red-300 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                  : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <Droplets className={`w-3.5 h-3.5 ${blockage ? 'text-red-400' : 'text-slate-400'}`} />
              <span>Block Canal (100%)</span>
              <span className={`w-2 h-2 rounded-full ${blockage ? 'bg-red-400 animate-ping' : 'bg-slate-700'}`} />
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}

export default React.memo(TacticalPlaybackBar);

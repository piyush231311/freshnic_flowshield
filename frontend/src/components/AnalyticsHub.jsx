import React, { useMemo, useState } from 'react';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, 
  CartesianGrid, ReferenceLine, Area, AreaChart 
} from 'recharts';
import { 
  Activity, TrendingUp, AlertTriangle, Shield, AlertOctagon, 
  Droplets, Users, ArrowUpDown, ChevronRight, Eye, Split 
} from 'lucide-react';
import { useSimulationStore } from '../store/useSimulationStore';

/**
 * AnalyticsHub
 * Tab 2: Core analytical view combining:
 * 1. Hydrograph: Water depth time-series with critical threshold reference line.
 * 2. 16-Zone Data Table: Real-time zone status, depth, and affected population.
 */
function AnalyticsHub({
  timesMin = [],
  currentStep = 0,
  currentTimeMin = 0,
  selectedWardId = 0,
  setSelectedWardId,
  regionStatus = [],
  regionData = [],
  regionDepth = [],
  regionAffected = [],
}) {
  const CRITICAL_LIMIT = 0.50; // Metres
  const WARNING_LIMIT = 0.25;  // Metres

  const [chartMetric, setChartMetric] = useState('depth'); // 'depth' | 'affected'

  const simData = useSimulationStore((state) => state.simData);
  const showBaseline = useSimulationStore((state) => state.showBaseline);

  // Generate hydrograph chart data for the selected ward
  const chartData = useMemo(() => {
    if (!timesMin || timesMin.length === 0) return [];

    const ward = regionData && regionData[selectedWardId] ? regionData[selectedWardId] : null;

    return timesMin.map((t, idx) => {
      let depth = 0;
      let affected = 0;
      let status = 0;

      if (ward && ward.depth) {
        depth = ward.depth[idx] !== undefined ? ward.depth[idx] : 0;
        affected = ward.affected ? ward.affected[idx] : 0;
        status = ward.status ? ward.status[idx] : 0;
      } else if (regionDepth && regionDepth[idx]) {
        depth = regionDepth[idx][selectedWardId] || 0;
        affected = regionAffected && regionAffected[idx] ? regionAffected[idx][selectedWardId] : 0;
        status = regionStatus && regionStatus[idx] ? regionStatus[idx][selectedWardId] : 0;
      }

      const cityAffected = simData?.affected_pop?.[idx] != null ? Math.round(simData.affected_pop[idx]) : Math.round(affected);
      const baselineAffected = simData?.impact?.baseline_affected_pop?.[idx] != null
        ? Math.round(simData.impact.baseline_affected_pop[idx])
        : (simData?.baseline_affected_pop?.[idx] != null ? Math.round(simData.baseline_affected_pop[idx]) : null);

      return {
        time: Math.round(t),
        depth: parseFloat(depth.toFixed(3)),
        affected: Math.round(affected),
        cityAffected,
        baselineAffected,
        status,
      };
    });
  }, [timesMin, selectedWardId, regionData, regionDepth, regionAffected, regionStatus, simData]);

  // Selected ward summary stats
  const selectedWardStats = useMemo(() => {
    const ward = regionData && regionData[selectedWardId] ? regionData[selectedWardId] : null;
    const currentDepth = chartData[currentStep]?.depth || 0;
    const currentAffected = chartData[currentStep]?.affected || 0;
    const peakDepth = chartData.reduce((max, d) => Math.max(max, d.depth), 0);
    const peakAffected = chartData.reduce((max, d) => Math.max(max, d.affected), 0);

    let status = 0;
    if (regionStatus && regionStatus[currentStep] && regionStatus[currentStep][selectedWardId] !== undefined) {
      status = regionStatus[currentStep][selectedWardId];
    }

    return {
      name: ward ? ward.name : `Ward ${String(selectedWardId + 1).padStart(2, '0')}`,
      code: `W-${String(selectedWardId + 1).padStart(2, '0')}`,
      currentDepth,
      currentAffected,
      peakDepth,
      peakAffected,
      status,
      totalPop: ward ? ward.total_pop : 7500,
    };
  }, [selectedWardId, chartData, currentStep, regionData, regionStatus]);

  // All 16 wards table data
  const tableData = useMemo(() => {
    const rows = [];
    for (let i = 0; i < 16; i++) {
      const ward = regionData && regionData[i] ? regionData[i] : null;
      const code = `W-${String(i + 1).padStart(2, '0')}`;
      const name = ward ? ward.name : `Ward ${String(i + 1).padStart(2, '0')}`;

      let currentDepth = 0;
      if (ward && ward.depth) {
        currentDepth = ward.depth[currentStep] || 0;
      } else if (regionDepth && regionDepth[currentStep]) {
        currentDepth = regionDepth[currentStep][i] || 0;
      }

      let currentAffected = 0;
      if (ward && ward.affected) {
        currentAffected = ward.affected[currentStep] || 0;
      } else if (regionAffected && regionAffected[currentStep]) {
        currentAffected = regionAffected[currentStep][i] || 0;
      }

      let status = 0;
      if (regionStatus && regionStatus[currentStep]) {
        status = regionStatus[currentStep][i] || 0;
      }

      let peakDepth = 0;
      if (ward && ward.max_depth) {
        peakDepth = Math.max(...ward.max_depth);
      } else if (ward && ward.depth) {
        peakDepth = Math.max(...ward.depth);
      }

      rows.push({
        id: i,
        code,
        name,
        depth: currentDepth,
        affected: currentAffected,
        status,
        peakDepth,
        totalPop: ward ? ward.total_pop : 7500,
      });
    }
    return rows;
  }, [currentStep, regionData, regionDepth, regionAffected, regionStatus]);

  // Custom Chart Tooltip
  const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-950/95 border border-teal-500/50 p-2.5 rounded-lg shadow-2xl font-mono text-xs text-slate-200">
          <div className="font-bold text-teal-300 pb-1 border-b border-slate-800">
            Time: T+{label} min
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Water Depth:</span>
              <span className="font-bold text-white">{data.depth.toFixed(3)} m</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Ward Affected:</span>
              <span className="font-bold text-teal-300">{data.affected.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">City Affected:</span>
              <span className="font-bold text-cyan-300">{data.cityAffected.toLocaleString()}</span>
            </div>
            {data.baselineAffected !== null && (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Baseline (No Disruption):</span>
                  <span className="font-bold text-slate-300">{data.baselineAffected.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Disruption Delta:</span>
                  <span className="font-bold text-amber-400">
                    {data.cityAffected - data.baselineAffected >= 0 ? '+' : ''}
                    {(data.cityAffected - data.baselineAffected).toLocaleString()}
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">Risk Status:</span>
              <span className={`font-bold ${
                data.depth >= CRITICAL_LIMIT ? 'text-red-400' : data.depth >= WARNING_LIMIT ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {data.depth >= CRITICAL_LIMIT ? 'CRITICAL' : data.depth >= WARNING_LIMIT ? 'WARNING' : 'SAFE'}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      
      {/* HYDROGRAPH SECTION */}
      <div className="bg-slate-900/90 rounded-2xl border border-teal-500/30 p-4 sm:p-6 shadow-2xl backdrop-blur-md">
        
        {/* Hydrograph Header & Controls */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-teal-400 animate-pulse" />
              <h2 className="text-lg font-bold font-mono text-white tracking-wide">
                {chartMetric === 'depth' ? 'WARD HYDROGRAPH // DEPTH TIME-SERIES' : 'CITY-WIDE IMPACT // AFFECTED POPULATION'}
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {chartMetric === 'depth'
                ? 'Transient water inundation curve with safety threshold baselines'
                : 'Transient affected population curve with clean same-storm baseline overlay'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Metric Toggle: Depth vs Affected Population */}
            <div className="flex items-center rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-mono">
              <button
                type="button"
                onClick={() => setChartMetric('depth')}
                className={`px-3 py-1 rounded-md transition font-bold cursor-pointer ${
                  chartMetric === 'depth'
                    ? 'bg-teal-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Water Depth (m)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('affected')}
                className={`px-3 py-1 rounded-md transition font-bold flex items-center gap-1.5 cursor-pointer ${
                  chartMetric === 'affected'
                    ? 'bg-teal-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>Affected Population</span>
                {simData?.impact && (
                  <span className={`px-1 py-0.2 rounded text-[9px] ${
                    chartMetric === 'affected' ? 'bg-slate-950 text-teal-300' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    BASELINE
                  </span>
                )}
              </button>
            </div>

            {/* Ward Quick Switcher (active in depth mode) */}
            {chartMetric === 'depth' && (
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono text-slate-400">ACTIVE WARD:</span>
                <select
                  value={selectedWardId}
                  onChange={(e) => setSelectedWardId(parseInt(e.target.value, 10))}
                  className="bg-slate-950 border border-teal-500/40 text-teal-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer"
                >
                  {Array.from({ length: 16 }).map((_, i) => (
                    <option key={i} value={i}>
                      W-{String(i + 1).padStart(2, '0')} (Ward {String(i + 1).padStart(2, '0')})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Selected Ward Telemetry Cards (in depth mode) */}
        {chartMetric === 'depth' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Current Depth</span>
              <div className="text-lg font-bold font-mono text-white mt-0.5">
                {selectedWardStats.currentDepth.toFixed(2)} m
              </div>
            </div>
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Peak Depth</span>
              <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                {selectedWardStats.peakDepth.toFixed(2)} m
              </div>
            </div>
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Affected Citizens</span>
              <div className="text-lg font-bold font-mono text-teal-300 mt-0.5">
                {Math.round(selectedWardStats.currentAffected).toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400 uppercase">Current Status</span>
              <div className="mt-1">
                <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold ${
                  selectedWardStats.status === 2 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50' 
                    : selectedWardStats.status === 1 
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' 
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                }`}>
                  {selectedWardStats.status === 2 ? 'CRITICAL' : selectedWardStats.status === 1 ? 'WARNING' : 'SAFE'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Recharts Area Chart Container */}
        <div className="w-full h-80 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="hydroTeal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis 
                dataKey="time" 
                stroke="#64748b" 
                fontSize={11} 
                fontFamily="monospace"
                tickFormatter={(val) => `${val}m`}
              />
              {chartMetric === 'depth' ? (
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  fontFamily="monospace"
                  tickFormatter={(val) => `${val.toFixed(2)}m`}
                  domain={[0, (dataMax) => Math.max(0.7, Math.ceil(dataMax * 1.2 * 10) / 10)]}
                />
              ) : (
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  fontFamily="monospace"
                  tickFormatter={(val) => val.toLocaleString()}
                  domain={[0, (dataMax) => Math.max(100, Math.ceil(dataMax * 1.15))]}
                />
              )}
              <Tooltip content={<CustomChartTooltip />} />

              {chartMetric === 'depth' && (
                <>
                  {/* Dotted Red Line for Critical Limit (0.50m) */}
                  <ReferenceLine 
                    y={CRITICAL_LIMIT} 
                    stroke="#ef4444" 
                    strokeDasharray="4 4" 
                    strokeWidth={2}
                    label={{ 
                      value: 'CRITICAL LIMIT (0.50m)', 
                      fill: '#ef4444', 
                      fontSize: 10, 
                      fontFamily: 'monospace',
                      position: 'insideTopRight' 
                    }} 
                  />

                  {/* Dotted Amber Line for Warning Limit (0.25m) */}
                  <ReferenceLine 
                    y={WARNING_LIMIT} 
                    stroke="#f59e0b" 
                    strokeDasharray="3 3" 
                    strokeWidth={1.5}
                    label={{ 
                      value: 'WARNING (0.25m)', 
                      fill: '#f59e0b', 
                      fontSize: 10, 
                      fontFamily: 'monospace',
                      position: 'insideTopRight' 
                    }} 
                  />
                </>
              )}

              {/* Vertical Time Marker for Current Step */}
              <ReferenceLine 
                x={Math.round(currentTimeMin)} 
                stroke="#2dd4bf" 
                strokeWidth={2}
                label={{ 
                  value: `NOW (T+${Math.round(currentTimeMin)}m)`, 
                  fill: '#2dd4bf', 
                  fontSize: 10, 
                  fontFamily: 'monospace',
                  position: 'insideTopLeft' 
                }} 
              />

              {chartMetric === 'depth' ? (
                /* Water Depth Area Fill */
                <Area 
                  type="monotone" 
                  dataKey="depth" 
                  stroke="#14b8a6" 
                  strokeWidth={2.5} 
                  fillOpacity={1} 
                  fill="url(#hydroTeal)" 
                />
              ) : (
                <>
                  {/* City Affected Population Area Fill */}
                  <Area 
                    type="monotone" 
                    dataKey="cityAffected" 
                    name="With Disruption"
                    stroke="#14b8a6" 
                    strokeWidth={2.5} 
                    fillOpacity={1} 
                    fill="url(#hydroTeal)" 
                  />
                  {/* Dashed Baseline Overlay Line */}
                  <Line 
                    type="monotone" 
                    dataKey="baselineAffected" 
                    name="Baseline (Without Disruption)" 
                    stroke="#94a3b8" 
                    strokeWidth={2} 
                    strokeDasharray="5 5" 
                    dot={false} 
                  />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend for Affected Population mode */}
        {chartMetric === 'affected' && (
          <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-end gap-4 text-xs font-mono">
            <div className="flex items-center space-x-2">
              <span className="w-4 h-1 bg-teal-400 rounded-full inline-block"></span>
              <span className="text-slate-300">Active Storm Run (with Disruption)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-4 h-0 border-b-2 border-dashed border-slate-400 inline-block"></span>
              <span className="text-slate-400">Baseline (Same Storm, No Disruption)</span>
            </div>
          </div>
        )}

      </div>

      {/* 16-ZONE DATA TABLE */}
      <div className="bg-slate-900/90 rounded-2xl border border-teal-500/30 overflow-hidden shadow-2xl backdrop-blur-md">
        
        {/* Table Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center space-x-2">
              <Shield className="w-5 h-5 text-teal-400" />
              <h2 className="text-lg font-bold font-mono text-white tracking-wide">
                ZONE TELEMETRY MATRIX // ALL 16 WARDS
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Live ward status, instantaneous depth, and affected population at current sim clock
            </p>
          </div>

          <div className="text-xs font-mono text-slate-400">
            Click any row to display its Hydrograph above
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Zone Code</th>
                <th className="py-3 px-4">Ward Name</th>
                <th className="py-3 px-4">Current Depth</th>
                <th className="py-3 px-4">Peak Depth</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Affected Citizens</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {tableData.map((row) => {
                const isSelected = selectedWardId === row.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedWardId(row.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-teal-500/15 border-l-4 border-l-teal-400'
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    {/* Zone Code */}
                    <td className="py-3 px-4 font-bold text-teal-300">
                      {row.code}
                    </td>

                    {/* Ward Name */}
                    <td className="py-3 px-4 font-sans text-white">
                      {row.name}
                    </td>

                    {/* Current Depth */}
                    <td className="py-3 px-4 font-bold text-white">
                      {row.depth.toFixed(2)} m
                    </td>

                    {/* Peak Depth */}
                    <td className="py-3 px-4 text-slate-400">
                      {row.peakDepth.toFixed(2)} m
                    </td>

                    {/* Status Pill */}
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold ${
                        row.status === 2
                          ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                          : row.status === 1
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                      }`}>
                        {row.status === 2 ? 'CRITICAL' : row.status === 1 ? 'WARNING' : 'SAFE'}
                      </span>
                    </td>

                    {/* Affected Citizens */}
                    <td className="py-3 px-4 font-bold text-teal-300">
                      {Math.round(row.affected).toLocaleString()}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWardId(row.id);
                        }}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition flex items-center space-x-1 ml-auto cursor-pointer ${
                          isSelected
                            ? 'bg-teal-500 text-slate-950 font-bold'
                            : 'bg-slate-800 text-slate-300 hover:bg-teal-500/20 hover:text-teal-300'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>{isSelected ? 'INSPECTING' : 'INSPECT'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}

export default React.memo(AnalyticsHub);


import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Shield, AlertTriangle, AlertOctagon, Droplets, Users, 
  Mountain, Eye, Activity, MapPin 
} from 'lucide-react';

import { SingleNodeRainCanvas } from './TacticalRainOverlay';

/**
 * Programmatic Zone Classification based on prompt specification:
 * if total_population > 10,000 output 'Dense Commercial', else output 'Residential'
 */
const getZoneClassification = (totalPop) => {
  const pop = Number(totalPop) || 0;
  if (pop > 10000) {
    return {
      label: 'Dense Commercial',
      badgeClass: 'text-rose-400 bg-rose-500/10 border-rose-500/40',
      desc: 'High-density commercial & transportation corridor',
    };
  }
  return {
    label: 'Residential',
    badgeClass: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/40',
    desc: 'Moderate-density urban residential sector',
  };
};

/**
 * TacticalNodeNetwork
 * Core tactical visualization for Tab 1: City Map.
 * Renders the 16 wards as connected circular nodes in a 4x4 schematic topology.
 * Features:
 * - Un-clipped hover tooltip rendered at root DOM level via React createPortal (z-50, escapes all parent bounds).
 * - Pinned 'Zone Details' panel when a node is clicked.
 * - Displays Zone ID, Zone Classification, Average Elevation (m), Current Depth (m), Status Pill, and Affected Citizens fraction.
 * - Responsive HTML5 canvas rain animation with status-linked intensity.
 */
function TacticalNodeNetwork({
  currentStep = 0,
  regionStatus = [],
  regionData = [],
  regionDepth = [],
  regionAffected = [],
  zones = {},
  edgeFlows = [],
  fluxTimeline = [],
  fluxMatrix = null,
  currentTimeMin = 0,
  selectedWardId = 0,
  onSelectWard,
}) {
  // State for React Portal Tooltip: escapes all parent bounding boxes and overflow clipping
  const [portalTooltip, setPortalTooltip] = useState(null);

  // Grid dimensions for 4x4 wards (coordinates in SVG space: 0..800 x 0..600)
  const cols = 4;
  const rows = 4;
  const width = 800;
  const height = 600;
  const paddingX = 100;
  const paddingY = 80;
  const stepX = (width - paddingX * 2) / (cols - 1);
  const stepY = (height - paddingY * 2) / (rows - 1);

  // Status definitions conforming strictly to requirements
  const STATUS_CONFIG = {
    0: {
      label: 'SAFE',
      color: '#10b981', // Bright Green
      textColor: 'text-emerald-400',
      bgPill: 'bg-emerald-500/20',
      borderPill: 'border-emerald-500/50',
      glow: 'glow-teal',
      ringColor: 'rgba(16, 185, 129, 0.4)',
      icon: Shield,
    },
    1: {
      label: 'WARNING',
      color: '#f59e0b', // Amber / Yellow
      textColor: 'text-amber-400',
      bgPill: 'bg-amber-500/20',
      borderPill: 'border-amber-500/50',
      glow: 'glow-amber',
      ringColor: 'rgba(245, 158, 11, 0.6)',
      icon: AlertTriangle,
    },
    2: {
      label: 'CRITICAL',
      color: '#ef4444', // Bright Red
      textColor: 'text-red-500',
      bgPill: 'bg-red-500/20',
      borderPill: 'border-red-500/50',
      glow: 'glow-red',
      ringColor: 'rgba(239, 68, 68, 0.8)',
      icon: AlertOctagon,
    },
  };

  // Node coordinates and metrics calculation
  const nodes = useMemo(() => {
    const list = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c;
        const x = paddingX + c * stepX;
        const y = paddingY + r * stepY;

        // Extract status for current time step
        let status = 0;
        if (regionStatus && regionStatus[currentStep] && regionStatus[currentStep][id] !== undefined) {
          status = regionStatus[currentStep][id];
        }

        // Extract depth for current time step
        let depth = 0;
        if (regionData && regionData[id] && regionData[id].depth) {
          depth = regionData[id].depth[currentStep] || 0;
        } else if (regionDepth && regionDepth[currentStep] && regionDepth[currentStep][id] !== undefined) {
          depth = regionDepth[currentStep][id];
        }

        // Extract affected citizens
        let affected = 0;
        if (regionData && regionData[id] && regionData[id].affected) {
          affected = regionData[id].affected[currentStep] || 0;
        } else if (regionAffected && regionAffected[currentStep] && regionAffected[currentStep][id] !== undefined) {
          affected = regionAffected[currentStep][id];
        }

        // Ward info & telemetry from API
        const rData = regionData && regionData[id] ? regionData[id] : null;
        const zData = zones && (zones[id] || zones[String(id)]) ? (zones[id] || zones[String(id)]) : null;
        
        const name = rData?.name || zData?.name || `Ward ${String(id + 1).padStart(2, '0')}`;
        const code = `W-${String(id + 1).padStart(2, '0')}`;
        const totalPop = rData?.total_population || rData?.total_pop || zData?.total_population || zData?.total_pop || 7500;
        const averageElevation = rData?.average_elevation ?? zData?.average_elevation ?? 6.5;
        const tCrit = zData?.t_crit ?? null;
        const peakDepth = zData?.peak_depth ?? (rData?.max_depth ? Math.max(...rData.max_depth) : depth);
        const classification = getZoneClassification(totalPop);
        const primaryFloodSource = rData?.primary_flood_source || zData?.primary_flood_source || 'Self-Contained';
        const earlyWarning = zData?.early_warning || null;

        list.push({
          id,
          code,
          name,
          row: r,
          col: c,
          x,
          y,
          status,
          depth,
          peakDepth,
          affected,
          totalPop,
          averageElevation,
          tCrit,
          classification,
          primaryFloodSource,
          earlyWarning,
        });
      }
    }
    return list;
  }, [currentStep, regionStatus, regionData, regionDepth, regionAffected, zones, stepX, stepY]);

  // Currently selected node for the Pinned Zone Details Panel
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedWardId) || nodes[0] || null;
  }, [nodes, selectedWardId]);

  // Conduits connecting adjacent nodes (horizontal and vertical)
  const conduits = useMemo(() => {
    const list = [];
    // Horizontal edges
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const u = r * cols + c;
        const v = r * cols + (c + 1);
        list.push({ from: u, to: v, key: `h-${r}-${c}` });
      }
    }
    // Vertical edges
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const u = r * cols + c;
        const v = (r + 1) * cols + c;
        list.push({ from: u, to: v, key: `v-${r}-${c}` });
      }
    }
    return list;
  }, []);



  // Safe extraction of edge flows for currentStep
  const edgeMap = useMemo(() => {
    const map = new Map();
    const frame = edgeFlows?.[currentStep];
    if (Array.isArray(frame)) {
      frame.forEach((e) => {
        if (e?.key) map.set(e.key, e);
      });
    }
    return map;
  }, [edgeFlows, currentStep]);

  // Handle node hover with viewport-relative coordinates for React Portal
  const handleMouseEnter = (node, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // If node is near top of viewport (< 220px), place tooltip below the node so it never clips top boundary
    const showBelow = rect.top < 220;
    setPortalTooltip({
      node,
      x: rect.left + rect.width / 2,
      y: showBelow ? rect.bottom + 8 : rect.top - 8,
      placement: showBelow ? 'bottom' : 'top',
    });
  };

  const handleMouseLeave = () => {
    setPortalTooltip(null);
  };

  return (
    <div className="space-y-6">
      
      {/* 1. TOP SCHEMATIC MAP CONTAINER */}
      <div className="relative w-full bg-slate-900/90 rounded-2xl border border-teal-500/30 shadow-2xl p-4 sm:p-6 tactical-grid-bg">
        
        {/* HUD Header Banner */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping"></span>
              <h2 className="text-lg font-bold font-mono text-white tracking-wide">
                CITY DRAINAGE TOPOLOGY // 16-WARD SCHEMATIC
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Hydraulic-head fluid flux network • Topography-driven dynamic flow • Click node to pin zone
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-3 text-xs font-mono">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
              <span className="text-slate-300">SAFE</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
              <span className="text-slate-300">WARNING</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]"></span>
              <span className="text-slate-300">CRITICAL</span>
            </div>
          </div>
        </div>

        {/* Network Graph Canvas Container (NO overflow-hidden, allows smooth layout) */}
        <div className="relative w-full flex items-center justify-center my-4 overflow-x-auto">
          <div className="relative w-full max-w-[850px]">
            {/* SVG Conduit Flow Network (Background Layer) */}
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto drop-shadow-2xl select-none relative z-0"
            >
              <defs>
                <linearGradient id="conduitTeal" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#14b8a6" stopOpacity="1" />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity="0.8" />
                </linearGradient>

                <linearGradient id="conduitAmber" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#d97706" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
                  <stop offset="100%" stopColor="#d97706" stopOpacity="0.8" />
                </linearGradient>

                <linearGradient id="conduitRed" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#b91c1c" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#ef4444" stopOpacity="1" />
                  <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.8" />
                </linearGradient>
              </defs>

              {/* Conduits (Edges) with Sleek Tactical Fluid Streams & Smooth Node-Offset Curvature */}
              <g className="conduits">
                {conduits.map((edge) => {
                  const uNode = nodes[edge.from];
                  const vNode = nodes[edge.to];
                  if (!uNode || !vNode) return null;

                  // Telemetry Parsing & Water Gradient Fallback Logic
                  const eData = edgeMap.get(edge.key);
                  const edgeData = eData ? {
                    ...eData,
                    flux: eData.flux !== undefined 
                      ? eData.flux 
                      : ((eData.direction ?? (eData.flow_u_to_v >= eData.flow_v_to_u ? 1 : -1)) * (eData.net_flow || 0))
                  } : (fluxTimeline?.[currentStep] ? {
                    flux: (Number(fluxTimeline[currentStep][edge.from]?.[edge.to] || 0) - Number(fluxTimeline[currentStep][edge.to]?.[edge.from] || 0))
                  } : (fluxMatrix ? {
                    flux: (Number(fluxMatrix[edge.from]?.[edge.to] || 0) - Number(fluxMatrix[edge.to]?.[edge.from] || 0))
                  } : null));

                  const rawFlux = Number(edgeData?.flux) || 0;
                  let effectiveVolume = Math.abs(rawFlux);
                  let isReverse = rawFlux < 0;

                  // Fallback: If rawFlux === 0, calculate hydraulic head difference
                  if (rawFlux === 0) {
                    const elevA = uNode.elevation ?? uNode.averageElevation ?? 0;
                    const depthA = uNode.waterDepth ?? uNode.depth ?? 0;
                    const elevB = vNode.elevation ?? vNode.averageElevation ?? 0;
                    const depthB = vNode.waterDepth ?? vNode.depth ?? 0;

                    const headDiff = (elevA + depthA) - (elevB + depthB);

                    if (Math.abs(headDiff) > 0.02 || depthA > 0.05 || depthB > 0.05) {
                      effectiveVolume = Math.abs(headDiff) * 5;
                      isReverse = headDiff < 0;
                    }
                  }

                  // Task 2: High-Contrast Inactive vs. Active Channels
                  const isDormant = effectiveVolume <= 0.01;

                  // Task 1: Refined Stroke Width (executive tactical range: 2.5px to 3.5px, max 5px during flood surges)
                  const dynamicWidth = Math.min(5.0, Math.max(2.5, 2.5 + effectiveVolume * 1.0));
                  
                  // Task 1: Recalibrated Cycle Duration (dur) - Deliberate, readable human tracking
                  const animationDuration = Math.max(2.0, 4.5 - (effectiveVolume * 1.0));

                  // Task 3: Smooth, Natural Conduit Curvature & Clean Node Boundary Offset
                  const NODE_RADIUS = 32;
                  const isHorizontal = edge.key.startsWith('h-');
                  const dx = vNode.x - uNode.x;
                  const dy = vNode.y - uNode.y;
                  const dist = Math.hypot(dx, dy) || 1;

                  // Directional unit vectors
                  const ux = dx / dist;
                  const uy = dy / dist;

                  // Offset start and end points so paths terminate cleanly at the outer boundary of node circles
                  const sx = uNode.x + ux * NODE_RADIUS;
                  const sy = uNode.y + uy * NODE_RADIUS;
                  const ex = vNode.x - ux * NODE_RADIUS;
                  const ey = vNode.y - uy * NODE_RADIUS;

                  const spanX = ex - sx;
                  const spanY = ey - sy;

                  // Subtle, tensioned organic camber without awkward wiggles
                  const camber = ((edge.from + edge.to) % 2 === 0 ? 1 : -1) * 8;
                  let cx1, cy1, cx2, cy2;

                  if (isHorizontal) {
                    cx1 = sx + spanX * 0.35;
                    cy1 = sy + camber;
                    cx2 = sx + spanX * 0.65;
                    cy2 = ey + camber;
                  } else {
                    cx1 = sx + camber;
                    cy1 = sy + spanY * 0.35;
                    cx2 = ex + camber;
                    cy2 = sy + spanY * 0.65;
                  }

                  const pathString = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;

                  return (
                    <g key={edge.key}>
                      {/* Task 3: Background Conduit Bed - Static, subtle slate pipe */}
                      <path
                        d={pathString}
                        stroke="#0e3a4e"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        opacity={0.3}
                      />

                      {/* Task 1 & 2: Foreground Flowing Stream - Mathematically synced pulse travel */}
                      {!isDormant && (
                        <path
                          d={pathString}
                          stroke="#22d3ee"
                          strokeWidth={dynamicWidth}
                          strokeDasharray="40 60"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                          opacity={Math.min(1.0, 0.85 + effectiveVolume * 0.1)}
                          style={{
                            filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))',
                          }}
                        >
                          <animate
                            attributeName="stroke-dashoffset"
                            from={isReverse ? "0" : "100"}
                            to={isReverse ? "100" : "0"}
                            dur={`${animationDuration.toFixed(2)}s`}
                            repeatCount="indefinite"
                            calcMode="linear"
                          />
                        </path>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* 16 CIRCULAR WARD NODES */}
            {nodes.map((node) => {
              const isSelected = selectedWardId === node.id;
              const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG[0];
              const isCrit = node.status === 2;
              const isWarn = node.status === 1;

              return (
                /* The Parent Node Wrapper: Relative, cursor-pointer, onMouseEnter/Leave handles Portal positioning */
                <div
                  key={node.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16 cursor-pointer transition-transform duration-150 hover:scale-110 z-20"
                  style={{
                    left: `${(node.x / width) * 100}%`,
                    top: `${(node.y / height) * 100}%`,
                  }}
                  onClick={() => onSelectWard && onSelectWard(node.id)}
                  onMouseEnter={(e) => handleMouseEnter(node, e)}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Radar pulse ring for Critical / Warning */}
                  {isCrit && (
                    <div className="absolute -inset-3 rounded-full border-2 border-red-500 animate-radar pointer-events-none opacity-80" />
                  )}
                  {isWarn && (
                    <div className="absolute -inset-2 rounded-full border border-amber-500 animate-radar pointer-events-none opacity-60" />
                  )}

                  {/* Node Circular Face */}
                  <div
                    className={`w-full h-full rounded-full flex flex-col items-center justify-center border-2 transition-all shadow-lg ${
                      isSelected ? 'ring-2 ring-teal-400 border-teal-400 shadow-[0_0_15px_#14b8a6]' : ''
                    }`}
                    style={{
                      backgroundColor: '#0f172a',
                      borderColor: cfg.color,
                      boxShadow: `0 0 12px ${cfg.ringColor}`,
                    }}
                  >
                    <span className="font-mono text-[11px] font-bold text-white leading-tight">
                      {node.code}
                    </span>
                    <span
                      className="font-mono text-[9px] font-bold leading-tight"
                      style={{ color: cfg.color }}
                    >
                      {node.depth.toFixed(2)}m
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-0.5"
                      style={{ backgroundColor: cfg.color }}
                    />
                  </div>

                  {/* Canvas Rain Animation Layer: strictly inner circular mask */}
                  <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                    <SingleNodeRainCanvas status={node.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Ward Quick Bar at Bottom */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-slate-400">
          <div className="flex items-center space-x-2">
            <Eye className="w-4 h-4 text-teal-400" />
            <span>SELECTED WARD:</span>
            <span className="text-teal-300 font-bold px-2 py-0.5 rounded bg-teal-950/60 border border-teal-500/40">
              W-{String(selectedWardId + 1).padStart(2, '0')}
            </span>
            <span className="text-slate-400 text-xs font-sans">
              (Telemetry pinned in Zone Details panel below)
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            Simulation Time: <span className="text-white font-bold">{Math.round(currentTimeMin)} min</span>
          </div>
        </div>

      </div>

      {/* 2. PINNED 'ZONE DETAILS' SIDE/BOTTOM INSPECTOR PANEL */}
      {selectedNode && (
        <div className="bg-slate-900/95 rounded-2xl border border-teal-500/40 p-5 shadow-2xl backdrop-blur-md transition-all duration-200">
          
          {/* Panel Top Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="px-3 py-1.5 rounded-xl bg-teal-950/80 border border-teal-500/60 text-teal-300 font-mono font-extrabold text-base tracking-wider shadow-lg">
                {selectedNode.code}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold font-mono text-white">
                    {selectedNode.name} // SECTOR TELEMETRY
                  </h3>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border ${selectedNode.classification.badgeClass}`}>
                    {selectedNode.classification.label}
                  </span>
                  <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 shadow-sm">
                    Primary Inflow Source: {selectedNode.primaryFloodSource || 'Self-Contained'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {selectedNode.classification.desc}
                </p>
              </div>
            </div>

            {/* Status Pill */}
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono text-slate-400">STATUS:</span>
              <span className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border ${STATUS_CONFIG[selectedNode.status].bgPill} ${STATUS_CONFIG[selectedNode.status].textColor} ${STATUS_CONFIG[selectedNode.status].borderPill} flex items-center space-x-1.5 shadow-md`}>
                <span className={`w-2 h-2 rounded-full animate-ping ${selectedNode.status === 2 ? 'bg-red-500' : selectedNode.status === 1 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span>{STATUS_CONFIG[selectedNode.status].label}</span>
              </span>
            </div>
          </div>

          {/* Deep Region Data Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            
            {/* Metric 1: Current Inundation Depth */}
            <div className="bg-slate-950/90 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
                <span className="flex items-center gap-1.5">
                  <Droplets className="w-4 h-4 text-cyan-400" />
                  CURRENT DEPTH
                </span>
                <span className="text-slate-400 text-[10px]">Threshold: 0.50m</span>
              </div>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {selectedNode.depth.toFixed(2)} <span className="text-sm font-normal text-slate-400">m</span>
              </div>
              {/* Depth Bar */}
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    selectedNode.status === 2 ? 'bg-red-500' : selectedNode.status === 1 ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, (selectedNode.depth / 1.2) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1.5">
                <span>Peak: {selectedNode.peakDepth.toFixed(2)} m</span>
                <span>{selectedNode.depth >= 0.50 ? 'CRITICAL LEVEL' : selectedNode.depth >= 0.25 ? 'ELEVATED' : 'NOMINAL'}</span>
              </div>
            </div>

            {/* Metric 2: Average Elevation (z) */}
            <div className="bg-slate-950/90 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
                <span className="flex items-center gap-1.5">
                  <Mountain className="w-4 h-4 text-amber-400" />
                  AVERAGE ELEVATION
                </span>
                <span className="text-amber-400/80 text-[10px]">Terrain z</span>
              </div>
              <div className="text-2xl font-bold font-mono text-amber-300 mt-1">
                {selectedNode.averageElevation.toFixed(2)} <span className="text-sm font-normal text-slate-400">m</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-2">
                {selectedNode.averageElevation < 6.0
                  ? 'Lowland river basin / Natural depression'
                  : selectedNode.averageElevation < 9.0
                  ? 'Midland urban plateau'
                  : 'Highland crest / Ridge'}
              </p>
              <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-1 mt-1">
                Datum: Sea-level benchmark
              </div>
            </div>

            {/* Metric 3: Affected Citizens (Count / Total Fraction) */}
            <div className="bg-slate-950/90 p-4 rounded-xl border border-slate-800 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-teal-400" />
                  AFFECTED CITIZENS
                </span>
                <span className="text-teal-400 font-bold text-[10px]">
                  {selectedNode.totalPop > 0
                    ? `${((selectedNode.affected / selectedNode.totalPop) * 100).toFixed(1)}%`
                    : '0%'}
                </span>
              </div>
              <div className="text-2xl font-bold font-mono text-teal-300 mt-1">
                {Math.round(selectedNode.affected).toLocaleString()}
                <span className="text-xs font-normal text-slate-400"> / {Math.round(selectedNode.totalPop).toLocaleString()}</span>
              </div>
              {/* Population Affected Bar */}
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-teal-400 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      selectedNode.totalPop > 0 ? (selectedNode.affected / selectedNode.totalPop) * 100 : 0
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-1 mt-1">
                Classification: {selectedNode.classification.label}
              </div>
            </div>

            {/* Live Dynamic Countdown Calculation (Task 1) */}
            {(() => {
              const curMin = typeof currentTimeMin === 'number' ? currentTimeMin : 0;
              const absoluteTCrit = selectedNode?.earlyWarning?.p50 ?? selectedNode?.tCrit ?? null;
              const timeRemaining = absoluteTCrit !== null && absoluteTCrit !== undefined
                ? Math.max(0, Math.round(absoluteTCrit - curMin))
                : null;
              const p10Remaining = selectedNode?.earlyWarning?.p10 != null
                ? Math.max(0, Math.round(selectedNode.earlyWarning.p10 - curMin))
                : null;
              const p90Remaining = selectedNode?.earlyWarning?.p90 != null
                ? Math.max(0, Math.round(selectedNode.earlyWarning.p90 - curMin))
                : null;
              const isBreachedNow = timeRemaining === 0 || selectedNode?.status === 2;

              return (
                <div className={`bg-slate-950/90 p-4 rounded-xl border ${isBreachedNow && selectedNode.earlyWarning?.breached ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'border-slate-800 shadow-lg'} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
                    <span className="flex items-center gap-1.5">
                      <Activity className={`w-4 h-4 ${isBreachedNow ? 'text-red-400' : 'text-purple-400'}`} />
                      ENSEMBLE EARLY WARNING
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {selectedNode.earlyWarning?.breached ? 'P50 Countdown' : 't_crit'}
                    </span>
                  </div>
                  <div className={`text-2xl font-bold font-mono mt-1 ${isBreachedNow && selectedNode.earlyWarning?.breached ? 'text-red-400 animate-pulse' : 'text-teal-300'}`}>
                    {selectedNode.earlyWarning?.breached ? (
                      timeRemaining === 0 ? (
                        'BREACH ACTIVE'
                      ) : (
                        `~${timeRemaining} min`
                      )
                    ) : selectedNode.tCrit !== null && selectedNode.tCrit !== undefined ? (
                      timeRemaining === 0 ? (
                        'BREACH ACTIVE'
                      ) : (
                        `~${timeRemaining} min`
                      )
                    ) : (
                      'NONE (SAFE)'
                    )}
                  </div>
                  <div className="text-[11px] font-mono mt-2 leading-snug">
                    {selectedNode.earlyWarning?.breached ? (
                      timeRemaining === 0 ? (
                        <span className="text-red-400 font-semibold">
                          Threshold reached (Onset: T+{Math.round(selectedNode.earlyWarning.p50)}m)
                        </span>
                      ) : (
                        <span className="text-amber-300 font-semibold">
                          CI P10–P90: {p10Remaining}m to {p90Remaining}m remaining
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">
                        {selectedNode.tCrit !== null && selectedNode.tCrit !== undefined
                          ? timeRemaining === 0
                            ? `Threshold breached at minute ${Math.round(selectedNode.tCrit)}`
                            : `~${timeRemaining}m until critical threshold`
                          : 'Remains below critical depth in confidence window'}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-1 mt-1">
                    {selectedNode.earlyWarning?.breached
                      ? `Risk: ${Math.round((selectedNode.earlyWarning.breach_probability || 1.0) * 100)}% • Onset: T+${Math.round(selectedNode.earlyWarning.p50)}m`
                      : 'Standard Monitoring • 0% Breach Risk'}
                  </div>
                </div>
              );
            })()}

          </div>

          {/* Probabilistic Warning Box (Tier 2 Hackathon Differentiator) with Live Countdown */}
          {(() => {
            const curMin = typeof currentTimeMin === 'number' ? currentTimeMin : 0;
            const absoluteTCrit = selectedNode?.earlyWarning?.p50 ?? selectedNode?.tCrit ?? null;
            const timeRemaining = absoluteTCrit !== null && absoluteTCrit !== undefined
              ? Math.max(0, Math.round(absoluteTCrit - curMin))
              : null;
            const p10Remaining = selectedNode?.earlyWarning?.p10 != null
              ? Math.max(0, Math.round(selectedNode.earlyWarning.p10 - curMin))
              : null;
            const p90Remaining = selectedNode?.earlyWarning?.p90 != null
              ? Math.max(0, Math.round(selectedNode.earlyWarning.p90 - curMin))
              : null;
            const isBreachedNow = timeRemaining === 0 || selectedNode?.status === 2;

            if (selectedNode.earlyWarning?.breached) {
              return (
                <div className={`mt-4 p-4 rounded-xl border ${isBreachedNow ? 'border-red-500/80 bg-red-950/50 shadow-[0_0_30px_rgba(239,68,68,0.35)]' : 'border-amber-500/60 bg-amber-950/30 shadow-[0_0_25px_rgba(245,158,11,0.2)]'} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono`}>
                  <div className="flex items-start sm:items-center space-x-3">
                    <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 sm:mt-0 ${isBreachedNow ? 'text-red-400 animate-bounce' : 'text-amber-400'}`} />
                    <div>
                      <div className={`text-xs sm:text-sm font-bold ${isBreachedNow ? 'text-red-200' : 'text-amber-200'}`}>
                        {timeRemaining === 0
                          ? `CRITICAL BREACH ACTIVE: Ward has reached critical inundation depth. (Initial breach at T+${Math.round(selectedNode.earlyWarning.p50)}m)`
                          : `CRITICAL WARNING: Ward projected to reach critical levels in ~${timeRemaining} mins. (Confidence Interval P10-P90: ${p10Remaining}m to ${p90Remaining}m)`}
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5 flex flex-wrap items-center gap-2">
                        <span>Primary Inflow Source: <strong className="text-cyan-300">{selectedNode.primaryFloodSource || 'Self-Contained'}</strong></span>
                        <span>•</span>
                        <span>20-Run Monte Carlo Ensemble (±10% Rain & Drainage Perturbations)</span>
                        <span>•</span>
                        <span className="text-amber-300/90">Current Storm Time: T+{Math.round(curMin)}m</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center space-x-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-slate-200 font-bold">
                      {timeRemaining === 0 ? 'P10: Reached' : `P10: ${p10Remaining}m`}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded font-extrabold shadow-md ${isBreachedNow ? 'bg-red-500 text-slate-950' : 'bg-amber-400 text-slate-950'}`}>
                      {timeRemaining === 0 ? 'P50: ACTIVE' : `P50: ~${timeRemaining}m`}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-slate-200 font-bold">
                      {timeRemaining === 0 ? 'P90: Reached' : `P90: ${p90Remaining}m`}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div className="mt-4 p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 font-mono text-xs text-emerald-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    SAFE: Ward projected to remain below critical depth throughout simulation window. (Confidence Interval: 0% breach across 20 Monte Carlo runs).
                  </span>
                </div>
                <div className="shrink-0 text-[11px] text-slate-400">
                  Primary Inflow Source: <span className="text-cyan-300 font-bold">{selectedNode.primaryFloodSource || 'Self-Contained'}</span>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* 3. REACT PORTAL TOOLTIP (Renders into document.body to completely escape all CSS clipping & stacking contexts) */}
      {portalTooltip && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 transition-opacity duration-150"
          style={{
            left: `${portalTooltip.x}px`,
            top: `${portalTooltip.y}px`,
            transform: portalTooltip.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          {(() => {
            const node = portalTooltip.node;
            const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG[0];

            return (
              <div className="bg-slate-950/95 border border-teal-500/60 rounded-xl p-3.5 shadow-[0_0_35px_rgba(0,0,0,0.9)] backdrop-blur-md min-w-[260px] text-xs font-mono">
                {/* Header: Zone ID, Name, Status */}
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold text-teal-300 text-sm">{node.code}</span>
                    <span className="text-slate-300 font-sans text-xs">({node.name})</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cfg.bgPill} ${cfg.textColor} border ${cfg.borderPill}`}>
                    {cfg.label}
                  </span>
                </div>

                {/* Zone Classification Badge */}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Classification:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${node.classification.badgeClass}`}>
                    {node.classification.label}
                  </span>
                </div>

                {/* Metrics */}
                <div className="mt-2.5 space-y-1.5">
                  {/* Current Depth */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                      Current Depth:
                    </span>
                    <span className="text-white font-bold">{node.depth.toFixed(2)} m</span>
                  </div>

                  {/* Depth Gauge Bar */}
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        node.status === 2 ? 'bg-red-500' : node.status === 1 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, (node.depth / 1.0) * 100)}%` }}
                    />
                  </div>

                  {/* Average Elevation */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Mountain className="w-3.5 h-3.5 text-amber-400" />
                      Average Elevation:
                    </span>
                    <span className="text-amber-300 font-bold">
                      {node.averageElevation.toFixed(2)} m
                    </span>
                  </div>

                  {/* Affected Citizens Fraction */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-teal-400" />
                      Affected Citizens:
                    </span>
                    <span className="text-teal-300 font-bold">
                      {Math.round(node.affected).toLocaleString()} / {Math.round(node.totalPop).toLocaleString()}
                    </span>
                  </div>

                  {/* Primary Inflow Source */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      Inflow Source:
                    </span>
                    <span className="text-cyan-300 font-bold">
                      {node.primaryFloodSource || 'Self-Contained'}
                    </span>
                  </div>

                  {/* Early Warning Forecast (if breached) with Live Countdown */}
                  {node.earlyWarning?.breached && (() => {
                    const curMin = typeof currentTimeMin === 'number' ? currentTimeMin : 0;
                    const nodeTCrit = node.earlyWarning.p50;
                    const nodeRem = Math.max(0, Math.round(nodeTCrit - curMin));
                    const p10Rem = Math.max(0, Math.round(node.earlyWarning.p10 - curMin));
                    const p90Rem = Math.max(0, Math.round(node.earlyWarning.p90 - curMin));

                    return (
                      <div className={`mt-2 p-1.5 rounded border text-[10px] ${nodeRem === 0 ? 'bg-red-950/80 border-red-500/70 text-red-200' : 'bg-amber-950/60 border-amber-500/50 text-amber-200'}`}>
                        <div className="font-bold flex items-center gap-1">
                          <AlertTriangle className={`w-3 h-3 ${nodeRem === 0 ? 'text-red-400' : 'text-amber-400'}`} />
                          {nodeRem === 0 ? `Breach Active (at T+${Math.round(nodeTCrit)}m)` : `Breaches in ~${nodeRem}m`}
                        </div>
                        <div className="text-slate-300/80 mt-0.5">
                          {nodeRem === 0 ? 'Active Evacuation Protocol' : `CI: ${p10Rem}m to ${p90Rem}m remaining`}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="mt-2.5 pt-1.5 border-t border-slate-800 text-[10px] text-teal-400/80 text-center font-sans">
                  Click node to pin details panel ↗
                </div>
              </div>
            );
          })()}
        </div>,
        document.body
      )}

    </div>
  );
}

export default React.memo(TacticalNodeNetwork);

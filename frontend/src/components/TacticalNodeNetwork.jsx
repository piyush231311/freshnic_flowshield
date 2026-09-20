import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Shield, AlertTriangle, AlertOctagon, Droplets, Users, 
  Mountain, Eye, Activity, MapPin, AlertCircle 
} from 'lucide-react';

import { SingleNodeRainCanvas } from './TacticalRainOverlay';
import ZoneDetails from './ZoneDetails';
import { useSimulationStore } from '../store/useSimulationStore';

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
  timeline = [],
  currentTimeMin = 0,
  selectedWardId = 0,
  onSelectWard,
}) {
  // State for React Portal Tooltip: escapes all parent bounding boxes and overflow clipping
  const [portalTooltip, setPortalTooltip] = useState(null);

  // Simulation store selectors for disruption states
  const disruptionsPreview = useSimulationStore((state) => state.disruptionsPreview);
  const simData = useSimulationStore((state) => state.simData);
  const drainFailureToggle = useSimulationStore((state) => state.drainFailure);
  const blockageToggle = useSimulationStore((state) => state.blockage);
  const showBaseline = useSimulationStore((state) => state.showBaseline);

  // 1. Resolve Blockage Disruption State (Simulated truth > Preview armed)
  const blockageDisruption = useMemo(() => {
    const simBlock = simData?.disruptions?.find((d) => d.type === 'blockage');
    const previewBlock = disruptionsPreview?.find((d) => d.type === 'blockage');

    const event = simBlock || previewBlock || (blockageToggle ? {
      type: 'blockage',
      label: 'Canal Blockage (W-11)',
      t_start_min: 30.0,
      primary_ward_ids: [10],
      ward_overlap: { 10: 0.14 },
    } : null);

    if (!event && !blockageToggle) return null;

    const tStart = event?.t_start_min ?? 30.0;
    const isSimulated = Boolean(simBlock);
    const isActive = !showBaseline && isSimulated && currentTimeMin >= tStart;
    const isArmed = !showBaseline && (blockageToggle || Boolean(previewBlock) || isSimulated) && !isActive;

    return {
      ...event,
      primary_ward_ids: event?.primary_ward_ids || [10],
      isActive,
      isArmed,
      tStart,
    };
  }, [simData, disruptionsPreview, blockageToggle, currentTimeMin, showBaseline]);

  // 2. Resolve Drain Failure Disruption State (Simulated truth > Preview armed)
  const drainDisruption = useMemo(() => {
    const simDrain = simData?.disruptions?.find((d) => d.type === 'drain_failure');
    const previewDrain = disruptionsPreview?.find((d) => d.type === 'drain_failure');

    const event = simDrain || previewDrain || (drainFailureToggle ? {
      type: 'drain_failure',
      label: 'Drain Failure (W-10, W-11, W-14, W-15)',
      t_start_min: 60.0,
      severity_or_loss: 0.60,
      primary_ward_ids: [9, 10, 13, 14],
      ward_overlap: { 9: 0.8, 10: 0.8, 13: 0.4, 14: 0.4, 8: 0.16, 11: 0.16, 12: 0.08, 15: 0.08 },
    } : null);

    if (!event && !drainFailureToggle) return null;

    const tStart = event?.t_start_min ?? 60.0;
    const isSimulated = Boolean(simDrain);
    const isActive = !showBaseline && isSimulated && currentTimeMin >= tStart;
    const isArmed = !showBaseline && (drainFailureToggle || Boolean(previewDrain) || isSimulated) && !isActive;

    return {
      ...event,
      primary_ward_ids: event?.primary_ward_ids || [9, 10, 13, 14],
      ward_overlap: event?.ward_overlap || { 9: 0.8, 10: 0.8, 13: 0.4, 14: 0.4, 8: 0.16, 11: 0.16, 12: 0.08, 15: 0.08 },
      isActive,
      isArmed,
      tStart,
    };
  }, [simData, disruptionsPreview, drainFailureToggle, currentTimeMin]);

  const blockagePrimarySet = useMemo(() => new Set(blockageDisruption?.primary_ward_ids || []), [blockageDisruption]);
  const drainPrimarySet = useMemo(() => new Set(drainDisruption?.primary_ward_ids || []), [drainDisruption]);

  // Accessibility: Detect prefers-reduced-motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);

  // Accessibility: aria-live="polite" announcement on timeline crossing start times
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const prevTimeMinRef = useRef(currentTimeMin);

  useEffect(() => {
    const prevTime = prevTimeMinRef.current;
    prevTimeMinRef.current = currentTimeMin;

    // Announce when playback crosses Canal Blockage start time
    if (
      blockageDisruption?.isActive &&
      prevTime < blockageDisruption.tStart &&
      currentTimeMin >= blockageDisruption.tStart
    ) {
      const wards = (blockageDisruption.primary_ward_ids || [10])
        .map((id) => `Ward ${id + 1}`)
        .join(', ');
      setLiveAnnouncement(`Canal blockage begins at T+${Math.round(blockageDisruption.tStart)} min in ${wards}`);
    }

    // Announce when playback crosses Drain Failure start time
    if (
      drainDisruption?.isActive &&
      prevTime < drainDisruption.tStart &&
      currentTimeMin >= drainDisruption.tStart
    ) {
      const wards = (drainDisruption.primary_ward_ids || [9, 10, 13, 14])
        .map((id) => `Ward ${id + 1}`)
        .join(', ');
      setLiveAnnouncement(`Drain failure begins at T+${Math.round(drainDisruption.tStart)} min in ${wards}`);
    }
  }, [currentTimeMin, blockageDisruption, drainDisruption]);

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
    const safeStep = Math.max(0, Math.min(currentStep, (regionStatus?.length || 1) - 1));
    const currentTimelineFrame = timeline?.[safeStep] || null;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c;
        const x = paddingX + c * stepX;
        const y = paddingY + r * stepY;

        // Extract status for current time step (or clean baseline if showBaseline is active)
        let status = 0;
        const baselineStatusArr = simData?.impact?.baseline_region_status || simData?.baseline_region_status;
        if (showBaseline && baselineStatusArr && baselineStatusArr[safeStep]) {
          status = baselineStatusArr[safeStep][id] ?? 0;
        } else if (regionStatus && regionStatus[safeStep] && regionStatus[safeStep][id] !== undefined) {
          status = regionStatus[safeStep][id] ?? 0;
        }

        // Extract depth for current time step
        let depth = 0;
        if (regionData && regionData[id] && regionData[id].depth) {
          depth = regionData[id].depth[safeStep] ?? 0;
        } else if (regionDepth && regionDepth[safeStep] && regionDepth[safeStep][id] !== undefined) {
          depth = regionDepth[safeStep][id] ?? 0;
        }

        // Extract affected citizens
        let affected = 0;
        if (regionData && regionData[id] && regionData[id].affected) {
          affected = regionData[id].affected[safeStep] ?? 0;
        } else if (regionAffected && regionAffected[safeStep] && regionAffected[safeStep][id] !== undefined) {
          affected = regionAffected[safeStep][id] ?? 0;
        }

        // Ward info & telemetry from API
        const rData = regionData && regionData[id] ? regionData[id] : null;
        const zData = zones && (zones[id] || zones[String(id)]) ? (zones[id] || zones[String(id)]) : null;
        const currentWardData = currentTimelineFrame?.zones?.[id] || currentTimelineFrame?.zones?.[String(id)] || {};
        
        const name = rData?.name || zData?.name || `Ward ${String(id + 1).padStart(2, '0')}`;
        const code = `W-${String(id + 1).padStart(2, '0')}`;
        const totalPop = rData?.total_population ?? rData?.total_pop ?? zData?.total_population ?? zData?.total_pop ?? 7500;
        const averageElevation = rData?.average_elevation ?? zData?.average_elevation ?? 6.5;
        const tCrit = zData?.t_crit ?? null;
        const peakDepth = zData?.peak_depth ?? (rData?.max_depth ? Math.max(...rData.max_depth) : depth) ?? 0;
        const classification = getZoneClassification(totalPop);
        const primaryFloodSource = rData?.primary_flood_source ?? zData?.primary_flood_source ?? 'Self-Contained';
        const earlyWarning = zData?.early_warning ?? null;
        const soilType = rData?.soil_type ?? zData?.soil_type ?? 'Sandy Loam';
        const infiltrationRate = rData?.infiltration_rate_mm_hr ?? zData?.infiltration_rate_mm_hr ?? 15.0;

        const cumulativeAbsorbedM3 = currentWardData.cumulative_absorbed_m3 !== undefined
          ? Number(currentWardData.cumulative_absorbed_m3) || 0
          : Array.isArray(rData?.cumulative_absorbed_m3)
          ? Number(rData.cumulative_absorbed_m3[safeStep]) || 0
          : Number(rData?.cumulative_absorbed_m3 ?? zData?.cumulative_absorbed_m3 ?? 0);

        const soilSaturationPct = currentWardData.soil_saturation_pct !== undefined
          ? Number(currentWardData.soil_saturation_pct) || 0
          : Array.isArray(rData?.soil_saturation_pct)
          ? Number(rData.soil_saturation_pct[safeStep]) || 0
          : Number(rData?.soil_saturation_pct ?? zData?.soil_saturation_pct ?? 0);

        const critPct = currentWardData.crit_pct !== undefined
          ? Number(currentWardData.crit_pct) || 0
          : Array.isArray(rData?.crit_pct)
          ? Number(rData.crit_pct[safeStep]) || 0
          : Number(rData?.peak_crit_pct ?? rData?.crit_pct ?? zData?.crit_pct ?? 0);

        const primaryInflowVolume = Number(currentWardData?.primary_inflow_volume ?? rData?.primary_inflow_volume ?? zData?.primary_inflow_volume ?? 0);

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
          maxDepth: peakDepth,
          critPct,
          affected,
          totalPop,
          averageElevation,
          tCrit,
          classification,
          primaryFloodSource,
          primaryInflowVolume,
          earlyWarning,
          soilType,
          soil_type: soilType,
          infiltrationRate,
          infiltration_rate_mm_hr: infiltrationRate,
          cumulativeAbsorbedM3,
          cumulative_absorbed_m3: cumulativeAbsorbedM3,
          soilSaturationPct,
          soil_saturation_pct: soilSaturationPct,
        });

      }
    }
    return list;
  }, [currentStep, regionStatus, regionData, regionDepth, regionAffected, zones, timeline, stepX, stepY, showBaseline, simData]);

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
    const safeStep = Math.max(0, Math.min(currentStep, (edgeFlows?.length || 1) - 1));
    const frame = edgeFlows?.[safeStep];
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
        
        {/* Accessibility: Screen reader live announcement for timeline crossings */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveAnnouncement}
        </div>

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

          {/* Legend: Ward Status & Flow/Disruption Semantics */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono">
            {/* Ward Status */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                <span className="text-slate-300">SAFE</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
                <span className="text-slate-300">WARN</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]"></span>
                <span className="text-slate-300">CRIT</span>
              </div>
            </div>

            <span className="text-slate-700 hidden sm:inline">|</span>

            {/* Flow & Disruption Legend */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-1.5">
                <span className="w-4 h-0.5 bg-cyan-400 rounded-full inline-block shadow-[0_0_6px_#22d3ee]"></span>
                <span className="text-slate-300">normal flow</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-4 h-0 border-b-2 border-dotted border-red-400 inline-block"></span>
                <span className="text-slate-300">restricted flow</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-1.5 py-0.5 rounded bg-red-950/80 border border-red-500 text-red-300 text-[10px] font-bold">drains -60%</span>
                <span className="text-slate-300">drain failure</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-1.5 py-0.5 rounded bg-rose-950/95 border border-rose-500 text-rose-300 text-[10px] font-extrabold">▲ WORSENED</span>
                <span className="text-slate-300">worsened</span>
              </div>
            </div>
          </div>
        </div>

        {/* Network Graph Canvas Container (NO overflow-hidden, allows smooth layout) */}
        <div className="relative w-full flex items-center justify-center my-4 overflow-x-auto">
          <div className="relative w-full max-w-[850px] aspect-[4/3]">
            {/* SVG Conduit Flow Network (Background Layer) */}
            <svg
              viewBox="0 0 800 600"
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full drop-shadow-2xl select-none relative z-0"
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

                  // Check if this edge touches the primary wards of an active canal blockage
                  // Blockage Active (t >= t_start_min): edges touching primary wards turn red #f87171, dotted (dasharray "6 12"), animate at least 3x slower (min 6s)
                  const isBlockageActive = Boolean(blockageDisruption?.isActive);
                  const touchesBlockage = isBlockageActive && (blockagePrimarySet.has(edge.from) || blockagePrimarySet.has(edge.to));

                  // Do NOT recolour arrows for drain failure: the model reduces the drainage sink, not lateral flow.

                  // Midpoint of the cubic Bezier curve at t = 0.5
                  const midX = 0.125 * (sx + ex) + 0.375 * (cx1 + cx2);
                  const midY = 0.125 * (sy + ey) + 0.375 * (cy1 + cy2);

                  const edgeStroke = touchesBlockage ? '#f87171' : '#22d3ee';
                  const edgeDash = touchesBlockage ? '6 12' : '40 60';
                  // Under prefers-reduced-motion: reduce, remove the SMIL animation and use static dotted styling
                  const activeDash = prefersReducedMotion
                    ? (touchesBlockage ? '6 12' : '8 8')
                    : edgeDash;
                  const edgeDur = touchesBlockage ? Math.max(6.0, animationDuration * 3) : animationDuration;
                  const edgeTravel = touchesBlockage ? '72' : '100';

                  const pathTitle = touchesBlockage
                    ? `Flow between Ward ${edge.from + 1} and Ward ${edge.to + 1}: restricted by canal blockage`
                    : isDormant
                    ? `Flow between Ward ${edge.from + 1} and Ward ${edge.to + 1}: dormant flow`
                    : `Flow between Ward ${edge.from + 1} and Ward ${edge.to + 1}: normal flow`;

                  return (
                    <g key={edge.key}>
                      <title>{pathTitle}</title>

                      {/* Task 3: Background Conduit Bed - Static, subtle slate pipe */}
                      <path
                        d={pathString}
                        stroke={touchesBlockage ? '#7f1d1d' : '#0e3a4e'}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        opacity={touchesBlockage ? 0.6 : 0.3}
                      >
                        <title>{pathTitle}</title>
                      </path>

                      {/* Foreground Flowing Stream - Red dotted & 3x slower for Blockage Active, Solid Cyan for normal flow */}
                      {(!isDormant || touchesBlockage) && (
                        <path
                          d={pathString}
                          stroke={edgeStroke}
                          strokeWidth={touchesBlockage ? Math.max(3.0, dynamicWidth) : dynamicWidth}
                          strokeDasharray={activeDash}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                          opacity={touchesBlockage ? 0.95 : Math.min(1.0, 0.85 + effectiveVolume * 0.1)}
                          style={{
                            filter: touchesBlockage
                              ? 'drop-shadow(0 0 6px rgba(248, 113, 113, 0.6))'
                              : 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))',
                          }}
                        >
                          <title>{pathTitle}</title>
                          {/* Accessibility: Omit SMIL animation under prefers-reduced-motion */}
                          {!prefersReducedMotion && (
                            <animate
                              attributeName="stroke-dashoffset"
                              from={isReverse ? "0" : edgeTravel}
                              to={isReverse ? edgeTravel : "0"}
                              dur={`${edgeDur.toFixed(2)}s`}
                              repeatCount="indefinite"
                              calcMode="linear"
                            />
                          )}
                        </path>
                      )}

                      {/* Small icon at the edge midpoint for active blockage */}
                      {touchesBlockage && (
                        <g transform={`translate(${midX.toFixed(1)}, ${midY.toFixed(1)})`} className="pointer-events-none select-none">
                          <circle
                            r="9"
                            fill="#0f172a"
                            stroke="#f87171"
                            strokeWidth="1.5"
                            style={{ filter: 'drop-shadow(0 0 6px rgba(248, 113, 113, 0.7))' }}
                          />
                          {/* Mini Hazard Octagon Icon */}
                          <polygon points="-2.2,-5 2.2,-5 5,-2.2 5,2.2 2.2,5 -2.2,5 -5,2.2 -5,-2.2" fill="#ef4444" />
                          <line x1="0" y1="-2.5" x2="0" y2="0.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
                          <circle cx="0" cy="2.5" r="0.7" fill="#ffffff" />
                        </g>
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

              // Disruption Armed & Active States for this Ward
              const isBlockageArmed = Boolean(blockageDisruption?.isArmed && blockagePrimarySet.has(node.id));
              const isDrainArmed = Boolean(drainDisruption?.isArmed && drainPrimarySet.has(node.id));
              const isArmed = isBlockageArmed || isDrainArmed;

              // Drain failure Active
              const isDrainActive = Boolean(drainDisruption?.isActive);
              const isDrainPrimary = isDrainActive && drainPrimarySet.has(node.id);
              const drainOverlap = Number(drainDisruption?.ward_overlap?.[node.id] ?? drainDisruption?.ward_overlap?.[String(node.id)] ?? 0);
              const isDrainPartial = isDrainActive && !isDrainPrimary && drainOverlap > 0;
              const partialLossPct = Math.round(drainOverlap * 60);

              // Blockage Active
              const isBlockageActiveWard = Boolean(blockageDisruption?.isActive && blockagePrimarySet.has(node.id));

              // Disruption Worsened State
              const wardImpact = simData?.impact?.per_ward?.find((w) => w.id === node.id);
              const isWorsened = Boolean(wardImpact?.worsened);

              // Accessibility: Descriptive aria-label (e.g. "Ward 11, Critical, canal blocked, drains impaired, worsened by disruption")
              const statusCapitalized = cfg.label.charAt(0).toUpperCase() + cfg.label.slice(1).toLowerCase();
              const disruptionParts = [];
              if (isBlockageActiveWard) {
                disruptionParts.push('canal blocked');
              } else if (isBlockageArmed) {
                disruptionParts.push('canal blockage armed');
              }
              if (isDrainPrimary) {
                disruptionParts.push('drains impaired');
              } else if (isDrainPartial) {
                disruptionParts.push(`drains partially impaired (-${partialLossPct}%)`);
              } else if (isDrainArmed) {
                disruptionParts.push('drain failure armed');
              }
              if (isWorsened && !showBaseline) {
                disruptionParts.push('worsened by disruption');
              }
              const disruptionStr = disruptionParts.length > 0 ? `, ${disruptionParts.join(', ')}` : '';
              const wardAriaLabel = `Ward ${node.id + 1}, ${statusCapitalized}${disruptionStr}`;

              return (
                /* The Parent Node Wrapper: Accessible button with tabIndex 0, visible focus ring, and keyboard activation */
                <div
                  key={node.id}
                  tabIndex={0}
                  role="button"
                  aria-label={wardAriaLabel}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16 cursor-pointer transition-transform duration-150 hover:scale-110 z-20 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  style={{
                    left: `${(node.x / width) * 100}%`,
                    top: `${(node.y / height) * 100}%`,
                  }}
                  onClick={() => onSelectWard && onSelectWard(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectWard && onSelectWard(node.id);
                    }
                  }}
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

                  {/* 1. Armed Primary Wards: Dashed Outline */}
                  {isArmed && (
                    <div className="absolute -inset-2 rounded-full border-2 border-dashed border-amber-400 animate-pulse pointer-events-none z-10" />
                  )}

                  {/* 3. Drain Failure Active Primary Wards: Red Dotted Outline */}
                  {isDrainPrimary && (
                    <div className="absolute -inset-2 rounded-full border-2 border-dotted border-red-500 pointer-events-none animate-pulse z-10" />
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
                    <span className="font-mono text-[10px] font-bold text-white leading-tight">
                      {node.code}
                    </span>
                    <span
                      className="font-mono text-[8px] font-bold leading-tight"
                      style={{ color: cfg.color }}
                    >
                      {(node.depth ?? 0).toFixed(2)}m | max {(node.maxDepth ?? node.peakDepth ?? 0).toFixed(2)}m
                    </span>
                    <span className="font-mono text-[8px] font-extrabold text-slate-300 leading-tight">
                      {((node.critPct ?? 0) * 100).toFixed(0)}% crit
                    </span>
                  </div>

                  {/* 1. Armed Primary Wards: Icon Badge */}
                  {isArmed && (
                    <div
                      className="absolute -top-2.5 -right-2.5 bg-amber-500 text-slate-950 p-1 rounded-full shadow-lg z-30 flex items-center justify-center font-bold"
                      title={isBlockageArmed ? "Canal Blockage Armed" : "Drain Failure Armed"}
                    >
                      {isBlockageArmed ? (
                        <AlertCircle className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
                      )}
                    </div>
                  )}

                  {/* 2. Blockage Active Ward: Active Octagon Icon Badge */}
                  {isBlockageActiveWard && (
                    <div
                      className="absolute -top-2.5 -right-2.5 bg-red-600 text-white p-1 rounded-full shadow-lg z-30 flex items-center justify-center font-bold"
                      title="Canal Blocked"
                    >
                      <AlertOctagon className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                    </div>
                  )}

                  {/* Worsened by Disruption Marker (Icon + Text) */}
                  {isWorsened && !showBaseline && (
                    <div
                      className="absolute -top-2.5 -left-2.5 px-1.5 py-0.5 rounded bg-rose-950/95 border border-rose-500 text-rose-300 font-mono text-[8px] font-extrabold shadow-md z-30 flex items-center gap-1"
                      title="Worsened by disruption"
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                      <span>WORSENED</span>
                    </div>
                  )}

                  {/* 3. Drain Failure Active: Primary Ward Badge ("drains -60%") */}
                  {isDrainPrimary && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-red-950/95 border border-red-500 text-red-300 font-mono text-[9px] font-bold tracking-tight whitespace-nowrap shadow-md z-30 flex items-center gap-1">
                      <Droplets className="w-2.5 h-2.5 text-red-400" />
                      <span>drains -60%</span>
                    </div>
                  )}

                  {/* 3. Drain Failure Active: Partial Ward Lighter Badge */}
                  {isDrainPartial && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900/90 border border-amber-500/50 text-amber-300/90 font-mono text-[8px] font-semibold tracking-tight whitespace-nowrap shadow-md z-30 flex items-center gap-0.5">
                      <span>drains -{partialLossPct}%</span>
                    </div>
                  )}

                  {/* Canvas Rain Animation Layer: strictly inner circular mask (disabled under prefers-reduced-motion) */}
                  <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                    {!prefersReducedMotion && <SingleNodeRainCanvas status={node.status} />}
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
      <ZoneDetails
        selectedNode={selectedNode}
        currentTimeMin={currentTimeMin}
        currentTimelineFrame={timeline?.[Math.max(0, Math.min(currentStep, (regionStatus?.length || 1) - 1))] || null}
        STATUS_CONFIG={STATUS_CONFIG}
      />


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
                  {/* Mean Depth */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                      Mean Depth:
                    </span>
                    <span className="text-white font-bold">{(node.depth ?? 0).toFixed(2)} m</span>
                  </div>

                  {/* Depth Gauge Bar */}
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        node.status === 2 ? 'bg-red-500' : node.status === 1 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, ((node.depth ?? 0) / 1.0) * 100)}%` }}
                    />
                  </div>

                  {/* Max Depth */}
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-indigo-400" />
                      Max Depth:
                    </span>
                    <span className="text-white font-bold">
                      {(node.maxDepth ?? node.peakDepth ?? 0).toFixed(2)} m
                    </span>
                  </div>

                  {/* % Critical Cells */}
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-slate-400 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      % of Cells Critical:
                    </span>
                    <span className="text-red-300 font-bold">
                      {((node.critPct ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-400 italic">
                    Critical = more than 5% of cells at least 0.5 m deep
                  </div>

                  {/* Average Elevation */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Mountain className="w-3.5 h-3.5 text-amber-400" />
                      Average Elevation:
                    </span>
                    <span className="text-amber-300 font-bold">
                      {(node.averageElevation ?? 0).toFixed(2)} m
                    </span>
                  </div>

                  {/* Affected Citizens Fraction */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-teal-400" />
                      Affected Citizens:
                    </span>
                    <span className="text-teal-300 font-bold">
                      {Math.round(node.affected ?? 0).toLocaleString()} / {Math.round(node.totalPop ?? 0).toLocaleString()}
                    </span>
                  </div>

                  {/* Primary Inflow Source (hidden if inflow is 0 or Self-Contained) */}
                  {Boolean(node.primaryInflowVolume > 0 && node.primaryFloodSource && node.primaryFloodSource !== 'Self-Contained') && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-400 flex items-center gap-1">
                        Inflow Source:
                      </span>
                      <span className="text-cyan-300 font-bold">
                        {node.primaryFloodSource} ({node.primaryInflowVolume.toFixed(1)} m³)
                      </span>
                    </div>
                  )}

                  {/* Disruption Worsened Text in Tooltip */}
                  {(() => {
                    const wardImpact = simData?.impact?.per_ward?.find((w) => w.id === node.id);
                    if (wardImpact?.worsened && !showBaseline) {
                      return (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-950/80 border border-rose-500/60 text-rose-300 font-bold text-[10px] mt-2">
                          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                          <span>Worsened by Disruption</span>
                        </div>
                      );
                    }
                    return null;
                  })()}

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

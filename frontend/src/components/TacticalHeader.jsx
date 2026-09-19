import React from 'react';
import { Activity, MapPin, BarChart3, ShieldAlert, Cpu, Radio, RefreshCw } from 'lucide-react';

/**
 * TacticalHeader
 * Top navigation and system status HUD for the Tactical Digital Twin.
 * Displays title, active tabs ('City Map', 'Analytics Hub', 'Stress Matrix'),
 * and system telemetry indicators.
 */
export default function TacticalHeader({ activeTab, setActiveTab, systemStatus = "ONLINE", scenarioName = "" }) {
  const tabs = [
    { id: 'map', label: 'City Map', icon: MapPin, desc: '16-Ward Tactical Network' },
    { id: 'analytics', label: 'Analytics Hub', icon: BarChart3, desc: 'Hydrographs & Zone Data' },
    { id: 'stress', label: 'Stress Matrix', icon: ShieldAlert, desc: 'Scenario Stress Testing' },
  ];

  return (
    <header className="w-full bg-slate-950/90 border-b border-teal-500/30 backdrop-blur-md sticky top-0 z-50">
      {/* Top micro-bar */}
      <div className="h-1 w-full bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-600"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between py-3 gap-4">
          
          {/* Logo & Tactical Identity */}
          <div className="flex items-center space-x-3.5">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-teal-950/60 border border-teal-500/50 glow-teal">
              <Cpu className="w-5 h-5 text-teal-400 animate-pulse" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950 animate-ping"></div>
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs tracking-widest text-teal-400 uppercase font-semibold">
                  SYS // DEFENSE MATRIX
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400/60"></span>
                <span className="text-[10px] font-mono text-slate-400 uppercase">v2.4 TWIN</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                FLOW<span className="text-teal-400">SHIELD</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-teal-950/80 border border-teal-500/40 text-teal-300 font-normal">
                  TACTICAL DIGITAL TWIN
                </span>
              </h1>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center space-x-1 bg-slate-900/90 p-1.5 rounded-xl border border-teal-500/30">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-teal-500/20 text-teal-300 border border-teal-500/60 shadow-[0_0_15px_rgba(20,184,166,0.3)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-teal-400' : 'text-slate-400'}`} />
                  <span className="font-semibold tracking-wide">{tab.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-teal-400 rounded-full shadow-[0_0_8px_#14b8a6]"></span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Live Telemetry / Scenario Indicator */}
          <div className="hidden lg:flex items-center space-x-3 text-xs font-mono">
            <div className="px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center space-x-2">
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-slate-400">STATUS:</span>
              <span className="text-emerald-400 font-bold tracking-wider">{systemStatus}</span>
            </div>

            {scenarioName && (
              <div className="px-3 py-1.5 rounded-lg bg-teal-950/40 border border-teal-500/30 text-teal-300 max-w-[200px] truncate">
                {scenarioName}
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}

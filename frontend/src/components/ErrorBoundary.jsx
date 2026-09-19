import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

/**
 * ErrorBoundary
 * Catches JavaScript errors anywhere in its child component tree,
 * logs those errors, and displays a localized fallback UI instead of crashing the entire app.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an exception:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full p-6 bg-red-950/40 border-2 border-red-500/50 rounded-2xl shadow-2xl text-red-200 font-mono space-y-4">
          <div className="flex items-center space-x-3 pb-3 border-b border-red-500/30">
            <AlertOctagon className="w-6 h-6 text-red-400 animate-pulse shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                MODULE EXECUTION FAILURE // RECOVERABLE EXCEPTION
              </h3>
              <p className="text-xs text-red-300">
                {this.props.fallbackTitle || "A component within this tactical module encountered a runtime error."}
              </p>
            </div>
          </div>

          <div className="bg-slate-950/80 p-3.5 rounded-xl border border-red-900/50 text-xs overflow-x-auto text-red-300">
            <div className="font-bold text-red-400">Error Details:</div>
            <div className="mt-1">{this.state.error?.toString()}</div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-400">
              The rest of the FlowShield dashboard remains operational.
            </span>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center space-x-2 transition shadow-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>RELOAD MODULE</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

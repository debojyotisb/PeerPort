import React from 'react';
import { Zap, Sun, Moon, Laptop, ShieldCheck, Wifi, HelpCircle } from 'lucide-react';
import { useThemeStore } from '../state/theme-store.js';
import { useConnectionStore } from '../state/connection-store.js';

interface NavbarProps {
  onOpenHelp?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenHelp }) => {
  const { mode, effectiveTheme, toggleTheme } = useThemeStore();
  const { connectionState, mode: transportMode, isRelayActive } = useConnectionStore();

  const getStatusBadge = () => {
    if (connectionState === 'TRANSFERRING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          Transferring
        </span>
      );
    }
    if (connectionState === 'CONNECTING' || connectionState === 'DISCOVERING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
          Searching
        </span>
      );
    }
    if (transportMode === 'LOCAL_HOTSPOT') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <Wifi className="w-3.5 h-3.5" />
          Offline Hotspot
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        P2P Ready
      </span>
    );
  };

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 transition-colors">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5 cursor-pointer">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 flex items-center justify-center shadow-md shadow-sky-500/20">
            <Zap className="w-5 h-5 text-slate-950 fill-slate-950" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-sky-600 to-sky-500 dark:from-white dark:via-sky-400 dark:to-cyan-300 bg-clip-text text-transparent">
            PeerPort
          </span>
        </div>

        {/* Right tools */}
        <div className="flex items-center gap-3">
          {getStatusBadge()}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {effectiveTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Help / Architecture modal trigger */}
          {onOpenHelp && (
            <button
              onClick={onOpenHelp}
              aria-label="Architecture info"
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

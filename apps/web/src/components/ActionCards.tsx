import React from 'react';
import { Radar, Globe, Wifi, Smartphone, ArrowRight } from 'lucide-react';

interface ActionCardsProps {
  onFindNearby: () => void;
  onShareWithBrowser: () => void;
  onOfflineAndroidToIos: () => void;
}

export const ActionCards: React.FC<ActionCardsProps> = ({
  onFindNearby,
  onShareWithBrowser,
  onOfflineAndroidToIos
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
      {/* Primary Action */}
      <button
        onClick={onFindNearby}
        className="group relative p-6 rounded-2xl bg-gradient-to-b from-sky-500/10 to-sky-500/5 dark:from-sky-500/15 dark:to-transparent border border-sky-500/30 hover:border-sky-500/60 text-left transition-all hover:shadow-lg hover:shadow-sky-500/10 flex flex-col justify-between"
      >
        <div className="flex items-start justify-between w-full mb-4">
          <div className="w-12 h-12 rounded-xl bg-sky-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-sky-500/30 group-hover:scale-105 transition-transform">
            <Radar className="w-6 h-6 animate-pulse" />
          </div>
          <span className="p-2 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
            <ArrowRight className="w-4 h-4" />
          </span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
            Find Nearby Devices
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Send or receive files with nearby devices.
          </p>
        </div>
      </button>

      {/* Secondary Action */}
      <button
        onClick={onShareWithBrowser}
        className="group relative p-6 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-left transition-all hover:shadow-md flex flex-col justify-between"
      >
        <div className="flex items-start justify-between w-full mb-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
            <Globe className="w-6 h-6 text-sky-500" />
          </div>
          <span className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:translate-x-1 transition-all">
            <ArrowRight className="w-4 h-4" />
          </span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
            Share with a Browser
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Use a browser on another device.
          </p>
        </div>
      </button>

      {/* Scenario A Highlight: Android to iPhone Offline Direct */}
      <div className="md:col-span-2 p-4 rounded-xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Android to iPhone (No Internet Required)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">
                Offline Mode
              </span>
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Transfer directly via Android Local Hotspot. iPhone connects by scanning QR with native camera—no app install required on iPhone.
            </p>
          </div>
        </div>
        <button
          onClick={onOfflineAndroidToIos}
          className="shrink-0 px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors shadow-sm"
        >
          Start Offline Transfer
        </button>
      </div>
    </div>
  );
};

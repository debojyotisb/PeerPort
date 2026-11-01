import React from 'react';
import { Radar, Globe, Smartphone, ArrowRight, ShieldCheck, QrCode, WifiOff } from 'lucide-react';

interface ActionCardsProps {
  onFindNearby: () => void;
  onShareWithBrowser: () => void;
  onAirGappedShare: () => void;
  onAirGappedReceive: () => void;
}

export const ActionCards: React.FC<ActionCardsProps> = ({
  onFindNearby,
  onShareWithBrowser,
  onAirGappedShare,
  onAirGappedReceive
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
      {/* Primary Action: Find Nearby Devices */}
      <button
        type="button"
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
            Send or receive files automatically with nearby devices on the same network.
          </p>
        </div>
      </button>

      {/* Secondary Action: Share with a Browser */}
      <button
        type="button"
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
            Generate a link or QR code for another device to open in any standard browser.
          </p>
        </div>
      </button>

      {/* Air-Gapped / Offline Serverless Action Banner */}
      <div className="md:col-span-2 p-5 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/30 dark:border-emerald-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <WifiOff className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Air-Gapped QR Transfer
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wider">
                100% Offline
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-lg">
              Completely serverless phone-to-phone WebRTC. No internet, no router, and no external signaling. Exchanging QR codes links the devices directly.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <button
            type="button"
            onClick={onAirGappedReceive}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <QrCode className="w-4 h-4 text-emerald-500" />
            <span>Receive via QR</span>
          </button>
          <button
            type="button"
            onClick={onAirGappedShare}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20"
          >
            <Smartphone className="w-4 h-4" />
            <span>Send via QR</span>
          </button>
        </div>
      </div>

      {/* Direct Browser Sharing Transparency Banner */}
      <div className="md:col-span-2 p-4 rounded-xl bg-slate-100/80 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Direct Browser-to-Browser Sharing</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                Active
              </span>
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              iPhone, Android, Windows, Mac. The receiver scans the QR code with their normal camera—no app installation required. Payloads transfer directly peer-to-peer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

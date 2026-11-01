import React from 'react';
import {
  Upload,
  Download,
  QrCode,
  FolderDown,
  WifiOff,
  ShieldCheck,
  ArrowRight,
  Globe,
  Smartphone
} from 'lucide-react';

interface ActionCardsProps {
  onSendFiles: () => void;
  onReceiveFiles: () => void;
  onOfflineQrHub: () => void;
  onOpenSavedFiles: () => void;
  savedFilesCount?: number;
  onOnlineShare?: () => void;
}

export const ActionCards: React.FC<ActionCardsProps> = ({
  onSendFiles,
  onReceiveFiles,
  onOfflineQrHub,
  onOpenSavedFiles,
  savedFilesCount = 0,
  onOnlineShare
}) => {
  return (
    <div className="w-full space-y-4">
      {/* 4-Card Quick Share Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        {/* 1. Send Files Card */}
        <button
          type="button"
          onClick={onSendFiles}
          className="group relative p-5 rounded-2xl bg-gradient-to-b from-sky-500/10 to-sky-500/5 dark:from-sky-500/15 dark:to-transparent border border-sky-500/30 hover:border-sky-500/60 text-left transition-all hover:shadow-lg hover:shadow-sky-500/10 flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-start justify-between w-full mb-3">
            <div className="w-11 h-11 rounded-xl bg-sky-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-sky-500/30 group-hover:scale-105 transition-transform">
              <Upload className="w-5 h-5" />
            </div>
            <span className="p-1.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 group-hover:translate-x-1 transition-all">
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-0.5 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
              Send Files
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Select files and generate an offline Offer QR code.
            </p>
          </div>
        </button>

        {/* 2. Receive Files Card */}
        <button
          type="button"
          onClick={onReceiveFiles}
          className="group relative p-5 rounded-2xl bg-gradient-to-b from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/15 dark:to-transparent border border-emerald-500/30 hover:border-emerald-500/60 text-left transition-all hover:shadow-lg hover:shadow-emerald-500/10 flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-start justify-between w-full mb-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-emerald-500/30 group-hover:scale-105 transition-transform">
              <Download className="w-5 h-5" />
            </div>
            <span className="p-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:translate-x-1 transition-all">
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              Receive Files
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Scan the sender's Offer QR to establish a direct link.
            </p>
          </div>
        </button>

        {/* 3. Offline QR Transfer Hub Card */}
        <button
          type="button"
          onClick={onOfflineQrHub}
          className="group relative p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-left transition-all hover:shadow-md flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-start justify-between w-full mb-3">
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <WifiOff className="w-5 h-5 text-emerald-500" />
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wider">
              100% Offline
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-0.5">
              Offline QR Transfer
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Direct two-way QR exchange without router, internet, or cloud.
            </p>
          </div>
        </button>

        {/* 4. Saved Files Card */}
        <button
          type="button"
          onClick={onOpenSavedFiles}
          className="group relative p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-left transition-all hover:shadow-md flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-start justify-between w-full mb-3">
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <FolderDown className="w-5 h-5 text-sky-500" />
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold">
              {savedFilesCount} {savedFilesCount === 1 ? 'file' : 'files'}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-0.5">
              Saved Files
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Browse, download, or manage files saved in offline storage.
            </p>
          </div>
        </button>
      </div>

      {/* Offline Transfer Guarantee Banner */}
      <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-500/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
          <span>
            <strong>Air-Gapped Privacy Guarantee:</strong> Files transfer purely peer-to-peer over your local hotspot or Wi-Fi. Zero cloud storage, zero public tracking.
          </span>
        </div>

        {onOnlineShare && (
          <button
            type="button"
            onClick={onOnlineShare}
            className="shrink-0 text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-semibold text-[11px]"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Online Link Sharing</span>
          </button>
        )}
      </div>
    </div>
  );
};

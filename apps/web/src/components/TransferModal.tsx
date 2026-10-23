import React from 'react';
import { Loader2, X, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { TransferProgress, TransferRole } from '@peerport/shared-types';
import { formatBytes } from '../services/file-selection.js';

interface TransferModalProps {
  isOpen: boolean;
  role: TransferRole | null;
  progress: TransferProgress | null;
  onCancel: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  role,
  progress,
  onCancel
}) => {
  if (!isOpen || !progress) return null;

  const isSending = role === 'SENDER';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
              isSending
                ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
            }`}>
              {isSending ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isSending ? 'Sending Files...' : 'Receiving Files...'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                File {progress.fileIndex + 1} of {progress.totalFiles}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current File Name */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 mb-4">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate mb-1">
            {progress.fileName}
          </p>
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>{formatBytes(progress.bytesTransferred)} / {formatBytes(progress.totalBytes)}</span>
            <span>{progress.percentage}%</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-4">
          <div
            className={`h-full transition-all duration-150 ${
              isSending ? 'bg-sky-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${progress.percentage}%` }}
          ></div>
        </div>

        {/* Speed & ETA Metrics */}
        <div className="grid grid-cols-2 gap-2 text-center text-xs mb-5">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Speed</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {formatBytes(progress.speedBytesPerSec)}/s
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Remaining</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {progress.timeRemainingSec > 0 ? `${progress.timeRemainingSec}s` : 'Finishing...'}
            </span>
          </div>
        </div>

        <button
          onClick={onCancel}
          className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 text-xs font-semibold text-slate-600 dark:text-slate-400 transition-colors"
        >
          Cancel Transfer
        </button>
      </div>
    </div>
  );
};

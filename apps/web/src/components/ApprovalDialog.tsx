import React from 'react';
import { Smartphone, Laptop, Check, X, ShieldAlert, FileText } from 'lucide-react';
import { TransferManifest } from '@peerport/shared-types';
import { formatBytes } from '../services/file-selection.js';

interface ApprovalDialogProps {
  manifest: TransferManifest | null;
  onApprove: (accepted: boolean) => void;
}

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ manifest, onApprove }) => {
  if (!manifest) return null;

  const isLargeTransfer = manifest.totalBytes > 1024 * 1024 * 1024; // > 1 GB warning

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
            {manifest.sender.platform === 'ios' || manifest.sender.platform === 'android' ? (
              <Smartphone className="w-5 h-5" />
            ) : (
              <Laptop className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Incoming File Request
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              From <strong className="text-slate-800 dark:text-slate-200">{manifest.sender.deviceName}</strong> ({manifest.sender.platform})
            </p>
          </div>
        </div>

        {/* File manifest summary */}
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-700/80 mb-4">
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-medium mb-2 pb-2 border-b border-slate-200 dark:border-slate-700">
            <span>{manifest.totalFiles} {manifest.totalFiles === 1 ? 'file' : 'files'}</span>
            <span>Total size: {formatBytes(manifest.totalBytes)}</span>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {manifest.files.map((file, idx) => (
              <div key={file.id || idx} className="flex items-center justify-between text-xs py-1">
                <div className="flex items-center gap-2 truncate max-w-[240px]">
                  <FileText className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {file.name}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400 shrink-0">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {isLargeTransfer && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs mb-4">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Large transfer (&gt; 1 GB). Ensure you have sufficient device storage.</span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => onApprove(false)}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" />
            Decline
          </button>
          <button
            onClick={() => onApprove(true)}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-xs text-slate-950 transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20"
          >
            <Check className="w-4 h-4" />
            Accept & Receive
          </button>
        </div>
      </div>
    </div>
  );
};

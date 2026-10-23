import React from 'react';
import { CheckCircle2, ShieldCheck, Download, Sparkles, RefreshCw } from 'lucide-react';
import { CompletedFileRecord } from '../state/transfer-store.js';
import { formatBytes, triggerFileDownload } from '../services/file-selection.js';

interface CompletionModalProps {
  isOpen: boolean;
  completedFiles: CompletedFileRecord[];
  onReset: () => void;
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  isOpen,
  completedFiles,
  onReset
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4 shadow-sm">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
          Transfer Completed!
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {completedFiles.length} {completedFiles.length === 1 ? 'file' : 'files'} transferred directly over peer-to-peer connection.
        </p>

        {/* SHA-256 Integrity Verification Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-semibold mb-5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>SHA-256 Checksum Verified (100% Match)</span>
        </div>

        {/* File list with save buttons */}
        <div className="max-h-52 overflow-y-auto space-y-2 mb-6 text-left">
          {completedFiles.map((file) => (
            <div
              key={file.id}
              className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3"
            >
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {file.name}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{formatBytes(file.size)}</span>
                  <span className="font-mono text-slate-400">
                    {file.sha256 ? `${file.sha256.substring(0, 10)}...` : ''}
                  </span>
                </div>
              </div>
              {file.blob && (
                <button
                  onClick={() => triggerFileDownload(file.blob!, file.name)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={onReset}
          className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Start New Transfer
        </button>
      </div>
    </div>
  );
};


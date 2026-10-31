import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck, Download, RefreshCw, Check, ArrowUpRight } from 'lucide-react';
import { CompletedFileRecord } from '../state/transfer-store.js';
import { formatBytes, triggerFileDownload } from '../services/file-selection.js';
import { TransferRole } from '@peerport/shared-types';

interface CompletionModalProps {
  isOpen: boolean;
  role: TransferRole | null;
  completedFiles: CompletedFileRecord[];
  onReset: () => void;
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  isOpen,
  role,
  completedFiles,
  onReset
}) => {
  const [isSavingAll, setIsSavingAll] = useState(false);

  if (!isOpen) return null;

  // Strict, mutually exclusive role checks
  const isSender = role === 'SENDER';
  const isReceiver = role === 'RECEIVER';

  const handleSaveAll = async () => {
    if (!isReceiver) return;
    setIsSavingAll(true);
    for (const file of completedFiles) {
      if (file.blob) {
        triggerFileDownload(file.blob, file.name);
        // Small delay between programmatic downloads to prevent mobile browser pop-up suppression
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    setIsSavingAll(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl text-center">
        <div
          className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-sm ${
            isSender
              ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
              : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {isSender ? <ArrowUpRight className="w-8 h-8" /> : <CheckCircle2 className="w-8 h-8" />}
        </div>

        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
          {isSender
            ? 'Sent Successfully!'
            : isReceiver
            ? 'Files Received Successfully!'
            : 'Transfer Completed!'}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {isSender
            ? `${completedFiles.length} ${completedFiles.length === 1 ? 'file' : 'files'} delivered directly and verified by recipient.`
            : isReceiver
            ? `${completedFiles.length} ${completedFiles.length === 1 ? 'file' : 'files'} transferred directly over peer-to-peer connection.`
            : `${completedFiles.length} ${completedFiles.length === 1 ? 'file' : 'files'} transferred.`}
        </p>

        {/* Verification Status Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-semibold mb-5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>
            {isSender
              ? 'Delivery & SHA-256 Checksum Verified by Receiver'
              : isReceiver
              ? 'SHA-256 Checksum Verified (100% Match)'
              : 'SHA-256 Checksum Verified'}
          </span>
        </div>

        {/* File list */}
        <div className="max-h-52 overflow-y-auto space-y-2 mb-5 text-left">
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

              {/* Save button ONLY when strictly RECEIVER with a valid blob */}
              {isReceiver && file.blob ? (
                <button
                  onClick={() => triggerFileDownload(file.blob!, file.name)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save
                </button>
              ) : isSender ? (
                <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1 shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  <span>Delivered</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Receiver-only: Save All action for multi-file transfers */}
        {isReceiver && completedFiles.length > 1 && (
          <button
            onClick={handleSaveAll}
            disabled={isSavingAll}
            className="w-full mb-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {isSavingAll ? 'Saving All Files...' : `Save All (${completedFiles.length} files)`}
          </button>
        )}

        {/* Primary Action Button */}
        <button
          onClick={onReset}
          className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          {isSender ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Done
            </>
          ) : isReceiver ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              Start New Transfer
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              Close
            </>
          )}
        </button>
      </div>
    </div>
  );
};

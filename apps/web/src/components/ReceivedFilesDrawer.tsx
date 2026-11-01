import React, { useState } from 'react';
import {
  X,
  Download,
  Trash2,
  HardDrive,
  ShieldCheck,
  Calendar,
  FileText,
  AlertTriangle,
  FolderArchive
} from 'lucide-react';
import { StoredReceivedFile, offlineStorage } from '../services/offline-storage.js';
import { formatBytes, triggerFileDownload } from '../services/file-selection.js';

interface ReceivedFilesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  savedFiles: StoredReceivedFile[];
  onRefresh: () => Promise<void>;
}

export const ReceivedFilesDrawer: React.FC<ReceivedFilesDrawerProps> = ({
  isOpen,
  onClose,
  savedFiles,
  onRefresh
}) => {
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);

  if (!isOpen) return null;

  const handleDownload = (file: StoredReceivedFile) => {
    if (file.blob) {
      triggerFileDownload(file.blob, file.name);
    }
  };

  const handleSaveAll = async () => {
    setIsSavingAll(true);
    for (const file of savedFiles) {
      if (file.blob) {
        triggerFileDownload(file.blob, file.name);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    setIsSavingAll(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await offlineStorage.deleteReceivedFile(id);
      await onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (window.confirm('Are you sure you want to remove all saved files from browser storage?')) {
      setIsClearingAll(true);
      try {
        await offlineStorage.clearAllReceivedFiles();
        await onRefresh();
      } finally {
        setIsClearingAll(false);
      }
    }
  };

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Recently';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full shadow-2xl flex flex-col">
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
              <HardDrive className="w-5 h-5 text-sky-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Saved Files</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {savedFiles.length}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Persistent offline browser storage
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close saved files drawer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Action Bar */}
        {savedFiles.length > 0 && (
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
            <button
              onClick={handleSaveAll}
              disabled={isSavingAll}
              className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {isSavingAll ? 'Saving All...' : `Save All (${savedFiles.length})`}
            </button>
            <button
              onClick={handleClearAll}
              disabled={isClearingAll}
              className="py-1.5 px-3 rounded-lg border border-rose-300 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        )}

        {/* Files List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {savedFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <FolderArchive className="w-12 h-12 mb-3 stroke-1 text-slate-400" />
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                No Saved Files Yet
              </h4>
              <p className="text-xs text-slate-500 max-w-xs">
                Files received in PeerPort will automatically be saved here so you can download them even when completely offline.
              </p>
            </div>
          ) : (
            savedFiles.map((file) => (
              <div
                key={file.id}
                className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 shadow-sm flex flex-col gap-2.5 transition-all hover:border-slate-300 dark:hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        <span>{formatBytes(file.size)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formatDate(file.receivedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDownload(file)}
                      title="Download file"
                      className="p-1.5 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(file.id)}
                      disabled={deletingId === file.id}
                      title="Delete from storage"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Verification Checksum pill */}
                <div className="flex items-center justify-between text-[10px] px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-mono">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                    <ShieldCheck className="w-3 h-3 text-emerald-500" />
                    Verified
                  </span>
                  <span title={file.sha256}>
                    SHA-256: {file.sha256 ? `${file.sha256.substring(0, 10)}...` : 'N/A'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-center text-[10px] text-slate-400">
          PeerPort IndexedDB Store • Private to this browser
        </div>
      </div>
    </div>
  );
};


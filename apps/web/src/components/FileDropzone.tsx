import React, { useRef, useState } from 'react';
import { UploadCloud, File, Image, Film, Music, FileText, X, Plus, Trash2 } from 'lucide-react';
import { useTransferStore } from '../state/transfer-store.js';
import { categorizeFile, formatBytes } from '../services/file-selection.js';

export const FileDropzone: React.FC = () => {
  const { selectedFiles, addFiles, removeFile, clearFiles } = useTransferStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const getFileIcon = (file: File) => {
    const category = categorizeFile(file);
    switch (category) {
      case 'photo':
        return <Image className="w-5 h-5 text-emerald-500" />;
      case 'video':
        return <Film className="w-5 h-5 text-purple-500" />;
      case 'audio':
        return <Music className="w-5 h-5 text-amber-500" />;
      case 'document':
        return <FileText className="w-5 h-5 text-sky-500" />;
      default:
        return <File className="w-5 h-5 text-slate-400" />;
    }
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
      />

      {selectedFiles.length === 0 ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
            isDragOver
              ? 'border-sky-500 bg-sky-500/5 dark:bg-sky-500/10 scale-[1.01]'
              : 'border-slate-300 dark:border-slate-700/80 hover:border-sky-400 dark:hover:border-slate-600 bg-white dark:bg-slate-900/50'
          }`}
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-4 shadow-sm">
            <UploadCloud className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Choose files or drag & drop here
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            Photos, 4K videos, documents, or music. Files stream directly between devices with zero cloud limits.
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800">Photos</span>
            <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800">Videos</span>
            <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800">Music</span>
            <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800">Any File</span>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                {selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'} selected
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total size: {formatBytes(totalBytes)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add more
              </button>
              <button
                onClick={clearFiles}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-56 overflow-y-auto mt-2">
            {selectedFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="flex items-center justify-between py-2.5 px-1 group">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                    {getFileIcon(file)}
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

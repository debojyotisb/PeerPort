import { create } from 'zustand';
import { TransferManifest, TransferProgress, FileMetadata } from '@peerport/shared-types';

export interface CompletedFileRecord {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  blob?: Blob;
  blobUrl?: string;
  verified: boolean;
}

interface TransferStoreState {
  selectedFiles: File[];
  outgoingManifest: TransferManifest | null;
  incomingManifest: TransferManifest | null;
  progress: TransferProgress | null;
  completedFiles: CompletedFileRecord[];
  isVerifyingIntegrity: boolean;

  // Actions
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  clearFiles: () => void;
  setOutgoingManifest: (manifest: TransferManifest | null) => void;
  setIncomingManifest: (manifest: TransferManifest | null) => void;
  setProgress: (progress: TransferProgress | null) => void;
  setVerifyingIntegrity: (verifying: boolean) => void;
  addCompletedFile: (file: CompletedFileRecord) => void;
  resetTransfer: () => void;
}

export const useTransferStore = create<TransferStoreState>((set) => ({
  selectedFiles: [],
  outgoingManifest: null,
  incomingManifest: null,
  progress: null,
  completedFiles: [],
  isVerifyingIntegrity: false,

  addFiles: (newFiles) =>
    set((state) => {
      // Prevent duplicates by name and size
      const existingKeys = new Set(state.selectedFiles.map((f) => `${f.name}_${f.size}`));
      const unique = newFiles.filter((f) => !existingKeys.has(`${f.name}_${f.size}`));
      return { selectedFiles: [...state.selectedFiles, ...unique] };
    }),

  removeFile: (index) =>
    set((state) => ({
      selectedFiles: state.selectedFiles.filter((_, i) => i !== index)
    })),

  clearFiles: () => set({ selectedFiles: [] }),
  setOutgoingManifest: (outgoingManifest) => set({ outgoingManifest }),
  setIncomingManifest: (incomingManifest) => set({ incomingManifest }),
  setProgress: (progress) => set({ progress }),
  setVerifyingIntegrity: (isVerifyingIntegrity) => set({ isVerifyingIntegrity }),
  addCompletedFile: (file) =>
    set((state) => ({
      completedFiles: [...state.completedFiles, file]
    })),
  resetTransfer: () =>
    set({
      selectedFiles: [],
      outgoingManifest: null,
      incomingManifest: null,
      progress: null,
      completedFiles: [],
      isVerifyingIntegrity: false
    })
}));


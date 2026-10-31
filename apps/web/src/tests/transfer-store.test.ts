import { describe, it, expect, beforeEach } from 'vitest';
import { useTransferStore } from '../state/transfer-store.js';

describe('Transfer Store Deduplication and File Staging', () => {
  beforeEach(() => {
    useTransferStore.getState().resetTransfer();
  });

  it('deduplicates completed files using unique file IDs without false deduplication', () => {
    const store = useTransferStore.getState();

    // File 1: image.jpg
    store.addCompletedFile({
      id: 'file_001',
      name: 'image.jpg',
      size: 5000,
      mimeType: 'image/jpeg',
      sha256: 'hash_111',
      verified: true
    });

    // File 2: A legitimate DIFFERENT file that happens to share the same name and size
    store.addCompletedFile({
      id: 'file_002',
      name: 'image.jpg',
      size: 5000,
      mimeType: 'image/jpeg',
      sha256: 'hash_222',
      verified: true
    });

    const state = useTransferStore.getState();
    expect(state.completedFiles.length).toBe(2);
    expect(state.completedFiles[0].id).toBe('file_001');
    expect(state.completedFiles[1].id).toBe('file_002');
  });

  it('ignores duplicate completion events for an already registered file ID', () => {
    const store = useTransferStore.getState();

    const record = {
      id: 'file_stable_123',
      name: 'video.mp4',
      size: 1048576,
      mimeType: 'video/mp4',
      sha256: 'abc123hash',
      verified: true
    };

    // First completion event
    store.addCompletedFile(record);
    expect(useTransferStore.getState().completedFiles.length).toBe(1);

    // Duplicate completion event (e.g. from network retry or duplicate callback)
    store.addCompletedFile(record);
    expect(useTransferStore.getState().completedFiles.length).toBe(1);
  });

  it('allows individual file removal and clearing staged files', () => {
    const store = useTransferStore.getState();

    const f1 = new File(['hello'], 'f1.txt');
    const f2 = new File(['world!'], 'f2.txt');

    store.addFiles([f1, f2]);
    expect(useTransferStore.getState().selectedFiles.length).toBe(2);

    // Remove first file
    store.removeFile(0);
    expect(useTransferStore.getState().selectedFiles.length).toBe(1);
    expect(useTransferStore.getState().selectedFiles[0].name).toBe('f2.txt');

    // Clear all
    store.clearFiles();
    expect(useTransferStore.getState().selectedFiles.length).toBe(0);
  });

  it('resets transfer state cleanly without throwing', () => {
    const store = useTransferStore.getState();
    store.addCompletedFile({
      id: 'file_xyz',
      name: 'test.pdf',
      size: 100,
      mimeType: 'application/pdf',
      sha256: 'hash',
      verified: true
    });

    expect(useTransferStore.getState().completedFiles.length).toBe(1);
    store.resetTransfer();
    expect(useTransferStore.getState().completedFiles.length).toBe(0);
    expect(useTransferStore.getState().selectedFiles.length).toBe(0);
  });
});


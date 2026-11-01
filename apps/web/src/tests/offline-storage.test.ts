import { describe, it, expect, beforeEach } from 'vitest';
import { offlineStorage, StoredReceivedFile } from '../services/offline-storage.js';

describe('Offline Storage Service (IndexedDB / Fallback)', () => {
  const sampleFile1: StoredReceivedFile = {
    id: 'f_test_01',
    transferId: 'tr_test_01',
    name: 'document.pdf',
    size: 1024,
    mimeType: 'application/pdf',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    blob: new Blob(['sample pdf data'], { type: 'application/pdf' }),
    verified: true,
    receivedAt: 1000
  };

  const sampleFile2: StoredReceivedFile = {
    id: 'f_test_02',
    transferId: 'tr_test_01',
    name: 'photo.jpg',
    size: 2048,
    mimeType: 'image/jpeg',
    sha256: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    blob: new Blob(['sample image data'], { type: 'image/jpeg' }),
    verified: true,
    receivedAt: 2000
  };

  beforeEach(async () => {
    await offlineStorage.clearAllReceivedFiles();
  });

  it('persists and retrieves a received file', async () => {
    await offlineStorage.saveReceivedFile(sampleFile1);
    const retrieved = await offlineStorage.getReceivedFile('f_test_01');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('f_test_01');
    expect(retrieved!.name).toBe('document.pdf');
    expect(retrieved!.size).toBe(1024);
    expect(retrieved!.verified).toBe(true);
  });

  it('retrieves all received files sorted newest first', async () => {
    await offlineStorage.saveReceivedFile(sampleFile1);
    await offlineStorage.saveReceivedFile(sampleFile2);

    const all = await offlineStorage.getAllReceivedFiles();
    expect(all.length).toBe(2);
    // sampleFile2 was received at 2000, sampleFile1 at 1000
    expect(all[0].id).toBe('f_test_02');
    expect(all[1].id).toBe('f_test_01');
  });

  it('deletes an individual file by id', async () => {
    await offlineStorage.saveReceivedFile(sampleFile1);
    await offlineStorage.saveReceivedFile(sampleFile2);

    await offlineStorage.deleteReceivedFile('f_test_01');
    const remaining = await offlineStorage.getAllReceivedFiles();

    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('f_test_02');

    const deleted = await offlineStorage.getReceivedFile('f_test_01');
    expect(deleted).toBeNull();
  });

  it('clears all files', async () => {
    await offlineStorage.saveReceivedFile(sampleFile1);
    await offlineStorage.saveReceivedFile(sampleFile2);

    await offlineStorage.clearAllReceivedFiles();
    const all = await offlineStorage.getAllReceivedFiles();
    expect(all.length).toBe(0);
  });
});


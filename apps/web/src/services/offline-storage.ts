/**
 * PeerPort Offline File Storage Service
 *
 * Implements persistent, client-side storage for received files using IndexedDB.
 * Ensures received files remain available, verifiable, and downloadable even when
 * the device is completely offline, after WebSocket/WebRTC disconnections,
 * or across full browser reloads.
 */

export interface StoredReceivedFile {
  id: string;
  transferId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  blob?: Blob;
  blobUrl?: string;
  verified: boolean;
  receivedAt: number;
}

const DB_NAME = 'peerport_db';
const DB_VERSION = 1;
const STORE_NAME = 'received_files';

class OfflineStorageService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private inMemoryFallback: Map<string, StoredReceivedFile> = new Map();

  /**
   * Initializes or returns the open IndexedDB database connection.
   * If IndexedDB is not available (e.g. Node/SSR test environments),
   * falls back safely to in-memory storage.
   */
  private async getDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('receivedAt', 'receivedAt', { unique: false });
            store.createIndex('transferId', 'transferId', { unique: false });
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          console.warn('IndexedDB open error:', request.error);
          resolve(null);
        };

        request.onblocked = () => {
          console.warn('IndexedDB upgrade blocked by another open tab');
        };
      } catch (err) {
        console.warn('Failed to initialize IndexedDB:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Persists a received file record into IndexedDB.
   */
  async saveReceivedFile(file: StoredReceivedFile): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.inMemoryFallback.set(file.id, file);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Strip blobUrl before saving to IndexedDB as Object URLs cannot be serialized
        const { blobUrl, ...persistable } = file;
        const request = store.put(persistable);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('Failed to put file in IndexedDB:', request.error);
          reject(request.error);
        };
      } catch (err) {
        console.error('Transaction error saving received file:', err);
        this.inMemoryFallback.set(file.id, file);
        resolve();
      }
    });
  }

  /**
   * Retrieves all received files from storage, sorted by newest first.
   */
  async getAllReceivedFiles(): Promise<StoredReceivedFile[]> {
    const db = await this.getDb();
    if (!db) {
      return Array.from(this.inMemoryFallback.values()).sort((a, b) => b.receivedAt - a.receivedAt);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('receivedAt');
        const request = index.openCursor(null, 'prev'); // Newest first

        const results: StoredReceivedFile[] = [];

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const item = cursor.value as StoredReceivedFile;
            if (item.blob) {
              try {
                item.blobUrl = URL.createObjectURL(item.blob);
              } catch {}
            }
            results.push(item);
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = () => {
          console.warn('Error reading files from IndexedDB:', request.error);
          resolve([]);
        };
      } catch (err) {
        console.warn('Transaction error reading received files:', err);
        resolve([]);
      }
    });
  }

  /**
   * Retrieves a single received file by unique ID.
   */
  async getReceivedFile(id: string): Promise<StoredReceivedFile | null> {
    const db = await this.getDb();
    if (!db) {
      return this.inMemoryFallback.get(id) || null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const item = request.result as StoredReceivedFile | undefined;
          if (item) {
            if (item.blob && !item.blobUrl) {
              try {
                item.blobUrl = URL.createObjectURL(item.blob);
              } catch {}
            }
            resolve(item);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.warn('Error getting file by id:', request.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('Transaction error fetching received file:', err);
        resolve(null);
      }
    });
  }

  /**
   * Deletes a received file from storage by ID.
   */
  async deleteReceivedFile(id: string): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.inMemoryFallback.delete(id);
      return;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('Failed to delete file from IndexedDB:', request.error);
          resolve();
        };
      } catch (err) {
        console.warn('Transaction error deleting received file:', err);
        resolve();
      }
    });
  }

  /**
   * Clears all saved received files.
   */
  async clearAllReceivedFiles(): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.inMemoryFallback.clear();
      return;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('Failed to clear files from IndexedDB:', request.error);
          resolve();
        };
      } catch (err) {
        console.warn('Transaction error clearing received files:', err);
        resolve();
      }
    });
  }
}

export const offlineStorage = new OfflineStorageService();


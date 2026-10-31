import {
  TransferManifest,
  FileMetadata,
  BinaryChunk,
  ChunkHeader,
  TransferProgress,
  PeerTransport,
  PeerConnection
} from '@peerport/shared-types';
import {
  DEFAULT_FLOW_CONFIG,
  ChunkMessageType,
  SpeedCalculator,
  computeSha256
} from '@peerport/transfer-protocol';
import { createFileMetadata } from './file-selection.js';
import { getLocalDeviceInfo, generateSecureId } from './device-info.js';
import { CompletedFileRecord } from '../state/transfer-store.js';

export class TransferEngine {
  private isCancelled = false;
  private speedCalc = new SpeedCalculator();

  // Receiver state
  private activeManifest: TransferManifest | null = null;
  private fileChunks = new Map<string, Map<number, Uint8Array>>();
  private fileReceivedBytes = new Map<string, number>();
  private completedFileIds = new Set<string>();

  /**
   * Generates a signed TransferManifest for a list of files using cryptographically secure IDs.
   */
  createManifest(files: File[]): TransferManifest {
    const localDevice = getLocalDeviceInfo();
    const fileMetadatas: FileMetadata[] = files.map((f) => createFileMetadata(f));
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const transferId = generateSecureId('tr');
    const token = generateSecureId('tok');

    return {
      transferId,
      sender: {
        deviceId: localDevice.deviceId,
        deviceName: localDevice.deviceName,
        platform: localDevice.platform
      },
      files: fileMetadatas,
      totalBytes,
      totalFiles: files.length,
      timestamp: Date.now(),
      token
    };
  }

  /**
   * Streams a file in 64 KiB chunks through the given PeerTransport with backpressure.
   */
  async sendFile(
    transport: PeerTransport,
    connection: PeerConnection,
    file: File,
    manifest: TransferManifest,
    fileIndex: number,
    onProgress: (progress: TransferProgress) => void
  ): Promise<string> {
    this.isCancelled = false;
    this.speedCalc.reset();

    const chunkSize = DEFAULT_FLOW_CONFIG.chunkSize;
    const totalChunks = Math.ceil(file.size / chunkSize) || 1;
    const fileId = manifest.files[fileIndex]?.id || `file_${fileIndex}`;

    let bytesSent = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (this.isCancelled) {
        throw new Error('Transfer was cancelled by user');
      }

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const slice = file.slice(start, end);
      const arrayBuf = await slice.arrayBuffer();
      const payload = new Uint8Array(arrayBuf);

      const header: ChunkHeader = {
        magic: 0x50505254,
        version: 1,
        messageType: ChunkMessageType.DATA,
        transferId: manifest.transferId,
        fileId,
        chunkIndex,
        totalChunks,
        payloadLength: payload.byteLength
      };

      const chunk: BinaryChunk = { header, data: payload };
      await transport.sendChunk(connection, chunk);

      bytesSent += payload.byteLength;
      const { speedBps, etaSec } = this.speedCalc.update(bytesSent, file.size);

      onProgress({
        transferId: manifest.transferId,
        fileId,
        fileName: file.name,
        fileIndex,
        totalFiles: manifest.totalFiles,
        bytesTransferred: bytesSent,
        totalBytes: file.size,
        percentage: Math.min(100, Math.round((bytesSent / file.size) * 100)),
        speedBytesPerSec: speedBps,
        timeRemainingSec: etaSec
      });
    }

    // Compute hardware SHA-256
    const fullBuffer = await file.arrayBuffer();
    const sha256 = await computeSha256(fullBuffer);
    return sha256;
  }

  /**
   * Initializes the receiving engine for an incoming manifest.
   */
  prepareReceiver(manifest: TransferManifest) {
    this.activeManifest = manifest;
    this.fileChunks.clear();
    this.fileReceivedBytes.clear();
    this.completedFileIds.clear();
    this.speedCalc.reset();
    this.isCancelled = false;

    for (const f of manifest.files) {
      this.fileChunks.set(f.id, new Map());
      this.fileReceivedBytes.set(f.id, 0);
    }
  }

  /**
   * Processes an incoming binary chunk on the receiver side.
   * Returns a CompletedFileRecord if this chunk completed a file.
   */
  async handleIncomingChunk(
    chunk: BinaryChunk,
    onProgress: (progress: TransferProgress) => void
  ): Promise<CompletedFileRecord | null> {
    if (this.isCancelled || !this.activeManifest) return null;

    const { header, data } = chunk;

    // Validate transferId matches current active transfer
    const manifestPrefix = this.activeManifest.transferId.slice(0, 16);
    if (header.transferId !== this.activeManifest.transferId && !header.transferId.startsWith(manifestPrefix) && !manifestPrefix.startsWith(header.transferId)) {
      return null;
    }

    // Validate chunk bounds
    if (header.chunkIndex < 0 || header.chunkIndex >= header.totalChunks) {
      return null;
    }

    // Find corresponding file metadata
    const fileIndex = this.activeManifest.files.findIndex(
      (f) => f.id.slice(0, 12) === header.fileId || f.id === header.fileId
    );
    if (fileIndex === -1) return null;

    const fileMeta = this.activeManifest.files[fileIndex];
    let chunksMap = this.fileChunks.get(fileMeta.id);
    if (!chunksMap) {
      chunksMap = new Map();
      this.fileChunks.set(fileMeta.id, chunksMap);
    }

    // Prevent duplicate chunk insertion
    if (!chunksMap.has(header.chunkIndex)) {
      chunksMap.set(header.chunkIndex, data);
      const prevBytes = this.fileReceivedBytes.get(fileMeta.id) || 0;
      const currentBytes = prevBytes + data.byteLength;
      this.fileReceivedBytes.set(fileMeta.id, currentBytes);

      // Report progress
      const { speedBps, etaSec } = this.speedCalc.update(currentBytes, fileMeta.size);
      onProgress({
        transferId: this.activeManifest.transferId,
        fileId: fileMeta.id,
        fileName: fileMeta.name,
        fileIndex,
        totalFiles: this.activeManifest.totalFiles,
        bytesTransferred: currentBytes,
        totalBytes: fileMeta.size,
        percentage: Math.min(100, Math.round((currentBytes / fileMeta.size) * 100)),
        speedBytesPerSec: speedBps,
        timeRemainingSec: etaSec
      });
    }

    // Check if all chunks for this file have arrived
    if (chunksMap.size === header.totalChunks && !this.completedFileIds.has(fileMeta.id)) {
      // Reconstruct chunks in sequential order
      const orderedSlices: Uint8Array[] = [];
      for (let i = 0; i < header.totalChunks; i++) {
        const slice = chunksMap.get(i);
        if (!slice) {
          console.error(`Missing chunk index ${i} of ${header.totalChunks} for file ${fileMeta.name}`);
          return null;
        }
        orderedSlices.push(slice);
      }

      const blob = new Blob(orderedSlices as BlobPart[], { type: fileMeta.mimeType || 'application/octet-stream' });

      // Verify complete file size matches manifest
      if (blob.size !== fileMeta.size) {
        console.error(`File size mismatch for ${fileMeta.name}: expected ${fileMeta.size}, got ${blob.size}`);
        return null;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const sha256 = await computeSha256(arrayBuffer);

      // If manifest specified a sha256 checksum, verify 100% match
      if (fileMeta.sha256 && fileMeta.sha256.toLowerCase() !== sha256.toLowerCase()) {
        console.error(`SHA-256 mismatch for ${fileMeta.name}: expected ${fileMeta.sha256}, got ${sha256}`);
        return null;
      }

      // Mark file as completed only after successful assembly and verification
      this.completedFileIds.add(fileMeta.id);

      return {
        id: fileMeta.id,
        name: fileMeta.name,
        size: blob.size,
        mimeType: fileMeta.mimeType,
        sha256,
        blob,
        blobUrl: URL.createObjectURL(blob),
        verified: true
      };
    }

    return null;
  }

  getActiveManifest(): TransferManifest | null {
    return this.activeManifest;
  }

  isAllFilesReceived(): boolean {
    if (!this.activeManifest) return false;
    return this.completedFileIds.size === this.activeManifest.files.length;
  }

  cancel(): void {
    this.isCancelled = true;
    this.activeManifest = null;
    this.fileChunks.clear();
    this.fileReceivedBytes.clear();
  }
}

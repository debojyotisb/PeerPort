import {
  TransferManifest,
  FileMetadata,
  BinaryChunk,
  ChunkHeader,
  TransferProgress
} from '@peerport/shared-types';
import {
  DEFAULT_FLOW_CONFIG,
  ChunkMessageType,
  SpeedCalculator,
  computeSha256
} from '@peerport/transfer-protocol';
import { createFileMetadata } from './file-selection.js';
import { getLocalDeviceInfo } from './device-info.js';
import { PeerTransport, PeerConnection } from '@peerport/shared-types';

export class TransferEngine {
  private isCancelled = false;
  private speedCalc = new SpeedCalculator();

  /**
   * Generates a signed TransferManifest for a list of files.
   */
  createManifest(files: File[]): TransferManifest {
    const localDevice = getLocalDeviceInfo();
    const fileMetadatas: FileMetadata[] = files.map((f) => createFileMetadata(f));
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const transferId = `tr_${Math.random().toString(36).substring(2, 12)}`;
    const token = Math.random().toString(36).substring(2, 16);

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

    // Compute final hash
    const fullBuffer = await file.arrayBuffer();
    const sha256 = await computeSha256(fullBuffer);
    return sha256;
  }

  cancel(): void {
    this.isCancelled = true;
  }
}

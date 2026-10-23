export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified?: number;
  sha256?: string; // Calculated upfront or streaming verified
}

export interface TransferManifest {
  transferId: string;
  sender: {
    deviceId: string;
    deviceName: string;
    platform: string;
  };
  files: FileMetadata[];
  totalBytes: number;
  totalFiles: number;
  timestamp: number;
  token: string; // Ephemeral transfer authorization token
}

export interface TransferRequest {
  manifest: TransferManifest;
}

export interface TransferResponse {
  transferId: string;
  accepted: boolean;
  reason?: string;
  timestamp: number;
}

export interface ChunkHeader {
  magic: number; // 0x50505254 ("PPRT")
  version: number;
  messageType: number;
  transferId: string;
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  payloadLength: number;
}

export interface BinaryChunk {
  header: ChunkHeader;
  data: Uint8Array;
}

export interface TransferProgress {
  transferId: string;
  fileId: string;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  timeRemainingSec: number;
}


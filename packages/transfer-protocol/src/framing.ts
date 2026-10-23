import { ChunkHeader, BinaryChunk } from '@peerport/shared-types';

export const PROTOCOL_MAGIC = 0x50505254; // "PPRT"
export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 48;

export enum ChunkMessageType {
  DATA = 1,
  ACK = 2,
  END_OF_FILE = 3
}

/**
 * Encodes a chunk header and data into a single contiguous Uint8Array.
 */
export function encodeChunk(header: ChunkHeader, payload: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  // Magic & Version
  view.setUint32(0, PROTOCOL_MAGIC, false);
  view.setUint16(4, PROTOCOL_VERSION, false);
  view.setUint16(6, header.messageType, false);

  // Indexes & Lengths
  view.setUint32(8, header.chunkIndex, false);
  view.setUint32(12, header.totalChunks, false);
  view.setUint32(16, payload.byteLength, false);

  // Transfer ID (16 bytes ASCII padded/truncated)
  const encoder = new TextEncoder();
  const transferIdBytes = encoder.encode(header.transferId.slice(0, 16));
  out.set(transferIdBytes, 20);

  // File ID (12 bytes ASCII padded/truncated)
  const fileIdBytes = encoder.encode(header.fileId.slice(0, 12));
  out.set(fileIdBytes, 36);

  // Payload
  out.set(payload, HEADER_SIZE);

  return out;
}

/**
 * Decodes a contiguous Uint8Array or ArrayBuffer into header metadata and payload slice.
 */
export function decodeChunk(raw: ArrayBuffer | Uint8Array): BinaryChunk {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error(`Invalid chunk: buffer length ${bytes.byteLength} is less than header size ${HEADER_SIZE}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  const magic = view.getUint32(0, false);

  if (magic !== PROTOCOL_MAGIC) {
    throw new Error(`Invalid protocol magic: 0x${magic.toString(16)} (expected 0x${PROTOCOL_MAGIC.toString(16)})`);
  }

  const version = view.getUint16(4, false);
  const messageType = view.getUint16(6, false);
  const chunkIndex = view.getUint32(8, false);
  const totalChunks = view.getUint32(12, false);
  const payloadLength = view.getUint32(16, false);

  if (bytes.byteLength < HEADER_SIZE + payloadLength) {
    throw new Error(`Incomplete chunk: expected ${HEADER_SIZE + payloadLength} bytes, received ${bytes.byteLength}`);
  }

  const decoder = new TextDecoder();
  const transferId = decoder.decode(bytes.slice(20, 36)).replace(/\0+$/, '').trim();
  const fileId = decoder.decode(bytes.slice(36, 48)).replace(/\0+$/, '').trim();

  const data = bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLength);

  const header: ChunkHeader = {
    magic,
    version,
    messageType,
    transferId,
    fileId,
    chunkIndex,
    totalChunks,
    payloadLength
  };

  return { header, data };
}


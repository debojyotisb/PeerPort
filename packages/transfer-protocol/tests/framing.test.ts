import { describe, it, expect } from 'vitest';
import { encodeChunk, decodeChunk, PROTOCOL_MAGIC, PROTOCOL_VERSION, ChunkMessageType } from '../src/framing.js';
import { ChunkHeader } from '@peerport/shared-types';

describe('Transfer Protocol Binary Framing', () => {
  it('correctly encodes and decodes a file chunk', () => {
    const header: ChunkHeader = {
      magic: PROTOCOL_MAGIC,
      version: PROTOCOL_VERSION,
      messageType: ChunkMessageType.DATA,
      transferId: 'tr_1234567890ab',
      fileId: 'file_001',
      chunkIndex: 4,
      totalChunks: 20,
      payloadLength: 12
    };

    const payload = new TextEncoder().encode('Hello World!');
    const encoded = encodeChunk(header, payload);

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.byteLength).toBe(48 + payload.byteLength);

    const decoded = decodeChunk(encoded);
    expect(decoded.header.magic).toBe(PROTOCOL_MAGIC);
    expect(decoded.header.version).toBe(PROTOCOL_VERSION);
    expect(decoded.header.messageType).toBe(ChunkMessageType.DATA);
    expect(decoded.header.chunkIndex).toBe(4);
    expect(decoded.header.totalChunks).toBe(20);
    expect(decoded.header.payloadLength).toBe(12);
    expect(decoded.header.transferId).toBe('tr_1234567890ab');
    expect(decoded.header.fileId).toBe('file_001');

    const decodedText = new TextDecoder().decode(decoded.data);
    expect(decodedText).toBe('Hello World!');
  });

  it('rejects buffers with invalid magic bytes', () => {
    const invalidBuffer = new Uint8Array(64);
    // Invalid magic 0x12345678
    new DataView(invalidBuffer.buffer).setUint32(0, 0x12345678);

    expect(() => decodeChunk(invalidBuffer)).toThrow(/Invalid protocol magic/);
  });

  it('rejects truncated buffers that are smaller than the header', () => {
    const tooSmall = new Uint8Array(20);
    expect(() => decodeChunk(tooSmall)).toThrow(/less than header size/);
  });
});

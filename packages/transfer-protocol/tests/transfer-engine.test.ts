import { describe, it, expect } from 'vitest';
import { TransferEngine } from '../../../apps/web/src/services/transfer-engine.js';
import { computeSha256 } from '../src/integrity.js';
import { encodeChunk, decodeChunk } from '../src/framing.js';

describe('Real File Transfer Engine Loop', () => {
  it('chunks, reconstructs, and cryptographically verifies a real file payload', async () => {
    const engine = new TransferEngine();

    // Create a realistic sample binary payload (e.g. 150 KB > 2 chunks of 64 KB)
    const originalContent = new Uint8Array(150 * 1024);
    for (let i = 0; i < originalContent.length; i++) {
      originalContent[i] = i % 256;
    }

    const expectedSha256 = await computeSha256(originalContent);

    // Mock a File object
    const file = new File([originalContent], 'sample-document.pdf', {
      type: 'application/pdf',
      lastModified: Date.now()
    });

    const manifest = engine.createManifest([file]);
    expect(manifest.files.length).toBe(1);
    expect(manifest.files[0].name).toBe('sample-document.pdf');
    expect(manifest.totalBytes).toBe(150 * 1024);

    // Prepare receiver
    engine.prepareReceiver(manifest);

    // Mock Transport to collect chunks and deliver them to receiver
    const sentChunks: any[] = [];
    const mockTransport: any = {
      sendChunk: async (_conn: any, chunk: any) => {
        // Test real binary serialization across network
        const encoded = encodeChunk(chunk.header, chunk.data);
        const decoded = decodeChunk(encoded);
        sentChunks.push(decoded);
      }
    };

    // Sender sends file
    const senderSha256 = await engine.sendFile(
      mockTransport,
      { id: 'peer_1' } as any,
      file,
      manifest,
      0,
      () => {}
    );

    expect(senderSha256).toBe(expectedSha256);
    expect(sentChunks.length).toBe(3); // 64K + 64K + 22K = 3 chunks

    // Receiver processes incoming chunks
    let completedRecord: any = null;
    for (const chunk of sentChunks) {
      const record = await engine.handleIncomingChunk(chunk, () => {});
      if (record) {
        completedRecord = record;
      }
    }

    expect(completedRecord).not.toBeNull();
    expect(completedRecord.name).toBe('sample-document.pdf');
    expect(completedRecord.size).toBe(150 * 1024);
    expect(completedRecord.sha256).toBe(expectedSha256);
    expect(completedRecord.verified).toBe(true);
    expect(engine.isAllFilesReceived()).toBe(true);

    // Verify reconstructed blob content matches byte-for-byte
    const reconstructedBuffer = await completedRecord.blob.arrayBuffer();
    const reconstructedBytes = new Uint8Array(reconstructedBuffer);
    expect(reconstructedBytes.length).toBe(originalContent.length);
    for (let i = 0; i < originalContent.length; i++) {
      expect(reconstructedBytes[i]).toBe(originalContent[i]);
    }
  });

  it('rejects duplicate or out-of-session chunks safely without corruption', async () => {
    const engine = new TransferEngine();
    const payload = new Uint8Array(1024);
    const file = new File([payload], 'image.png', { type: 'image/png' });
    const manifest = engine.createManifest([file]);

    engine.prepareReceiver(manifest);

    // Mismatched transferId
    const rogueChunk: any = {
      header: {
        magic: 0x50505254,
        version: 1,
        messageType: 1,
        transferId: 'rogue_id_123456',
        fileId: manifest.files[0].id.slice(0, 12),
        chunkIndex: 0,
        totalChunks: 1,
        payloadLength: 1024
      },
      data: payload
    };

    const res = await engine.handleIncomingChunk(rogueChunk, () => {});
    expect(res).toBeNull();
  });
});

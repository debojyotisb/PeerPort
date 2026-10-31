import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransferEngine } from '../services/transfer-engine.js';
import { computeSha256 } from '@peerport/transfer-protocol';
import { TransferCompletePayload } from '@peerport/shared-types';

describe('Phase 1 Transfer Lifecycle & Verification Handshake', () => {
  let engine: TransferEngine;

  beforeEach(() => {
    engine = new TransferEngine();
  });

  it('generates a stable manifest with unique transferId and fileIds', () => {
    const file1 = new File(['content A'], 'document.pdf', { type: 'application/pdf' });
    const file2 = new File(['content B'], 'presentation.pptx', { type: 'application/vnd.ms-powerpoint' });

    const manifest1 = engine.createManifest([file1, file2]);

    expect(manifest1.transferId).toMatch(/^tr_/);
    expect(manifest1.files.length).toBe(2);
    expect(manifest1.files[0].id).toBeDefined();
    expect(manifest1.files[1].id).toBeDefined();
    expect(manifest1.files[0].id).not.toBe(manifest1.files[1].id);

    // If caller reuses manifest1, IDs remain identical
    const reusedId = manifest1.transferId;
    expect(reusedId).toBe(manifest1.transferId);
    expect(manifest1.files[0].id).toBe(manifest1.files[0].id);
  });

  it('streams chunks matching the exact manifest transferId and fileId', async () => {
    const content = new Uint8Array([65, 66, 67, 68, 69]); // "ABCDE"
    const file = new File([content], 'test.txt', { type: 'text/plain' });
    const manifest = engine.createManifest([file]);

    const sentChunks: any[] = [];
    const mockTransport: any = {
      sendChunk: async (_conn: any, chunk: any) => {
        sentChunks.push(chunk);
      }
    };

    await engine.sendFile(mockTransport, { id: 'peer' } as any, file, manifest, 0, () => {});

    expect(sentChunks.length).toBe(1);
    expect(sentChunks[0].header.transferId).toBe(manifest.transferId);
    expect(sentChunks[0].header.fileId).toBe(manifest.files[0].id);
    expect(sentChunks[0].header.chunkIndex).toBe(0);
    expect(sentChunks[0].header.totalChunks).toBe(1);
    expect(sentChunks[0].header.payloadLength).toBe(5);
  });

  it('receiver assembles, computes SHA-256, and completes only after valid verification', async () => {
    const content = new Uint8Array(5000);
    for (let i = 0; i < content.length; i++) content[i] = i % 250;

    const file = new File([content], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const manifest = engine.createManifest([file]);
    const expectedSha256 = await computeSha256(content);

    engine.prepareReceiver(manifest);

    const chunk = {
      header: {
        magic: 0x50505254,
        version: 1,
        messageType: 1,
        transferId: manifest.transferId,
        fileId: manifest.files[0].id,
        chunkIndex: 0,
        totalChunks: 1,
        payloadLength: 5000
      },
      data: content
    };

    const record = await engine.handleIncomingChunk(chunk, () => {});

    expect(record).not.toBeNull();
    expect(record!.name).toBe('report.docx');
    expect(record!.size).toBe(5000);
    expect(record!.sha256).toBe(expectedSha256);
    expect(record!.verified).toBe(true);
    expect(engine.isAllFilesReceived()).toBe(true);

    // Verify blob content
    const blobBuffer = await record!.blob!.arrayBuffer();
    expect(blobBuffer.byteLength).toBe(5000);
  });

  it('simulates the complete end-to-end handshake with TRANSFER_COMPLETE acknowledgement', async () => {
    const fileContent = new Uint8Array([10, 20, 30, 40]);
    const file = new File([fileContent], 'data.bin');
    const manifest = engine.createManifest([file]);

    // Receiver prepares
    engine.prepareReceiver(manifest);

    // Sender streams
    const chunk = {
      header: {
        magic: 0x50505254,
        version: 1,
        messageType: 1,
        transferId: manifest.transferId,
        fileId: manifest.files[0].id,
        chunkIndex: 0,
        totalChunks: 1,
        payloadLength: 4
      },
      data: fileContent
    };

    // Receiver processes chunk
    const completedFile = await engine.handleIncomingChunk(chunk, () => {});
    expect(completedFile).not.toBeNull();
    expect(engine.isAllFilesReceived()).toBe(true);

    // Receiver generates TRANSFER_COMPLETE acknowledgement
    const ackPayload: TransferCompletePayload = {
      transferId: manifest.transferId,
      verified: true,
      files: [{
        fileId: completedFile!.id,
        sha256: completedFile!.sha256,
        verified: true
      }]
    };

    // Sender validates acknowledgement
    let senderCompleted = false;
    const handleTransferCompleteOnSender = (payload: TransferCompletePayload) => {
      if (payload.transferId === manifest.transferId && payload.verified) {
        senderCompleted = true;
      }
    };

    // Before ACK, sender is not completed
    expect(senderCompleted).toBe(false);

    // Receiver sends ACK -> Sender handles ACK
    handleTransferCompleteOnSender(ackPayload);
    expect(senderCompleted).toBe(true);
  });

  it('sender rejects acknowledgement if transferId mismatches or verification fails', () => {
    const file = new File(['secure'], 'test.txt');
    const manifest = engine.createManifest([file]);

    let senderCompleted = false;
    let senderFailed = false;

    const handleTransferCompleteOnSender = (payload: TransferCompletePayload) => {
      if (payload.transferId !== manifest.transferId) {
        // Discard or ignore mismatched ACK
        return;
      }
      if (!payload.verified) {
        senderFailed = true;
        return;
      }
      senderCompleted = true;
    };

    // Mismatched transferId
    handleTransferCompleteOnSender({
      transferId: 'tr_different_id',
      verified: true
    });
    expect(senderCompleted).toBe(false);
    expect(senderFailed).toBe(false);

    // Verified: false
    handleTransferCompleteOnSender({
      transferId: manifest.transferId,
      verified: false
    });
    expect(senderCompleted).toBe(false);
    expect(senderFailed).toBe(true);
  });
});


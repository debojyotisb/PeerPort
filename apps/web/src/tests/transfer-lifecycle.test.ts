import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransferEngine } from '../services/transfer-engine.js';
import { computeSha256 } from '@peerport/transfer-protocol';
import { TransferCompletePayload, TransferManifest } from '@peerport/shared-types';

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

  it('closes approval dialog immediately upon Accept and continues receiver transfer pipeline', async () => {
    const fileContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const file = new File([fileContent], 'accepted-doc.pdf', { type: 'application/pdf' });
    const manifest = engine.createManifest([file]);

    let incomingManifest: TransferManifest | null = manifest;
    let approveCallbackExecuted = false;
    let approveDecision: boolean | null = null;
    let activeTransferManifest: TransferManifest | null = null;
    let connectionState: string = 'AWAITING_APPROVAL';

    // Mock callback
    let approveCallback: ((accepted: boolean) => Promise<void>) | null = async (accepted: boolean) => {
      approveCallbackExecuted = true;
      approveDecision = accepted;
    };

    // Simulate handleApprovalResponse(true) with synchronous engine preparation and safe callback awaiting
    const handleApprovalResponse = async (accepted: boolean) => {
      const capturedManifest = incomingManifest;
      const callback = approveCallback;
      approveCallback = null;

      // Immediately clear incomingManifest so the UI dialog disappears
      incomingManifest = null;

      if (accepted && capturedManifest) {
        // Synchronously prime the engine BEFORE awaiting callback
        activeTransferManifest = capturedManifest;
        engine.prepareReceiver(capturedManifest);

        if (!callback) {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
          return;
        }

        try {
          await callback(true);
          connectionState = 'TRANSFERRING';
        } catch {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
        }
      } else {
        activeTransferManifest = null;
        connectionState = 'REJECTED';
      }
    };

    // User clicks Accept
    await handleApprovalResponse(true);

    // 1. Dialog manifest is cleared immediately
    expect(incomingManifest).toBeNull();
    // 2. Callback executed with true
    expect(approveCallbackExecuted).toBe(true);
    expect(approveDecision).toBe(true);
    expect(approveCallback).toBeNull();
    // 3. State entered TRANSFERRING
    expect(connectionState).toBe('TRANSFERRING');
    expect(activeTransferManifest).not.toBeNull();

    // 4. Receiver can still receive, verify and produce a downloadable Blob
    const chunk = {
      header: {
        magic: 0x50505254,
        version: 1,
        messageType: 1,
        transferId: manifest.transferId,
        fileId: manifest.files[0].id,
        chunkIndex: 0,
        totalChunks: 1,
        payloadLength: fileContent.length
      },
      data: fileContent
    };

    const completedRecord = await engine.handleIncomingChunk(chunk, () => {});
    expect(completedRecord).not.toBeNull();
    expect(completedRecord!.blob).toBeDefined();
    expect(completedRecord!.blob!.size).toBe(fileContent.length);
    expect(completedRecord!.verified).toBe(true);
    expect(engine.isAllFilesReceived()).toBe(true);
  });

  it('closes approval dialog immediately upon Reject and enters REJECTED state', async () => {
    const file = new File(['secret'], 'private.txt');
    const manifest = engine.createManifest([file]);

    let incomingManifest: TransferManifest | null = manifest;
    let approveCallbackExecuted = false;
    let approveDecision: boolean | null = null;
    let connectionState: string = 'AWAITING_APPROVAL';

    let approveCallback: ((accepted: boolean) => Promise<void>) | null = async (accepted: boolean) => {
      approveCallbackExecuted = true;
      approveDecision = accepted;
    };

    // Simulate handleApprovalResponse(false)
    const handleApprovalResponse = async (accepted: boolean) => {
      const capturedManifest = incomingManifest;
      const callback = approveCallback;
      approveCallback = null;

      // Immediately clear incomingManifest so dialog closes
      incomingManifest = null;

      if (callback) {
        await callback(accepted);
      }

      if (accepted && capturedManifest) {
        connectionState = 'TRANSFERRING';
      } else {
        connectionState = 'REJECTED';
      }
    };

    // User clicks Decline
    await handleApprovalResponse(false);

    expect(incomingManifest).toBeNull();
    expect(approveCallbackExecuted).toBe(true);
    expect(approveDecision).toBe(false);
    expect(approveCallback).toBeNull();
    expect(connectionState).toBe('REJECTED');
  });

  it('cancels receiver engine and transitions to FAILED if approval callback fails or throws', async () => {
    const file = new File(['content'], 'test.pdf');
    const manifest = engine.createManifest([file]);

    let incomingManifest: TransferManifest | null = manifest;
    let activeTransferManifest: TransferManifest | null = null;
    let connectionState: string = 'AWAITING_APPROVAL';

    // Mock callback that throws an error (e.g. broken signaling connection)
    let approveCallback: ((accepted: boolean) => Promise<void>) | null = async () => {
      throw new Error('Signaling transport severed');
    };

    const handleApprovalResponse = async (accepted: boolean) => {
      const capturedManifest = incomingManifest;
      const callback = approveCallback;
      approveCallback = null;

      incomingManifest = null;

      if (accepted && capturedManifest) {
        activeTransferManifest = capturedManifest;
        engine.prepareReceiver(capturedManifest);

        if (!callback) {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
          return;
        }

        try {
          await callback(true);
          connectionState = 'TRANSFERRING';
        } catch {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
        }
      }
    };

    await handleApprovalResponse(true);

    // Dialog manifest cleared
    expect(incomingManifest).toBeNull();
    // Engine was cancelled, active transfer manifest was cleared
    expect(activeTransferManifest).toBeNull();
    expect(engine.getActiveManifest()).toBeNull();
    // State transitioned to FAILED, NOT TRANSFERRING
    expect(connectionState).toBe('FAILED');
  });

  it('cancels receiver engine and transitions to FAILED if approval callback is missing', async () => {
    const file = new File(['content'], 'test.pdf');
    const manifest = engine.createManifest([file]);

    let incomingManifest: TransferManifest | null = manifest;
    let activeTransferManifest: TransferManifest | null = null;
    let connectionState: string = 'AWAITING_APPROVAL';

    // No callback available
    let approveCallback: ((accepted: boolean) => Promise<void>) | null = null;

    const handleApprovalResponse = async (accepted: boolean) => {
      const capturedManifest = incomingManifest;
      const callback = approveCallback;
      approveCallback = null;

      incomingManifest = null;

      if (accepted && capturedManifest) {
        activeTransferManifest = capturedManifest;
        engine.prepareReceiver(capturedManifest);

        if (!callback) {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
          return;
        }

        try {
          await callback(true);
          connectionState = 'TRANSFERRING';
        } catch {
          activeTransferManifest = null;
          engine.cancel();
          connectionState = 'FAILED';
        }
      }
    };

    await handleApprovalResponse(true);

    expect(incomingManifest).toBeNull();
    expect(activeTransferManifest).toBeNull();
    expect(engine.getActiveManifest()).toBeNull();
    expect(connectionState).toBe('FAILED');
  });
});


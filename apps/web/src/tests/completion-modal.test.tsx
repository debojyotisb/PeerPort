import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CompletionModal } from '../components/CompletionModal.js';
import { ApprovalDialog } from '../components/ApprovalDialog.js';
import { CompletedFileRecord } from '../state/transfer-store.js';
import { TransferManifest } from '@peerport/shared-types';

describe('Phase 1 CompletionModal Role Segregation and Controls', () => {
  const dummyFile1: CompletedFileRecord = {
    id: 'f_001',
    name: 'vacation.mp4',
    size: 15_000_000,
    mimeType: 'video/mp4',
    sha256: 'a1b2c3d4e5f6',
    blob: new Blob(['dummy video content'], { type: 'video/mp4' }),
    blobUrl: 'blob:http://localhost/dummy-1',
    verified: true
  };

  const dummyFile2: CompletedFileRecord = {
    id: 'f_002',
    name: 'notes.pdf',
    size: 250_000,
    mimeType: 'application/pdf',
    sha256: 'f6e5d4c3b2a1',
    blob: new Blob(['dummy pdf content'], { type: 'application/pdf' }),
    blobUrl: 'blob:http://localhost/dummy-2',
    verified: true
  };

  it('renders Delivered badge and ZERO Save buttons when role is SENDER', () => {
    const html = renderToString(
      <CompletionModal
        isOpen={true}
        role="SENDER"
        completedFiles={[dummyFile1]}
        onReset={() => {}}
      />
    );

    expect(html).toContain('Sent Successfully!');
    expect(html).toContain('Delivered');
    // Ensure no Save button appears anywhere
    expect(html).not.toMatch(/>\s*Save\s*</);
    expect(html).not.toContain('Save All');
  });

  it('never displays Save All button for SENDER even with multiple completed files', () => {
    const html = renderToString(
      <CompletionModal
        isOpen={true}
        role="SENDER"
        completedFiles={[dummyFile1, dummyFile2]}
        onReset={() => {}}
      />
    );

    expect(html).toContain('Sent Successfully!');
    expect(html).toContain('2 files');
    expect(html).toContain('Delivered');
    expect(html).not.toMatch(/>\s*Save\s*</);
    expect(html).not.toContain('Save All');
  });

  it('renders explicit Save buttons when role is RECEIVER and files have blobs', () => {
    const html = renderToString(
      <CompletionModal
        isOpen={true}
        role="RECEIVER"
        completedFiles={[dummyFile1]}
        onReset={() => {}}
      />
    );

    expect(html).toContain('Files Received Successfully!');
    expect(html).toContain('SHA-256 Checksum Verified');
    expect(html).toMatch(/>\s*Save\s*</);
    expect(html).not.toContain('Delivered');
  });

  it('renders Save All button when role is RECEIVER and there are multiple files', () => {
    const html = renderToString(
      <CompletionModal
        isOpen={true}
        role="RECEIVER"
        completedFiles={[dummyFile1, dummyFile2]}
        onReset={() => {}}
      />
    );

    expect(html).toContain('Files Received Successfully!');
    expect(html).toContain('Save All (2 files)');
    expect(html).toMatch(/>\s*Save\s*</);
    expect(html).not.toContain('Delivered');
  });

  it('never displays Save or Save All buttons when role is null', () => {
    const html = renderToString(
      <CompletionModal
        isOpen={true}
        role={null}
        completedFiles={[dummyFile1, dummyFile2]}
        onReset={() => {}}
      />
    );

    expect(html).toContain('Transfer Completed!');
    expect(html).not.toMatch(/>\s*Save\s*</);
    expect(html).not.toContain('Save All');
    expect(html).not.toContain('Delivered');
  });
});

describe('Phase 1 ApprovalDialog Visibility & Lifecycle', () => {
  const sampleManifest: TransferManifest = {
    transferId: 'tr_test_12345678',
    sender: {
      deviceId: 'dev_phone_1',
      deviceName: 'Pixel 8',
      platform: 'android'
    },
    files: [
      { id: 'f_1', name: 'sample.mp4', size: 1048576, mimeType: 'video/mp4' }
    ],
    totalBytes: 1048576,
    totalFiles: 1,
    timestamp: Date.now(),
    token: 'tok_secret_123'
  };

  it('renders approval dialog when manifest is present', () => {
    const html = renderToString(
      <ApprovalDialog
        manifest={sampleManifest}
        onApprove={() => {}}
      />
    );

    expect(html).toContain('Incoming File Request');
    expect(html).toContain('Pixel 8');
    expect(html).toContain('sample.mp4');
    expect(html).toContain('Accept &amp; Receive');
    expect(html).toContain('Decline');
  });

  it('renders nothing when manifest is null (dialog is closed)', () => {
    const html = renderToString(
      <ApprovalDialog
        manifest={null}
        onApprove={() => {}}
      />
    );

    expect(html).toBe('');
  });
});


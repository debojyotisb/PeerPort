import { describe, it, expect } from 'vitest';
import {
  TransferManifestSchema,
  SignalingMessageSchema,
  DeviceInfoSchema
} from '../src/schemas.js';

describe('Zod Protocol Schemas Validation', () => {
  it('validates a valid TransferManifest', () => {
    const validManifest = {
      transferId: 'tr_test_12345',
      sender: {
        deviceId: 'dev_abc',
        deviceName: 'Pixel 8',
        platform: 'android'
      },
      files: [
        {
          id: 'file_1',
          name: 'vacation.jpg',
          size: 2048576,
          mimeType: 'image/jpeg'
        }
      ],
      totalBytes: 2048576,
      totalFiles: 1,
      timestamp: Date.now(),
      token: 'secure_auth_token_123'
    };

    const parsed = TransferManifestSchema.safeParse(validManifest);
    expect(parsed.success).toBe(true);
  });

  it('rejects manifests with empty file lists', () => {
    const invalidManifest = {
      transferId: 'tr_empty',
      sender: { deviceId: 'dev_1', deviceName: 'iPhone', platform: 'ios' },
      files: [],
      totalBytes: 0,
      totalFiles: 0,
      timestamp: Date.now(),
      token: 'short_token'
    };

    const parsed = TransferManifestSchema.safeParse(invalidManifest);
    expect(parsed.success).toBe(false);
  });

  it('validates and accepts proper signaling messages', () => {
    const validSignaling = {
      type: 'JOIN_ROOM',
      roomId: 'PP-1234',
      senderId: 'dev_01',
      payload: { passcode: '1234' },
      timestamp: Date.now()
    };

    const parsed = SignalingMessageSchema.safeParse(validSignaling);
    expect(parsed.success).toBe(true);
  });

  it('rejects signaling messages with invalid types or missing room IDs', () => {
    const badSignaling = {
      type: 'UNSUPPORTED_HACK',
      roomId: '',
      senderId: 'dev_01',
      payload: {},
      timestamp: Date.now()
    };

    const parsed = SignalingMessageSchema.safeParse(badSignaling);
    expect(parsed.success).toBe(false);
  });
});

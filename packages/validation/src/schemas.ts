import { z } from 'zod';
import { sanitizeFileName } from './sanitizer.js';

export const DevicePlatformSchema = z.enum([
  'android',
  'ios',
  'windows',
  'macos',
  'linux',
  'browser'
]);

export const DeviceInfoSchema = z.object({
  deviceId: z.string().min(1).max(64),
  deviceName: z.string().min(1).max(64),
  platform: DevicePlatformSchema,
  browser: z.string().max(64).optional(),
  isNativeCompanion: z.boolean().optional()
});

export const FileMetadataSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(255).transform(sanitizeFileName),
  size: z.number().int().nonnegative().max(50 * 1024 * 1024 * 1024), // Max 50 GB
  mimeType: z.string().max(128).default('application/octet-stream'),
  lastModified: z.number().int().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
});

export const TransferManifestSchema = z.object({
  transferId: z.string().min(1).max(64),
  sender: z.object({
    deviceId: z.string().min(1).max(64),
    deviceName: z.string().min(1).max(64),
    platform: z.string().min(1).max(32)
  }),
  files: z.array(FileMetadataSchema).min(1).max(500),
  totalBytes: z.number().int().nonnegative(),
  totalFiles: z.number().int().positive().max(500),
  timestamp: z.number().int().positive(),
  token: z.string().min(8).max(128)
});

export const TransferResponseSchema = z.object({
  transferId: z.string().min(1).max(64),
  accepted: z.boolean(),
  reason: z.string().max(256).optional(),
  timestamp: z.number().int().positive()
});

export const SignalingMessageTypeSchema = z.enum([
  'JOIN_ROOM',
  'ROOM_JOINED',
  'PEER_JOINED',
  'PEER_LEFT',
  'OFFER',
  'ANSWER',
  'ICE_CANDIDATE',
  'TRANSFER_OFFER',
  'TRANSFER_ACCEPT',
  'TRANSFER_REJECT',
  'TRANSFER_CANCEL',
  'TRANSFER_COMPLETE',
  'HEARTBEAT',
  'ERROR'
]);

export const SignalingMessageSchema = z.object({
  type: SignalingMessageTypeSchema,
  roomId: z.string().min(3).max(32),
  senderId: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64).optional(),
  payload: z.unknown(),
  timestamp: z.number().int().positive()
});

import { describe, it, expect } from 'vitest';
import { RoomManager } from '../src/room-manager.js';
import { RateLimiter } from '../src/rate-limiter.js';
import { DeviceInfo } from '@peerport/shared-types';

describe('Signaling Server Logic & Security', () => {
  const dummyDevice: DeviceInfo = {
    deviceId: 'dev_1',
    deviceName: 'Test Phone',
    platform: 'android'
  };

  it('allows joining an empty room and creates it with TTL', () => {
    const manager = new RoomManager(2, 300);
    const mockSocket: any = { send: () => {}, close: () => {} };

    const result = manager.joinRoom('room_1', 'peer_a', mockSocket, dummyDevice);
    expect(result.success).toBe(true);
    expect(result.room).toBeDefined();
    expect(result.room?.participants.size).toBe(1);
  });

  it('enforces maximum connection limit per room (max 2 participants)', () => {
    const manager = new RoomManager(2, 300);
    const mockSocket: any = { send: () => {}, close: () => {} };

    manager.joinRoom('room_1', 'peer_1', mockSocket, dummyDevice);
    manager.joinRoom('room_1', 'peer_2', mockSocket, { ...dummyDevice, deviceId: 'dev_2' });

    const thirdPeer = manager.joinRoom('room_1', 'peer_3', mockSocket, { ...dummyDevice, deviceId: 'dev_3' });
    expect(thirdPeer.success).toBe(false);
    expect(thirdPeer.error).toContain('Room is full');
  });

  it('rejects unauthorized participants with invalid passcodes', () => {
    const manager = new RoomManager(2, 300);
    const mockSocket: any = { send: () => {}, close: () => {} };

    manager.joinRoom('private_room', 'peer_host', mockSocket, dummyDevice, 'secret_pin_9999');

    const unauthorized = manager.joinRoom('private_room', 'peer_attacker', mockSocket, dummyDevice, 'wrong_pin');
    expect(unauthorized.success).toBe(false);
    expect(unauthorized.error).toContain('Invalid room passcode');
  });

  it('rate limiter throttles excessive requests beyond threshold', () => {
    const limiter = new RateLimiter(5, 60_000); // 5 max requests
    const ip = '192.168.1.50';

    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed(ip)).toBe(true);
    }

    // 6th request is blocked
    expect(limiter.isAllowed(ip)).toBe(false);
  });
});


import { WebSocket } from 'ws';
import { DeviceInfo } from '@peerport/shared-types';

export interface RoomParticipant {
  id: string;
  socket: WebSocket;
  device: DeviceInfo;
  joinedAt: number;
}

export interface Room {
  id: string;
  participants: Map<string, RoomParticipant>;
  createdAt: number;
  lastActivityAt: number;
  passcode?: string;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private readonly maxConnectionsPerRoom: number;
  private readonly roomTtlMs: number;

  constructor(maxConnectionsPerRoom = 2, roomTtlSeconds = 300) {
    this.maxConnectionsPerRoom = maxConnectionsPerRoom;
    this.roomTtlMs = roomTtlSeconds * 1000;

    // Prune stale rooms every 30 seconds
    setInterval(() => this.pruneStaleRooms(), 30_000).unref();
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  joinRoom(roomId: string, participantId: string, socket: WebSocket, device: DeviceInfo, passcode?: string): { success: boolean; error?: string; room?: Room } {
    let room = this.rooms.get(roomId);

    if (!room) {
      room = {
        id: roomId,
        participants: new Map(),
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        passcode
      };
      this.rooms.set(roomId, room);
    }

    if (room.passcode && room.passcode !== passcode) {
      return { success: false, error: 'Invalid room passcode' };
    }

    if (room.participants.size >= this.maxConnectionsPerRoom && !room.participants.has(participantId)) {
      return { success: false, error: 'Room is full (max 2 participants)' };
    }

    room.participants.set(participantId, {
      id: participantId,
      socket,
      device,
      joinedAt: Date.now()
    });
    room.lastActivityAt = Date.now();

    return { success: true, room };
  }

  leaveRoom(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.participants.delete(participantId);
    room.lastActivityAt = Date.now();

    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  removeParticipantFromAllRooms(participantId: string): { roomId: string; remainingParticipants: RoomParticipant[] }[] {
    const affected: { roomId: string; remainingParticipants: RoomParticipant[] }[] = [];

    for (const [roomId, room] of this.rooms.entries()) {
      if (room.participants.has(participantId)) {
        room.participants.delete(participantId);
        room.lastActivityAt = Date.now();

        const remaining = Array.from(room.participants.values());
        affected.push({ roomId, remainingParticipants: remaining });

        if (room.participants.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }

    return affected;
  }

  touchRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.lastActivityAt = Date.now();
    }
  }

  private pruneStaleRooms(): void {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.lastActivityAt > this.roomTtlMs) {
        // Notify and close remaining sockets
        for (const p of room.participants.values()) {
          try {
            p.socket.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Room expired due to inactivity' } }));
            p.socket.close();
          } catch {
            // Ignore socket closure errors
          }
        }
        this.rooms.delete(roomId);
      }
    }
  }
}


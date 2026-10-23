import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SignalingMessage, SignalingMessageSchema } from '@peerport/validation';
import { RoomManager } from './room-manager.js';
import { RateLimiter } from './rate-limiter.js';

export interface SignalingServerOptions {
  port?: number;
  allowedOrigins?: string[];
  maxPayloadBytes?: number;
}

export function createSignalingServer(options: SignalingServerOptions = {}) {
  const port = options.port || parseInt(process.env.PORT || '8088', 10);
  const maxPayloadBytes = options.maxPayloadBytes || 64 * 1024; // 64 KiB max signaling frame (no file data!)
  
  const roomManager = new RoomManager();
  const rateLimiter = new RateLimiter(120, 60_000); // 120 msgs/min

  const httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'peerport-signaling-server',
        timestamp: Date.now()
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: maxPayloadBytes
  });

  wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
    const ip = req.socket.remoteAddress || 'unknown';
    let currentParticipantId: string | null = null;
    let currentRoomId: string | null = null;

    socket.on('message', (data: Buffer | string) => {
      if (!rateLimiter.isAllowed(ip)) {
        sendError(socket, 'Rate limit exceeded. Please slow down.');
        return;
      }

      try {
        const rawString = typeof data === 'string' ? data : data.toString('utf-8');
        const parsedJson = JSON.parse(rawString);

        // Validate structure with Zod
        const validation = SignalingMessageSchema.safeParse(parsedJson);
        if (!validation.success) {
          sendError(socket, `Malformed message: ${validation.error.message}`);
          return;
        }

        const msg = validation.data;
        handleSignalingMessage(socket, msg);
      } catch (err: unknown) {
        sendError(socket, 'Invalid JSON payload');
      }
    });

    socket.on('close', () => {
      if (currentParticipantId) {
        const affectedRooms = roomManager.removeParticipantFromAllRooms(currentParticipantId);
        for (const affected of affectedRooms) {
          for (const remaining of affected.remainingParticipants) {
            sendJson(remaining.socket, {
              type: 'PEER_LEFT',
              roomId: affected.roomId,
              senderId: currentParticipantId,
              payload: { peerId: currentParticipantId },
              timestamp: Date.now()
            });
          }
        }
      }
    });

    function handleSignalingMessage(ws: WebSocket, msg: SignalingMessage) {
      roomManager.touchRoom(msg.roomId);

      switch (msg.type) {
        case 'JOIN_ROOM': {
          currentParticipantId = msg.senderId;
          currentRoomId = msg.roomId;
          const payload = msg.payload as any;
          const device = payload?.device || {
            deviceId: msg.senderId,
            deviceName: 'Unknown Device',
            platform: 'browser'
          };

          const joinResult = roomManager.joinRoom(msg.roomId, msg.senderId, ws, device, payload?.passcode);

          if (!joinResult.success || !joinResult.room) {
            sendError(ws, joinResult.error || 'Failed to join room');
            return;
          }

          // Gather existing peers
          const existingPeers = Array.from(joinResult.room.participants.values())
            .filter((p) => p.id !== msg.senderId)
            .map((p) => p.device);

          // Confirm to joiner
          sendJson(ws, {
            type: 'ROOM_JOINED',
            roomId: msg.roomId,
            senderId: 'server',
            payload: {
              roomId: msg.roomId,
              selfId: msg.senderId,
              existingPeers,
              expiresAt: joinResult.room.lastActivityAt + 300_000
            },
            timestamp: Date.now()
          });

          // Notify existing peers
          for (const [id, participant] of joinResult.room.participants.entries()) {
            if (id !== msg.senderId) {
              sendJson(participant.socket, {
                type: 'PEER_JOINED',
                roomId: msg.roomId,
                senderId: msg.senderId,
                payload: { device },
                timestamp: Date.now()
              });
            }
          }
          break;
        }

        case 'OFFER':
        case 'ANSWER':
        case 'ICE_CANDIDATE':
        case 'TRANSFER_OFFER':
        case 'TRANSFER_ACCEPT':
        case 'TRANSFER_REJECT':
        case 'TRANSFER_CANCEL':
        case 'TRANSFER_COMPLETE': {
          const room = roomManager.getRoom(msg.roomId);
          if (!room) {
            sendError(ws, `Room ${msg.roomId} not found or expired`);
            return;
          }

          // Forward to specific target or all other participants
          if (msg.targetId) {
            const target = room.participants.get(msg.targetId);
            if (target) {
              sendJson(target.socket, msg);
            } else {
              sendError(ws, `Target peer ${msg.targetId} not in room`);
            }
          } else {
            for (const [id, participant] of room.participants.entries()) {
              if (id !== msg.senderId) {
                sendJson(participant.socket, msg);
              }
            }
          }
          break;
        }

        case 'HEARTBEAT': {
          sendJson(ws, {
            type: 'HEARTBEAT',
            roomId: msg.roomId,
            senderId: 'server',
            payload: { ok: true },
            timestamp: Date.now()
          });
          break;
        }

        default:
          sendError(ws, `Unsupported message type: ${msg.type}`);
      }
    }
  });

  function sendJson(socket: WebSocket, data: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  function sendError(socket: WebSocket, message: string): void {
    sendJson(socket, {
      type: 'ERROR',
      roomId: '',
      senderId: 'server',
      payload: { message },
      timestamp: Date.now()
    });
  }

  return {
    httpServer,
    wss,
    listen: (customPort?: number) => {
      const p = customPort || port;
      return new Promise<void>((resolve) => {
        httpServer.listen(p, () => {
          console.log(`[PeerPort Signaling Server] listening on port ${p}`);
          resolve();
        });
      });
    },
    close: () => {
      return new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    }
  };
}


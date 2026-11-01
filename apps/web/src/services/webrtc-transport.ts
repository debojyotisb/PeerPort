import {
  PeerTransport,
  PeerConnection,
  DiscoveredPeer,
  ConnectionState,
  TransportMode,
  TransferManifest,
  TransferResponse,
  BinaryChunk,
  TransferProgress,
  TransferCompletePayload,
  SignalingMessage
} from '@peerport/shared-types';
import { encodeChunk, decodeChunk, ChunkMessageType, DEFAULT_FLOW_CONFIG } from '@peerport/transfer-protocol';
import { getLocalDeviceInfo } from './device-info.js';

export class WebRtcTransport implements PeerTransport {
  readonly mode: TransportMode = 'WEBRTC_P2P';
  connectionState: ConnectionState = 'IDLE';

  private ws: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private currentRoomId: string | null = null;
  private targetPeerId: string | null = null;
  private signalingUrl: string;
  private iceServers: RTCIceServer[];
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private lastProcessedOfferId: string | null = null;
  private lastProcessedResponseId: string | null = null;
  private lastProcessedCompleteId: string | null = null;

  private listeners = {
    onPeerFound: new Set<(peer: DiscoveredPeer) => void>(),
    onPeerLost: new Set<(peerId: string) => void>(),
    onConnectionStateChange: new Set<(state: ConnectionState, reason?: string) => void>(),
    onTransferRequest: new Set<(manifest: TransferManifest, approve: (accepted: boolean) => Promise<void>) => void>(),
    onTransferResponse: new Set<(response: TransferResponse) => void>(),
    onProgress: new Set<(progress: TransferProgress) => void>(),
    onTransferComplete: new Set<(payload: TransferCompletePayload) => void>(),
    onError: new Set<(error: Error) => void>(),
    onChunkReceived: new Set<(chunk: BinaryChunk) => void>(),
    onChannelReady: new Set<() => void>()
  };

  constructor(signalingUrl?: string, iceServers?: RTCIceServer[]) {
    this.signalingUrl =
      signalingUrl ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SIGNALING_SERVER_URL) ||
      `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8088`;

    this.iceServers = iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
  }

  async initialize(): Promise<void> {
    this.updateState('IDLE');
  }

  subscribe<K extends keyof typeof this.listeners>(event: K, handler: any): () => void {
    const set = this.listeners[event] as Set<any>;
    set.add(handler);
    return () => set.delete(handler);
  }

  private updateState(state: ConnectionState, reason?: string) {
    this.connectionState = state;
    for (const listener of this.listeners.onConnectionStateChange) {
      listener(state, reason);
    }
  }

  async joinRoom(roomId: string, passcode?: string): Promise<void> {
    this.currentRoomId = roomId;
    this.updateState('CONNECTING');

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.signalingUrl);
      } catch (err: any) {
        this.updateState('FAILED', err.message);
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        const localDevice = getLocalDeviceInfo();
        this.sendSignal({
          type: 'JOIN_ROOM',
          roomId,
          senderId: localDevice.deviceId,
          payload: { device: localDevice, passcode },
          timestamp: Date.now()
        });
        resolve();
      };

      this.ws.onerror = (err) => {
        this.updateState('FAILED', 'Signaling service connection error');
        for (const l of this.listeners.onError) l(new Error('Signaling server unavailable'));
        reject(err);
      };

      this.ws.onclose = () => {
        // If DataChannel is already established and open, losing signaling WebSocket does not disconnect P2P transfer!
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          console.warn('Signaling WebSocket closed, but WebRTC DataChannel remains active.');
          return;
        }

        if (this.connectionState !== 'COMPLETED' && this.connectionState !== 'IDLE') {
          this.updateState('DISCONNECTED', 'Signaling connection closed');
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage<any>;
          this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('Failed to parse signaling message:', err);
        }
      };
    });
  }

  async discoverPeers(): Promise<void> {
    this.updateState('DISCOVERING');
  }

  async stopDiscovery(): Promise<void> {
    if (this.connectionState === 'DISCOVERING') {
      this.updateState('IDLE');
    }
  }

  async connect(peerId: string): Promise<PeerConnection> {
    this.targetPeerId = peerId;
    this.updateState('CONNECTING');

    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.setupPeerConnectionEvents();

    // Use reliable ordered DataChannel for accurate chunk transmission
    this.dataChannel = this.peerConnection.createDataChannel('peerport-data', {
      ordered: true
    });
    this.setupDataChannelEvents(this.dataChannel);

    // Create and dispatch SDP Offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const localDevice = getLocalDeviceInfo();
    this.sendSignal({
      type: 'OFFER',
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: peerId,
      payload: { sdp: offer },
      timestamp: Date.now()
    });

    return {
      id: peerId,
      peer: {
        id: peerId,
        device: { deviceId: peerId, deviceName: 'Remote Peer', platform: 'browser' },
        mode: 'WEBRTC_P2P',
        lastSeen: Date.now()
      },
      mode: 'WEBRTC_P2P',
      state: this.connectionState,
      send: async (data) => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          this.dataChannel.send(data as any);
        }
      },
      close: async () => this.close()
    };
  }

  async sendTransferRequest(connection: PeerConnection, manifest: TransferManifest): Promise<void> {
    this.updateState('AWAITING_APPROVAL');
    const localDevice = getLocalDeviceInfo();

    this.sendControlMessage({
      type: 'TRANSFER_OFFER',
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: this.targetPeerId || connection.id,
      payload: { manifest },
      timestamp: Date.now()
    });
  }

  async respondTransferRequest(connection: PeerConnection, transferId: string, accepted: boolean): Promise<void> {
    const localDevice = getLocalDeviceInfo();
    const type = accepted ? 'TRANSFER_ACCEPT' : 'TRANSFER_REJECT';

    this.sendControlMessage({
      type,
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: this.targetPeerId || connection.id,
      payload: { transferId, accepted, timestamp: Date.now() },
      timestamp: Date.now()
    });

    if (accepted) {
      this.updateState('TRANSFERRING');
    } else {
      this.updateState('REJECTED');
    }
  }

  async sendChunk(connection: PeerConnection, chunk: BinaryChunk): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('WebRTC DataChannel is not open');
    }

    // Backpressure flow control: wait if buffer exceeds highWaterMark
    if (this.dataChannel.bufferedAmount > DEFAULT_FLOW_CONFIG.highWaterMark) {
      await new Promise<void>((resolve) => {
        if (!this.dataChannel) return resolve();
        this.dataChannel.bufferedAmountLowThreshold = DEFAULT_FLOW_CONFIG.lowWaterMark;
        this.dataChannel.onbufferedamountlow = () => {
          if (this.dataChannel) this.dataChannel.onbufferedamountlow = null;
          resolve();
        };
      });
    }

    const encoded = encodeChunk(chunk.header, chunk.data);
    this.dataChannel.send(encoded as any);
  }

  async cancelTransfer(connection: PeerConnection, transferId: string): Promise<void> {
    const localDevice = getLocalDeviceInfo();
    this.sendControlMessage({
      type: 'TRANSFER_CANCEL',
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: this.targetPeerId || connection.id,
      payload: { transferId },
      timestamp: Date.now()
    });
    this.updateState('CANCELLED');
  }

  async sendTransferComplete(connection: PeerConnection, payload: TransferCompletePayload): Promise<void> {
    this.updateState('COMPLETED');
    const localDevice = getLocalDeviceInfo();
    this.sendControlMessage({
      type: 'TRANSFER_COMPLETE',
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: this.targetPeerId || connection.id,
      payload,
      timestamp: Date.now()
    });
  }

  setCompleted(): void {
    this.updateState('COMPLETED');
  }

  clearListeners(): void {
    for (const key of Object.keys(this.listeners) as (keyof typeof this.listeners)[]) {
      this.listeners[key].clear();
    }
  }

  async closeConnection(connection: PeerConnection): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.pendingIceCandidates = [];
    this.lastProcessedOfferId = null;
    this.lastProcessedResponseId = null;
    this.lastProcessedCompleteId = null;
    this.updateState('IDLE');
  }

  private sendSignal(msg: SignalingMessage<any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendControlMessage(msg: SignalingMessage<any>) {
    const raw = JSON.stringify(msg);

    // 1. If WebRTC DataChannel is open, dispatch control message directly peer-to-peer!
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(raw);
      } catch (dcErr) {
        console.warn('Failed to send control frame over DataChannel:', dcErr);
      }
    }

    // 2. Also send over WebSocket signaling as fallback/dual-delivery if active
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
      } catch (wsErr) {
        console.warn('Failed to send signal over WebSocket:', wsErr);
      }
    }
  }

  private setupPeerConnectionEvents() {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const localDevice = getLocalDeviceInfo();
        this.sendSignal({
          type: 'ICE_CANDIDATE',
          roomId: this.currentRoomId || 'default',
          senderId: localDevice.deviceId,
          targetId: this.targetPeerId || undefined,
          payload: { candidate: event.candidate.toJSON() },
          timestamp: Date.now()
        });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannelEvents(this.dataChannel);
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'connected') {
        // Direct peer connection established
      } else if (state === 'failed' || state === 'disconnected') {
        // Guard: Never overwrite COMPLETED state if transfer was already received & verified!
        if (this.connectionState !== 'COMPLETED') {
          this.updateState('DISCONNECTED', `WebRTC state: ${state}`);
        }
      }
    };
  }

  private setupDataChannelEvents(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      for (const listener of this.listeners.onChannelReady) {
        listener();
      }
    };

    channel.onclose = () => {
      if (this.connectionState === 'TRANSFERRING') {
        this.updateState('DISCONNECTED', 'Data channel closed');
      }
    };

    channel.onerror = (err) => {
      console.error('DataChannel error:', err);
      for (const listener of this.listeners.onError) {
        listener(new Error('DataChannel error'));
      }
    };

    channel.onmessage = (event) => {
      // Direct DataChannel control signaling (works without WebSocket or internet)
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage<any>;
          this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('Failed to parse control frame on DataChannel:', err);
        }
        return;
      }

      try {
        const decoded = decodeChunk(event.data);
        if (decoded.header.messageType === ChunkMessageType.DATA) {
          for (const listener of this.listeners.onChunkReceived) {
            listener(decoded);
          }
        }
      } catch (err) {
        console.error('Error decoding chunk over DataChannel:', err);
      }
    };
  }

  private async drainPendingIceCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;

    while (this.pendingIceCandidates.length > 0) {
      const candidateInit = this.pendingIceCandidates.shift();
      if (candidateInit) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          console.warn('Failed to add queued ICE candidate:', err);
        }
      }
    }
  }

  private async handleSignalingMessage(msg: SignalingMessage<any>) {
    const localDevice = getLocalDeviceInfo();

    switch (msg.type) {
      case 'ROOM_JOINED': {
        const payload = msg.payload as any;
        if (payload?.existingPeers?.length > 0) {
          const peer = payload.existingPeers[0];
          this.targetPeerId = peer.deviceId;
          for (const l of this.listeners.onPeerFound) {
            l({
              id: peer.deviceId,
              device: peer,
              mode: 'WEBRTC_P2P',
              lastSeen: Date.now()
            });
          }
        }
        break;
      }

      case 'PEER_JOINED': {
        const payload = msg.payload as any;
        const peer = payload?.device;
        if (peer) {
          this.targetPeerId = peer.deviceId;
          for (const l of this.listeners.onPeerFound) {
            l({
              id: peer.deviceId,
              device: peer,
              mode: 'WEBRTC_P2P',
              lastSeen: Date.now()
            });
          }
        }
        break;
      }

      case 'PEER_LEFT': {
        if (this.targetPeerId === msg.senderId) {
          this.targetPeerId = null;
          this.updateState('DISCONNECTED', 'Peer left the session');
        }
        break;
      }

      case 'OFFER': {
        this.targetPeerId = msg.senderId;
        this.updateState('CONNECTING');
        this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
        this.setupPeerConnectionEvents();

        const payload = msg.payload as any;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await this.drainPendingIceCandidates();

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        this.sendSignal({
          type: 'ANSWER',
          roomId: this.currentRoomId || 'default',
          senderId: localDevice.deviceId,
          targetId: msg.senderId,
          payload: { sdp: answer },
          timestamp: Date.now()
        });
        break;
      }

      case 'ANSWER': {
        if (this.peerConnection) {
          const payload = msg.payload as any;
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await this.drainPendingIceCandidates();
        }
        break;
      }

      case 'ICE_CANDIDATE': {
        const payload = msg.payload as any;
        if (payload?.candidate) {
          if (this.peerConnection && this.peerConnection.remoteDescription) {
            try {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (err) {
              console.warn('Error adding ICE candidate directly:', err);
            }
          } else {
            // Queue candidate until setRemoteDescription completes
            this.pendingIceCandidates.push(payload.candidate);
          }
        }
        break;
      }

      case 'TRANSFER_OFFER': {
        const payload = msg.payload as any;
        const manifest = payload.manifest as TransferManifest;

        // Deduplicate offer if delivered by both DataChannel and WebSocket
        if (this.lastProcessedOfferId === manifest.transferId) break;
        this.lastProcessedOfferId = manifest.transferId;

        this.updateState('AWAITING_APPROVAL');

        for (const l of this.listeners.onTransferRequest) {
          l(manifest, async (accepted: boolean) => {
            await this.respondTransferRequest(
              { id: msg.senderId } as any,
              manifest.transferId,
              accepted
            );
          });
        }
        break;
      }

      case 'TRANSFER_ACCEPT': {
        const payload = msg.payload as any;

        // Deduplicate accept if delivered by both DataChannel and WebSocket
        if (this.lastProcessedResponseId === payload.transferId) break;
        this.lastProcessedResponseId = payload.transferId;

        this.updateState('TRANSFERRING');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: payload.transferId,
            accepted: true,
            timestamp: Date.now()
          });
        }
        break;
      }

      case 'TRANSFER_REJECT': {
        const payload = msg.payload as any;

        if (this.lastProcessedResponseId === payload.transferId) break;
        this.lastProcessedResponseId = payload.transferId;

        this.updateState('REJECTED');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: payload.transferId,
            accepted: false,
            reason: payload.reason,
            timestamp: Date.now()
          });
        }
        break;
      }

      case 'TRANSFER_CANCEL': {
        this.updateState('CANCELLED');
        break;
      }

      case 'TRANSFER_COMPLETE': {
        const payload = msg.payload as TransferCompletePayload;

        // Deduplicate completion ack if delivered by both DataChannel and WebSocket
        if (this.lastProcessedCompleteId === payload.transferId) break;
        this.lastProcessedCompleteId = payload.transferId;

        this.updateState('COMPLETED');
        for (const l of this.listeners.onTransferComplete) {
          l(payload);
        }
        break;
      }

      case 'ERROR': {
        const payload = msg.payload as any;
        this.updateState('FAILED', payload?.message);
        break;
      }
    }
  }
}

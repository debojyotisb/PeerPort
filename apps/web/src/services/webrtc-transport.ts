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

  private listeners = {
    onPeerFound: new Set<(peer: DiscoveredPeer) => void>(),
    onPeerLost: new Set<(peerId: string) => void>(),
    onConnectionStateChange: new Set<(state: ConnectionState, reason?: string) => void>(),
    onTransferRequest: new Set<(manifest: TransferManifest, approve: (accepted: boolean) => Promise<void>) => void>(),
    onTransferResponse: new Set<(response: TransferResponse) => void>(),
    onProgress: new Set<(progress: TransferProgress) => void>(),
    onTransferComplete: new Set<(fileId: string, sha256: string) => void>(),
    onError: new Set<(error: Error) => void>()
  };

  constructor(signalingUrl?: string, iceServers?: RTCIceServer[]) {
    // Default to configured signaling url or local fallback
    this.signalingUrl =
      signalingUrl ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_SERVER_URL) ||
      `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8088`;

    this.iceServers = iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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
        this.updateState('FAILED', 'Signaling server connection error');
        for (const l of this.listeners.onError) l(new Error('Signaling server unavailable'));
        reject(err);
      };

      this.ws.onclose = () => {
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

    // Create reliable unordered DataChannel for binary chunks
    this.dataChannel = this.peerConnection.createDataChannel('peerport-data', {
      ordered: false,
      maxRetransmits: 30
    });
    this.setupDataChannelEvents(this.dataChannel);

    // Create and send SDP Offer
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

    this.sendSignal({
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

    this.sendSignal({
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
    this.sendSignal({
      type: 'TRANSFER_CANCEL',
      roomId: this.currentRoomId || 'default',
      senderId: localDevice.deviceId,
      targetId: this.targetPeerId || connection.id,
      payload: { transferId },
      timestamp: Date.now()
    });
    this.updateState('CANCELLED');
  }

  async closeConnection(connection: PeerConnection): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateState('IDLE');
  }

  private sendSignal(msg: SignalingMessage<any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
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
          payload: { candidate: event.candidate },
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
      if (state === 'failed' || state === 'disconnected') {
        this.updateState('DISCONNECTED', `WebRTC state: ${state}`);
      }
    };
  }

  private setupDataChannelEvents(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      if (this.connectionState === 'CONNECTING') {
        this.updateState('IDLE'); // Ready for transfer request
      }
    };

    channel.onclose = () => {
      if (this.connectionState === 'TRANSFERRING') {
        this.updateState('DISCONNECTED', 'Data channel closed abruptly');
      }
    };

    channel.onmessage = (event) => {
      try {
        const decoded = decodeChunk(event.data);
        if (decoded.header.messageType === ChunkMessageType.DATA) {
          // Handled by transfer engine receiver stream
          (this as any)._onDataChunk?.(decoded);
        }
      } catch (err) {
        console.error('Error decoding chunk over DataChannel:', err);
      }
    };
  }

  private async handleSignalingMessage(msg: SignalingMessage<any>) {
    const localDevice = getLocalDeviceInfo();

    switch (msg.type) {
      case 'ROOM_JOINED': {
        const payload = msg.payload;
        if (payload.existingPeers?.length > 0) {
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
        const peer = msg.payload.device;
        this.targetPeerId = peer.deviceId;
        for (const l of this.listeners.onPeerFound) {
          l({
            id: peer.deviceId,
            device: peer,
            mode: 'WEBRTC_P2P',
            lastSeen: Date.now()
          });
        }
        break;
      }

      case 'OFFER': {
        this.targetPeerId = msg.senderId;
        this.updateState('CONNECTING');
        this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
        this.setupPeerConnectionEvents();

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
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
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
        }
        break;
      }

      case 'ICE_CANDIDATE': {
        if (this.peerConnection && msg.payload.candidate) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.payload.candidate));
        }
        break;
      }

      case 'TRANSFER_OFFER': {
        const manifest = msg.payload.manifest as TransferManifest;
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
        this.updateState('TRANSFERRING');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: msg.payload.transferId,
            accepted: true,
            timestamp: Date.now()
          });
        }
        break;
      }

      case 'TRANSFER_REJECT': {
        this.updateState('REJECTED');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: msg.payload.transferId,
            accepted: false,
            reason: msg.payload.reason,
            timestamp: Date.now()
          });
        }
        break;
      }

      case 'TRANSFER_CANCEL': {
        this.updateState('CANCELLED');
        break;
      }

      case 'ERROR': {
        this.updateState('FAILED', msg.payload?.message);
        break;
      }
    }
  }
}

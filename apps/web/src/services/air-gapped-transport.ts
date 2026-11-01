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
import {
  encodeChunk,
  decodeChunk,
  ChunkMessageType,
  DEFAULT_FLOW_CONFIG
} from '@peerport/transfer-protocol';
import { getLocalDeviceInfo } from './device-info.js';
import {
  createQrPayloads,
  waitForIceGathering,
  unmaskMdnsCandidateIfKnown,
  QrSignalingPacket,
  AnyQrPacket
} from './qr-signaling.js';

/**
 * Diagnoses RTCPeerConnection construction and WebRTC network interface failures.
 * Distinguishes between browser-specific restrictions (e.g. Firefox offline enforcement)
 * and genuine lack of an active local network interface.
 */
export function diagnosePeerConnectionError(err: any): Error {
  const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const errMsg = err?.message || String(err);

  if (
    errMsg.includes('network is down') ||
    errMsg.includes('NS_ERROR_FAILURE') ||
    (isFirefox && !isOnline)
  ) {
    const reason = isFirefox
      ? "Firefox detected that the network route is down and blocked RTCPeerConnection creation. " +
        "Firefox requires an active network route or 'network.manage-offline-status: false' in about:config. " +
        "Remedy: On laptops, use Chrome or Edge for offline hotspot transfers, or in Firefox set about:config > network.manage-offline-status to false, and ensure Wi-Fi is connected to the phone hotspot."
      : "No active local network interface detected. WebRTC requires an active local Wi-Fi or mobile hotspot connection. " +
        "Please ensure Wi-Fi is turned ON on this device and connected to the other device's mobile hotspot or shared Wi-Fi network.";

    const enhanced = new Error(`[WebRTC Network Offline] ${reason}`);
    (enhanced as any).originalError = err;
    return enhanced;
  }

  return err;
}

export class AirGappedTransport implements PeerTransport {
  readonly mode: TransportMode = 'QR_MANUAL';
  connectionState: ConnectionState = 'IDLE';

  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private currentSessionId: string | null = null;
  private lastProcessedOfferId: string | null = null;
  private lastProcessedResponseId: string | null = null;
  private lastProcessedCompleteId: string | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Sender Workflow Step 1:
   * Creates RTCPeerConnection with iceServers: [], creates DataChannel, gathers local host ICE candidates,
   * compresses SDP offer, and returns QR signaling packets.
   */
  async createOfferPayloads(sessionId: string): Promise<AnyQrPacket[]> {
    const startTime = performance.now();
    console.log(`[DIAG 2] [${new Date().toISOString()}] RTCPeerConnection creation started for session ${sessionId}`);
    this.currentSessionId = sessionId;

    try {
      try {
        this.peerConnection = new RTCPeerConnection({ iceServers: [] });
      } catch (pcErr: any) {
        const diagnosed = diagnosePeerConnectionError(pcErr);
        console.error(`[DIAG ERROR] [${new Date().toISOString()}] RTCPeerConnection constructor failed:`, diagnosed);
        this.updateState('FAILED', diagnosed.message);
        throw diagnosed;
      }
      console.log(`[DIAG 3] [${new Date().toISOString()}] RTCPeerConnection created successfully (iceServers: [])`);
      this.setupPeerConnectionEvents();

      this.dataChannel = this.peerConnection.createDataChannel('peerport-data', {
        ordered: true
      });
      this.setupDataChannelEvents(this.dataChannel);
      console.log(`[DIAG 4] [${new Date().toISOString()}] createDataChannel completed (label: peerport-data, state: ${this.dataChannel.readyState})`);

      console.log(`[DIAG 5] [${new Date().toISOString()}] createOffer started`);
      const offerStart = performance.now();
      const offer = await this.peerConnection.createOffer();
      console.log(`[DIAG 6] [${new Date().toISOString()}] createOffer completed (duration: ${(performance.now() - offerStart).toFixed(1)}ms, offer SDP length: ${offer.sdp?.length})`);

      console.log(`[DIAG 7] [${new Date().toISOString()}] setLocalDescription started`);
      const setLocalStart = performance.now();
      await this.peerConnection.setLocalDescription(offer);
      console.log(`[DIAG 8] [${new Date().toISOString()}] setLocalDescription completed (duration: ${(performance.now() - setLocalStart).toFixed(1)}ms)`);

      // Wait for all local host candidates to be collected into localDescription.sdp
      await waitForIceGathering(this.peerConnection);

      const sdp = this.peerConnection.localDescription?.sdp || offer.sdp || '';
      console.log(`[DIAG 11] [${new Date().toISOString()}] SDP extracted (length: ${sdp.length}, hasCandidates: ${sdp.includes('candidate:')})`);
      if (!sdp.includes('candidate:')) {
        console.warn('No local network candidates gathered. Ensure Wi-Fi or mobile hotspot is active.');
      }
      const packets = await createQrPayloads(sessionId, 'offer', sdp);
      console.log(`[DIAG 13.1] [${new Date().toISOString()}] createOfferPayloads completed in ${(performance.now() - startTime).toFixed(1)}ms (packets: ${packets.length})`);
      return packets;
    } catch (err: any) {
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] Exception in createOfferPayloads:`, err);
      throw err;
    }
  }

  /**
   * Sender Workflow Step 2:
   * Applies the receiver's decompressed SDP answer to complete WebRTC negotiation.
   */
  async applyAnswer(answerSdp: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized. Offer must be created first.');
    }

    this.updateState('CONNECTING');
    const processedAnswerSdp = unmaskMdnsCandidateIfKnown(answerSdp);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: processedAnswerSdp })
    );

    this.notifyPeerConnected();

    // Start 25s watchdog timer for DataChannel connection
    this.clearConnectionTimer();
    this.connectionTimer = setTimeout(() => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        this.updateState(
          'FAILED',
          'Direct connection timed out. Ensure both devices are connected to the same Wi-Fi or mobile hotspot.'
        );
      }
    }, 25_000);
  }

  /**
   * Receiver Workflow Step 1:
   * Sets the sender's decompressed SDP offer as remote description, generates an SDP answer,
   * gathers local host ICE candidates, compresses SDP answer, and returns QR signaling packets.
   */
  async createAnswerPayloads(sessionId: string, offerSdp: string): Promise<AnyQrPacket[]> {
    this.currentSessionId = sessionId;

    try {
      this.peerConnection = new RTCPeerConnection({ iceServers: [] });
    } catch (pcErr: any) {
      const diagnosed = diagnosePeerConnectionError(pcErr);
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] RTCPeerConnection constructor failed in createAnswerPayloads:`, diagnosed);
      this.updateState('FAILED', diagnosed.message);
      throw diagnosed;
    }
    this.setupPeerConnectionEvents();

    const processedOfferSdp = unmaskMdnsCandidateIfKnown(offerSdp);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: processedOfferSdp })
    );

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    // Wait for all local host candidates to be collected into localDescription.sdp
    await waitForIceGathering(this.peerConnection);

    this.notifyPeerConnected();

    // Start 45s watchdog timer for receiver awaiting sender to scan answer
    this.clearConnectionTimer();
    this.connectionTimer = setTimeout(() => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        this.updateState(
          'FAILED',
          'Waiting for sender timed out. Please ensure the sender scanned your Answer QR code.'
        );
      }
    }, 45_000);

    const sdp = this.peerConnection.localDescription?.sdp || answer.sdp || '';
    return await createQrPayloads(sessionId, 'answer', sdp);
  }

  private clearConnectionTimer() {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private notifyPeerConnected() {
    const peer: DiscoveredPeer = {
      id: this.currentSessionId || 'airgapped-peer',
      device: {
        deviceId: this.currentSessionId || 'airgapped-peer',
        deviceName: 'Air-Gapped Device',
        platform: 'browser'
      },
      mode: 'QR_MANUAL',
      lastSeen: Date.now()
    };
    for (const l of this.listeners.onPeerFound) {
      l(peer);
    }
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
    return {
      id: peerId,
      peer: {
        id: peerId,
        device: { deviceId: peerId, deviceName: 'Air-Gapped Device', platform: 'browser' },
        mode: 'QR_MANUAL',
        lastSeen: Date.now()
      },
      mode: 'QR_MANUAL',
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
      roomId: this.currentSessionId || 'airgapped',
      senderId: localDevice.deviceId,
      targetId: connection.id,
      payload: { manifest },
      timestamp: Date.now()
    });
  }

  async respondTransferRequest(connection: PeerConnection, transferId: string, accepted: boolean): Promise<void> {
    const localDevice = getLocalDeviceInfo();
    const type = accepted ? 'TRANSFER_ACCEPT' : 'TRANSFER_REJECT';

    this.sendControlMessage({
      type,
      roomId: this.currentSessionId || 'airgapped',
      senderId: localDevice.deviceId,
      targetId: connection.id,
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
      throw new Error('Air-gapped DataChannel is not open');
    }

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
      roomId: this.currentSessionId || 'airgapped',
      senderId: localDevice.deviceId,
      targetId: connection.id,
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
      roomId: this.currentSessionId || 'airgapped',
      senderId: localDevice.deviceId,
      targetId: connection.id,
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
    this.clearConnectionTimer();
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
    this.lastProcessedOfferId = null;
    this.lastProcessedResponseId = null;
    this.lastProcessedCompleteId = null;
    this.updateState('IDLE');
  }

  private sendControlMessage(msg: SignalingMessage<any>) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(msg));
      } catch (err) {
        console.warn('Failed to send control frame over air-gapped DataChannel:', err);
      }
    }
  }

  private setupPeerConnectionEvents() {
    if (!this.peerConnection) return;

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannelEvents(this.dataChannel);
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log(
        `[DIAG STATE] [${new Date().toISOString()}] peerConnection state -> ${state} (internal: ${this.connectionState}, watchdog: ${!!this.connectionTimer})`
      );

      if (state === 'connected') {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          this.clearConnectionTimer();
        }
      } else if (state === 'failed') {
        // Suppress premature failure while handshake watchdog timer is active
        if (this.connectionTimer) {
          console.warn(
            `[DIAG WARN] [${new Date().toISOString()}] peerConnection failed while awaiting peer QR scan. Suppressing premature abort.`
          );
          return;
        }
        if (this.connectionState !== 'COMPLETED') {
          this.updateState('FAILED', 'Direct peer link failed. Verify devices are on the same Wi-Fi or phone hotspot.');
        }
      } else if (state === 'disconnected') {
        if (this.connectionTimer) {
          console.warn(
            `[DIAG WARN] [${new Date().toISOString()}] peerConnection disconnected while awaiting peer QR scan. Suppressing premature abort.`
          );
          return;
        }
        if (this.connectionState !== 'COMPLETED') {
          this.updateState('DISCONNECTED', 'Direct peer link disconnected');
        }
      }
    };
  }

  private setupDataChannelEvents(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.clearConnectionTimer();
      console.log(
        `[DIAG CHANNEL] [${new Date().toISOString()}] DataChannel onopen (readyState: ${channel.readyState}, pcState: ${this.peerConnection?.connectionState})`
      );
      for (const listener of this.listeners.onChannelReady) {
        listener();
      }
    };

    channel.onclose = () => {
      if (this.connectionState === 'TRANSFERRING') {
        this.updateState('DISCONNECTED', 'Air-gapped data channel closed');
      }
    };

    channel.onerror = (err) => {
      console.error('Air-gapped DataChannel error:', err);
      for (const listener of this.listeners.onError) {
        listener(new Error('DataChannel error'));
      }
    };

    channel.onmessage = (event) => {
      // Direct DataChannel control signaling
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage<any>;
          this.handleControlMessage(msg);
        } catch (err) {
          console.error('Failed to parse air-gapped control message:', err);
        }
        return;
      }

      // Binary chunk data
      try {
        const decoded = decodeChunk(event.data);
        if (decoded.header.messageType === ChunkMessageType.DATA) {
          for (const listener of this.listeners.onChunkReceived) {
            listener(decoded);
          }
        }
      } catch (err) {
        console.error('Error decoding air-gapped chunk:', err);
      }
    };
  }

  private handleControlMessage(msg: SignalingMessage<any>) {
    switch (msg.type) {
      case 'TRANSFER_OFFER': {
        const payload = msg.payload as any;
        const manifest = payload.manifest as TransferManifest;

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


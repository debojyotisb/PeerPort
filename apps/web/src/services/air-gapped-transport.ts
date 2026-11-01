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
import {
  SignalingMessageSchema,
  TransferManifestSchema,
  TransferResponseSchema
} from '@peerport/validation';
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
 * Verifies local network interface availability without browser-specific assumptions.
 */
export function diagnosePeerConnectionError(err: any): Error {
  const errMsg = err?.message || String(err);

  if (
    errMsg.includes('network is down') ||
    errMsg.includes('NS_ERROR_FAILURE') ||
    errMsg.includes('NetworkError')
  ) {
    const reason =
      'No active local network interface detected. WebRTC requires an active local Wi-Fi or mobile hotspot connection. ' +
      'Please ensure Wi-Fi is turned ON on this device and connected to the same mobile hotspot or local Wi-Fi network.';

    const enhanced = new Error(`[WebRTC Network Offline] ${reason}`);
    (enhanced as any).originalError = err;
    return enhanced;
  }

  return err;
}

export type AirGappedHandshakePhase =
  | 'IDLE'
  | 'CREATING_OFFER'
  | 'WAITING_FOR_RECEIVER'
  | 'PREPARING_ANSWER'
  | 'WAITING_FOR_SENDER'
  | 'APPLYING_ANSWER'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'TRANSFERRING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CLOSED';

export class AirGappedTransport implements PeerTransport {
  readonly mode: TransportMode = 'QR_MANUAL';
  connectionState: ConnectionState = 'IDLE';

  private handshakePhase: AirGappedHandshakePhase = 'IDLE';
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private currentSessionId: string | null = null;
  private lastProcessedOfferId: string | null = null;
  private lastProcessedResponseId: string | null = null;
  private lastProcessedCompleteId: string | null = null;

  // Granular watchdog and recovery timers
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectionTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.clearAllTimers();
    this.handshakePhase = 'IDLE';
    this.updateState('IDLE');
  }

  getHandshakePhase(): AirGappedHandshakePhase {
    return this.handshakePhase;
  }

  subscribe<K extends keyof typeof this.listeners>(event: K, handler: any): () => void {
    const set = this.listeners[event] as Set<any>;
    set.add(handler);
    return () => set.delete(handler);
  }

  private clearAllTimers() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    if (this.disconnectionTimer) {
      clearTimeout(this.disconnectionTimer);
      this.disconnectionTimer = null;
    }
  }

  private updateState(state: ConnectionState, reason?: string) {
    this.connectionState = state;
    if (state === 'FAILED' || state === 'COMPLETED' || state === 'DISCONNECTED') {
      this.clearAllTimers();
    }
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
    this.clearAllTimers();
    this.handshakePhase = 'CREATING_OFFER';

    try {
      try {
        this.peerConnection = new RTCPeerConnection({ iceServers: [] });
      } catch (pcErr: any) {
        const diagnosed = diagnosePeerConnectionError(pcErr);
        console.error(`[DIAG ERROR] [${new Date().toISOString()}] RTCPeerConnection constructor failed:`, diagnosed);
        this.handshakePhase = 'FAILED';
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

      // Wait for all local host candidates to be collected into localDescription.sdp (with 15s timeout safeguard)
      await Promise.race([
        waitForIceGathering(this.peerConnection),
        new Promise<void>((resolve) => setTimeout(resolve, 15_000))
      ]);

      const sdp = this.peerConnection.localDescription?.sdp || offer.sdp || '';
      console.log(`[DIAG 11] [${new Date().toISOString()}] SDP extracted (length: ${sdp.length}, hasCandidates: ${sdp.includes('candidate:')})`);
      if (!sdp.includes('candidate:')) {
        console.warn('No local network candidates gathered. Ensure Wi-Fi or mobile hotspot is active.');
      }

      this.handshakePhase = 'WAITING_FOR_RECEIVER';

      // Arm 90-second handshake watchdog for sender awaiting receiver scan and answer scan
      this.handshakeTimer = setTimeout(() => {
        if (this.handshakePhase === 'WAITING_FOR_RECEIVER') {
          console.warn(`[AirGappedTransport] 90s handshake timeout reached on Sender awaiting Answer scan.`);
          this.handshakePhase = 'FAILED';
          this.updateState(
            'FAILED',
            'Handshake timed out waiting for Answer QR scan (90s). Ensure the receiver scanned the Offer QR and you scanned the Answer QR.'
          );
        }
      }, 90_000);

      const packets = await createQrPayloads(sessionId, 'offer', sdp);
      console.log(`[DIAG 13.1] [${new Date().toISOString()}] createOfferPayloads completed in ${(performance.now() - startTime).toFixed(1)}ms (packets: ${packets.length})`);
      return packets;
    } catch (err: any) {
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] Exception in createOfferPayloads:`, err);
      this.clearAllTimers();
      this.handshakePhase = 'FAILED';
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

    this.handshakePhase = 'APPLYING_ANSWER';
    const processedAnswerSdp = unmaskMdnsCandidateIfKnown(answerSdp);

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: processedAnswerSdp })
      );
    } catch (err: any) {
      console.error('[AirGappedTransport] Failed to apply remote answer SDP:', err);
      this.handshakePhase = 'FAILED';
      this.updateState('FAILED', 'Failed to apply remote answer SDP: ' + (err?.message || String(err)));
      throw err;
    }

    // Only transition to CONNECTING after setRemoteDescription successfully completes
    this.handshakePhase = 'CONNECTING';
    this.updateState('CONNECTING');
    this.notifyPeerConnected();

    // Start 30s connection watchdog for DataChannel opening after both SDPs applied
    this.clearAllTimers();
    this.connectionTimer = setTimeout(() => {
      if (this.handshakePhase === 'CONNECTING' && (!this.dataChannel || this.dataChannel.readyState !== 'open')) {
        console.warn(`[AirGappedTransport] 30s connection timeout reached after Answer applied.`);
        this.handshakePhase = 'FAILED';
        this.updateState(
          'FAILED',
          'Direct connection timed out after Answer applied (30s). Verify both devices are connected to the same Wi-Fi or mobile hotspot.'
        );
      }
    }, 30_000);
  }

  /**
   * Receiver Workflow Step 1:
   * Sets the sender's decompressed SDP offer as remote description, generates an SDP answer,
   * gathers local host ICE candidates, compresses SDP answer, and returns QR signaling packets.
   */
  async createAnswerPayloads(sessionId: string, offerSdp: string): Promise<AnyQrPacket[]> {
    this.currentSessionId = sessionId;
    this.clearAllTimers();
    this.handshakePhase = 'PREPARING_ANSWER';

    try {
      this.peerConnection = new RTCPeerConnection({ iceServers: [] });
    } catch (pcErr: any) {
      const diagnosed = diagnosePeerConnectionError(pcErr);
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] RTCPeerConnection constructor failed in createAnswerPayloads:`, diagnosed);
      this.handshakePhase = 'FAILED';
      this.updateState('FAILED', diagnosed.message);
      throw diagnosed;
    }
    this.setupPeerConnectionEvents();

    try {
      const processedOfferSdp = unmaskMdnsCandidateIfKnown(offerSdp);
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: processedOfferSdp })
      );

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Wait for all local host candidates to be collected into localDescription.sdp (with 15s timeout safeguard)
      await Promise.race([
        waitForIceGathering(this.peerConnection),
        new Promise<void>((resolve) => setTimeout(resolve, 15_000))
      ]);

      this.notifyPeerConnected();

      // Receiver has applied offer & answer, and is now waiting for sender to scan its Answer QR
      this.handshakePhase = 'WAITING_FOR_SENDER';

      // Arm 90-second handshake watchdog for receiver awaiting sender to scan answer
      this.handshakeTimer = setTimeout(() => {
        if (this.handshakePhase === 'WAITING_FOR_SENDER') {
          console.warn(`[AirGappedTransport] 90s handshake timeout reached on Receiver awaiting Sender scan.`);
          this.handshakePhase = 'FAILED';
          this.updateState(
            'FAILED',
            'Waiting for sender to scan Answer QR timed out (90s). Please ensure the sender scanned your Answer QR code.'
          );
        }
      }, 90_000);

      const sdp = this.peerConnection.localDescription?.sdp || answer.sdp || '';
      return await createQrPayloads(sessionId, 'answer', sdp);
    } catch (err: any) {
      console.error('[AirGappedTransport] Error in createAnswerPayloads:', err);
      this.clearAllTimers();
      this.handshakePhase = 'FAILED';
      this.updateState('FAILED', 'Failed to generate answer: ' + (err?.message || String(err)));
      throw err;
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Cannot send transfer request: Air-gapped DataChannel is not open');
    }
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Cannot respond to transfer request: Air-gapped DataChannel is not open');
    }
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
      this.handshakePhase = 'TRANSFERRING';
      this.updateState('TRANSFERRING');
    } else {
      this.updateState('REJECTED');
    }
  }

  async sendChunk(connection: PeerConnection, chunk: BinaryChunk): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Air-gapped DataChannel is not open');
    }

    // Backpressure management: wait if buffer exceeds highWaterMark
    if (this.dataChannel.bufferedAmount > DEFAULT_FLOW_CONFIG.highWaterMark) {
      await new Promise<void>((resolve, reject) => {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
          return reject(new Error('DataChannel closed while awaiting buffer drain'));
        }

        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;

        const cleanupWait = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (pollTimer) clearInterval(pollTimer);
          if (this.dataChannel) {
            this.dataChannel.onbufferedamountlow = null;
          }
        };

        this.dataChannel.bufferedAmountLowThreshold = DEFAULT_FLOW_CONFIG.lowWaterMark;
        this.dataChannel.onbufferedamountlow = () => {
          cleanupWait();
          resolve();
        };

        // Fallback polling every 50ms in case browser drops event
        pollTimer = setInterval(() => {
          if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            cleanupWait();
            reject(new Error('DataChannel closed during buffer drain'));
            return;
          }
          if (this.dataChannel.bufferedAmount <= DEFAULT_FLOW_CONFIG.lowWaterMark) {
            cleanupWait();
            resolve();
          }
        }, 50);

        // 10-second timeout safeguard to prevent hanging forever
        timeoutTimer = setTimeout(() => {
          cleanupWait();
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            resolve();
          } else {
            reject(new Error('DataChannel buffer drain timed out (10s)'));
          }
        }, 10_000);
      });
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Air-gapped DataChannel closed before chunk could be sent');
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
    this.clearAllTimers();
    this.updateState('CANCELLED');
  }

  async sendTransferComplete(connection: PeerConnection, payload: TransferCompletePayload): Promise<void> {
    this.clearAllTimers();
    this.handshakePhase = 'COMPLETED';
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
    this.clearAllTimers();
    this.handshakePhase = 'COMPLETED';
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
    this.clearAllTimers();
    this.handshakePhase = 'CLOSED';
    if (this.dataChannel) {
      try {
        this.dataChannel.onopen = null;
        this.dataChannel.onclose = null;
        this.dataChannel.onerror = null;
        this.dataChannel.onmessage = null;
        this.dataChannel.onbufferedamountlow = null;
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.ondatachannel = null;
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn(`[AirGappedTransport] Cannot send control message ${msg.type}: DataChannel not open`);
      return;
    }
    try {
      this.dataChannel.send(JSON.stringify(msg));
    } catch (err) {
      console.error(`[AirGappedTransport] Failed to send control message ${msg.type}:`, err);
      throw err;
    }
  }

  private setupPeerConnectionEvents() {
    if (!this.peerConnection) return;

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannelEvents(this.dataChannel);
    };

    const handleIceState = () => {
      const pc = this.peerConnection;
      if (!pc) return;

      const connState = pc.connectionState;
      const iceState = pc.iceConnectionState;
      console.log(
        `[DIAG STATE] [${new Date().toISOString()}] PC state: ${connState}, ICE state: ${iceState} (handshakePhase: ${this.handshakePhase})`
      );

      // 1. Connection established
      if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (this.disconnectionTimer) {
          console.log('[AirGappedTransport] ICE re-established within recovery grace period.');
          clearTimeout(this.disconnectionTimer);
          this.disconnectionTimer = null;
        }

        if (this.handshakePhase === 'WAITING_FOR_SENDER' || this.handshakePhase === 'APPLYING_ANSWER') {
          this.handshakePhase = 'CONNECTING';
        }

        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          this.handshakePhase = 'CONNECTED';
          this.clearAllTimers();
        }
      }

      // 2. Disconnection event
      else if (connState === 'disconnected' || iceState === 'disconnected') {
        // Pre-exchange: expected while waiting for peer to scan QR
        if (
          this.handshakePhase === 'CREATING_OFFER' ||
          this.handshakePhase === 'WAITING_FOR_RECEIVER' ||
          this.handshakePhase === 'PREPARING_ANSWER' ||
          this.handshakePhase === 'WAITING_FOR_SENDER'
        ) {
          console.warn(`[AirGappedTransport] Suppressing transient ICE ${iceState} during ${this.handshakePhase}.`);
          return;
        }

        // Post-exchange: Start 10-second recovery grace period
        if (!this.disconnectionTimer && this.connectionState !== 'COMPLETED') {
          console.warn('[AirGappedTransport] ICE disconnected post-exchange. Starting 10s recovery grace period...');
          this.disconnectionTimer = setTimeout(() => {
            this.disconnectionTimer = null;
            if (this.peerConnection?.connectionState === 'disconnected' || this.peerConnection?.iceConnectionState === 'disconnected') {
              console.error('[AirGappedTransport] Disconnection recovery grace period expired.');
              this.updateState('DISCONNECTED', 'Direct peer link disconnected. Device lost Wi-Fi or hotspot signal.');
            }
          }, 10_000);
        }
      }

      // 3. Failed event
      else if (connState === 'failed' || iceState === 'failed') {
        // Pre-exchange: expected while waiting for peer to scan QR
        if (
          this.handshakePhase === 'CREATING_OFFER' ||
          this.handshakePhase === 'WAITING_FOR_RECEIVER' ||
          this.handshakePhase === 'PREPARING_ANSWER' ||
          this.handshakePhase === 'WAITING_FOR_SENDER'
        ) {
          console.warn(`[AirGappedTransport] Suppressing premature ICE ${iceState} during ${this.handshakePhase}.`);
          return;
        }

        // Post-exchange: Genuine failure!
        if (this.connectionState !== 'COMPLETED') {
          this.clearAllTimers();
          this.handshakePhase = 'FAILED';
          this.updateState(
            'FAILED',
            'Direct peer-to-peer network link failed. Verify devices are on the same Wi-Fi or phone hotspot. If using public Wi-Fi, ensure AP client isolation is not blocking local communication.'
          );
        }
      }
    };

    this.peerConnection.onconnectionstatechange = handleIceState;
    this.peerConnection.oniceconnectionstatechange = handleIceState;
  }

  private setupDataChannelEvents(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.clearAllTimers();
      this.handshakePhase = 'CONNECTED';
      console.log(
        `[DIAG CHANNEL] [${new Date().toISOString()}] DataChannel onopen (readyState: ${channel.readyState})`
      );
      for (const listener of this.listeners.onChannelReady) {
        listener();
      }
    };

    channel.onclose = () => {
      console.warn(`[DIAG CHANNEL] [${new Date().toISOString()}] DataChannel onclose (connectionState: ${this.connectionState})`);
      if (this.connectionState === 'TRANSFERRING' || this.connectionState === 'AWAITING_APPROVAL') {
        this.clearAllTimers();
        this.handshakePhase = 'CLOSED';
        this.updateState('DISCONNECTED', 'Air-gapped data channel closed unexpectedly');
      }
    };

    channel.onerror = (err) => {
      console.error('Air-gapped DataChannel error:', err);
      for (const listener of this.listeners.onError) {
        listener(new Error('DataChannel error: ' + (err as any)?.message));
      }
    };

    channel.onmessage = (event) => {
      // Direct DataChannel control signaling
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
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
          if (
            decoded.header.magic === 0x50505254 &&
            decoded.header.chunkIndex >= 0 &&
            decoded.header.chunkIndex < decoded.header.totalChunks &&
            decoded.data.byteLength === decoded.header.payloadLength
          ) {
            for (const listener of this.listeners.onChunkReceived) {
              listener(decoded);
            }
          } else {
            console.warn('[AirGappedTransport] Rejected malformed chunk frame header');
          }
        }
      } catch (err) {
        console.error('Error decoding air-gapped chunk:', err);
      }
    };
  }

  private handleControlMessage(msg: SignalingMessage<any>) {
    // 1. Validate top-level signaling message structure
    const parseResult = SignalingMessageSchema.safeParse(msg);
    if (!parseResult.success) {
      console.error('[AirGappedTransport] Malformed signaling control message rejected:', parseResult.error);
      return;
    }

    const validMsg = parseResult.data;

    switch (validMsg.type) {
      case 'TRANSFER_OFFER': {
        // Enforce allowed state transitions
        if (this.handshakePhase !== 'CONNECTED' && this.connectionState !== 'CONNECTING' && this.connectionState !== 'IDLE') {
          console.warn(`[AirGappedTransport] Ignored TRANSFER_OFFER during invalid state: ${this.connectionState} (phase: ${this.handshakePhase})`);
          return;
        }

        const payload = validMsg.payload as any;
        const manifestResult = TransferManifestSchema.safeParse(payload?.manifest);
        if (!manifestResult.success) {
          console.error('[AirGappedTransport] Invalid TransferManifest rejected:', manifestResult.error);
          return;
        }

        const manifest = manifestResult.data;

        // Deduplicate offer
        if (this.lastProcessedOfferId === manifest.transferId) break;
        this.lastProcessedOfferId = manifest.transferId;

        this.updateState('AWAITING_APPROVAL');

        for (const l of this.listeners.onTransferRequest) {
          l(manifest as any, async (accepted: boolean) => {
            await this.respondTransferRequest(
              { id: validMsg.senderId } as any,
              manifest.transferId,
              accepted
            );
          });
        }
        break;
      }

      case 'TRANSFER_ACCEPT': {
        if (this.connectionState !== 'AWAITING_APPROVAL' && this.handshakePhase !== 'CONNECTED' && this.connectionState !== 'CONNECTING') {
          console.warn(`[AirGappedTransport] Ignored TRANSFER_ACCEPT during state: ${this.connectionState} (phase: ${this.handshakePhase})`);
          return;
        }

        const payloadResult = TransferResponseSchema.safeParse(validMsg.payload);
        if (!payloadResult.success) {
          console.error('[AirGappedTransport] Invalid TRANSFER_ACCEPT payload rejected:', payloadResult.error);
          return;
        }

        const payload = payloadResult.data;
        if (this.lastProcessedResponseId === payload.transferId) break;
        this.lastProcessedResponseId = payload.transferId;

        this.handshakePhase = 'TRANSFERRING';
        this.updateState('TRANSFERRING');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: payload.transferId,
            accepted: true,
            timestamp: payload.timestamp
          });
        }
        break;
      }

      case 'TRANSFER_REJECT': {
        const payloadResult = TransferResponseSchema.safeParse(validMsg.payload);
        if (!payloadResult.success) {
          console.error('[AirGappedTransport] Invalid TRANSFER_REJECT payload rejected:', payloadResult.error);
          return;
        }

        const payload = payloadResult.data;
        if (this.lastProcessedResponseId === payload.transferId) break;
        this.lastProcessedResponseId = payload.transferId;

        this.updateState('REJECTED');
        for (const l of this.listeners.onTransferResponse) {
          l({
            transferId: payload.transferId,
            accepted: false,
            reason: payload.reason,
            timestamp: payload.timestamp
          });
        }
        break;
      }

      case 'TRANSFER_CANCEL': {
        this.clearAllTimers();
        this.updateState('CANCELLED');
        break;
      }

      case 'TRANSFER_COMPLETE': {
        const payload = validMsg.payload as TransferCompletePayload;
        if (!payload || typeof payload.transferId !== 'string') {
          console.error('[AirGappedTransport] Malformed TRANSFER_COMPLETE payload');
          return;
        }

        if (this.lastProcessedCompleteId === payload.transferId) break;
        this.lastProcessedCompleteId = payload.transferId;

        this.clearAllTimers();
        this.handshakePhase = 'COMPLETED';
        this.updateState('COMPLETED');
        for (const l of this.listeners.onTransferComplete) {
          l(payload);
        }
        break;
      }

      case 'ERROR': {
        const payload = validMsg.payload as any;
        this.clearAllTimers();
        this.handshakePhase = 'FAILED';
        this.updateState('FAILED', payload?.message || 'Remote peer reported an error');
        break;
      }
    }
  }
}

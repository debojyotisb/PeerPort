import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AirGappedTransport,
  diagnosePeerConnectionError
} from '../services/air-gapped-transport.js';

describe('AirGappedTransport Diagnostics & Watchdog State Machine', () => {
  const originalUserAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const originalOnLine = typeof navigator !== 'undefined' ? navigator.onLine : true;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
    }
  });

  describe('1. Browser Diagnostic & navigator.onLine Tests', () => {
    it('does NOT attribute network errors to Firefox when running on Google Chrome', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        configurable: true
      });
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      const err = new Error('network is down');
      const diagnosed = diagnosePeerConnectionError(err);

      expect(diagnosed.message).toContain('[WebRTC Network Offline]');
      expect(diagnosed.message).not.toContain('Firefox');
      expect(diagnosed.message).toContain('No active local network interface detected');
    });

    it('does NOT attribute network errors to Firefox when running on Microsoft Edge', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        configurable: true
      });
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      const err = new Error('NS_ERROR_FAILURE');
      const diagnosed = diagnosePeerConnectionError(err);

      expect(diagnosed.message).toContain('[WebRTC Network Offline]');
      expect(diagnosed.message).not.toContain('Firefox');
      expect(diagnosed.message).toContain('No active local network interface detected');
    });

    it('does not treat navigator.onLine=false as proof that the local network route is down', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      // An arbitrary non-network error occurring while onLine is false (e.g. mobile hotspot with mobile data off)
      const err = new Error('InvalidStateError: RTCPeerConnection is closed');
      const diagnosed = diagnosePeerConnectionError(err);

      // Must not falsely inject [WebRTC Network Offline] merely because onLine is false
      expect(diagnosed.message).toBe('InvalidStateError: RTCPeerConnection is closed');
      expect(diagnosed.message).not.toContain('WebRTC Network Offline');
    });

    it('returns the original error untouched when no network fault is detected', () => {
      const err = new TypeError('Failed to execute createOffer');
      const diagnosed = diagnosePeerConnectionError(err);
      expect(diagnosed).toBe(err);
    });
  });

  describe('2. State Machine & Handshake Watchdog Tests', () => {
    let transport: AirGappedTransport;
    let mockPeerConnection: any;
    let mockDataChannel: any;

    beforeEach(() => {
      transport = new AirGappedTransport();

      mockDataChannel = {
        readyState: 'connecting',
        binaryType: 'blob',
        send: vi.fn(),
        close: vi.fn(),
        onopen: null as any,
        onclose: null as any,
        onerror: null as any,
        onmessage: null as any
      };

      mockPeerConnection = {
        connectionState: 'new',
        iceGatheringState: 'complete',
        localDescription: {
          type: 'offer',
          sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.50\r\na=ice-ufrag:test\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 AA:BB\r\na=sctp-port:5000\r\na=setup:actpass\r\na=mid:0\r\na=candidate:1 1 udp 2122260223 192.168.43.50 54321 typ host\r\n'
        },
        remoteDescription: null as any,
        createOffer: vi.fn().mockResolvedValue({
          type: 'offer',
          sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.50\r\na=ice-ufrag:test\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 AA:BB\r\na=sctp-port:5000\r\na=setup:actpass\r\na=mid:0\r\na=candidate:1 1 udp 2122260223 192.168.43.50 54321 typ host\r\n'
        }),
        createAnswer: vi.fn().mockResolvedValue({
          type: 'answer',
          sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.1\r\na=ice-ufrag:ans\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 CC:DD\r\na=sctp-port:5000\r\na=setup:active\r\na=mid:0\r\na=candidate:2 1 udp 2122260223 192.168.43.1 51234 typ host\r\n'
        }),
        setLocalDescription: vi.fn().mockResolvedValue(undefined),
        setRemoteDescription: vi.fn().mockImplementation((desc: any) => {
          mockPeerConnection.remoteDescription = desc;
          return Promise.resolve();
        }),
        createDataChannel: vi.fn().mockReturnValue(mockDataChannel),
        close: vi.fn(),
        onconnectionstatechange: null as any,
        ondatachannel: null as any
      };

      // Stub global RTCPeerConnection and RTCSessionDescription
      vi.stubGlobal('RTCPeerConnection', vi.fn().mockImplementation(() => mockPeerConnection));
      vi.stubGlobal('RTCSessionDescription', vi.fn().mockImplementation((init) => init));
    });

    afterEach(async () => {
      await transport.close();
      vi.unstubAllGlobals();
    });

    it('Sender: arms 90-second watchdog and suppresses premature ICE failed during WAITING_FOR_RECEIVER', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      const packets = await transport.createOfferPayloads('ses_sender_test');
      expect(packets.length).toBeGreaterThan(0);
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_RECEIVER');

      // Simulate browser firing ICE failed while awaiting receiver scan
      mockPeerConnection.connectionState = 'failed';
      mockPeerConnection.onconnectionstatechange();

      // Must be suppressed because sender is waiting for receiver to scan & return answer
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_RECEIVER');
      expect(stateChanges.find((s) => s.state === 'FAILED')).toBeUndefined();

      // Advance clock by 89 seconds -> still waiting
      vi.advanceTimersByTime(89_000);
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_RECEIVER');
      expect(stateChanges.find((s) => s.state === 'FAILED')).toBeUndefined();

      // Advance clock past 90 seconds -> watchdog fires
      vi.advanceTimersByTime(2_000);
      expect(transport.getHandshakePhase()).toBe('FAILED');
      const failEvent = stateChanges.find((s) => s.state === 'FAILED');
      expect(failEvent).toBeDefined();
      expect(failEvent?.reason).toContain('Handshake timed out waiting for Answer QR scan (90s)');
    });

    it('Receiver: arms 90-second watchdog and suppresses premature ICE failed during WAITING_FOR_SENDER', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      const offerSdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.50\r\na=ice-ufrag:test\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 AA:BB\r\na=sctp-port:5000\r\na=setup:actpass\r\na=mid:0\r\na=candidate:1 1 udp 2122260223 192.168.43.50 54321 typ host\r\n';

      const packets = await transport.createAnswerPayloads('ses_recv_test', offerSdp);
      expect(packets.length).toBeGreaterThan(0);
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_SENDER');

      // While displaying Answer QR, Chrome ICE checks fail because sender hasn't scanned yet
      mockPeerConnection.connectionState = 'failed';
      mockPeerConnection.onconnectionstatechange();

      // Must be suppressed
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_SENDER');
      expect(stateChanges.find((s) => s.state === 'FAILED')).toBeUndefined();

      // Advancing 91 seconds triggers receiver watchdog
      vi.advanceTimersByTime(91_000);
      expect(transport.getHandshakePhase()).toBe('FAILED');
      const failEvent = stateChanges.find((s) => s.state === 'FAILED');
      expect(failEvent).toBeDefined();
      expect(failEvent?.reason).toContain('Waiting for sender to scan Answer QR timed out (90s)');
    });

    it('Genuine ICE failure after SDP exchange is immediately diagnosed and NOT suppressed', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      await transport.createOfferPayloads('ses_exchange_test');
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_RECEIVER');

      const answerSdp = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.1\r\na=ice-ufrag:ans\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 CC:DD\r\na=sctp-port:5000\r\na=setup:active\r\na=mid:0\r\na=candidate:2 1 udp 2122260223 192.168.43.1 51234 typ host\r\n';

      // Sender applies receiver Answer
      await transport.applyAnswer(answerSdp);
      expect(transport.getHandshakePhase()).toBe('CONNECTING');

      // Now both peers have exchanged SDP! If ICE fails now, it is a GENUINE network failure
      mockPeerConnection.connectionState = 'failed';
      mockPeerConnection.onconnectionstatechange();

      expect(transport.getHandshakePhase()).toBe('FAILED');
      const failEvent = stateChanges.find((s) => s.state === 'FAILED');
      expect(failEvent).toBeDefined();
      expect(failEvent?.reason).toContain('Direct peer-to-peer network link failed');
    });

    it('Clears all watchdogs on successful DataChannel opening', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      let channelReady = false;
      transport.subscribe('onChannelReady', () => {
        channelReady = true;
      });

      await transport.createOfferPayloads('ses_success_test');

      const answerSdp = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.1\r\na=ice-ufrag:ans\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 CC:DD\r\na=sctp-port:5000\r\na=setup:active\r\na=mid:0\r\na=candidate:2 1 udp 2122260223 192.168.43.1 51234 typ host\r\n';
      await transport.applyAnswer(answerSdp);

      // DataChannel opens
      mockDataChannel.readyState = 'open';
      mockDataChannel.onopen();

      expect(channelReady).toBe(true);
      expect(transport.getHandshakePhase()).toBe('CONNECTED');

      // Advance time by 60 seconds -> watchdog must NOT fire because it was cleared
      vi.advanceTimersByTime(60_000);
      expect(transport.getHandshakePhase()).toBe('CONNECTED');
      expect(stateChanges.find((s) => s.state === 'FAILED')).toBeUndefined();
    });

    it('Clears watchdogs on user cancellation (close)', async () => {
      await transport.createOfferPayloads('ses_cancel_test');
      expect(transport.getHandshakePhase()).toBe('WAITING_FOR_RECEIVER');

      // User closes modal
      await transport.close();
      expect(transport.getHandshakePhase()).toBe('CLOSED');

      // Advancing past 90s should do nothing
      vi.advanceTimersByTime(100_000);
      expect(transport.getHandshakePhase()).toBe('CLOSED');
      expect(transport.connectionState).toBe('IDLE');
    });

    it('Clears watchdogs on transfer completion (setCompleted)', async () => {
      await transport.createOfferPayloads('ses_complete_test');

      transport.setCompleted();
      expect(transport.getHandshakePhase()).toBe('COMPLETED');
      expect(transport.connectionState).toBe('COMPLETED');

      vi.advanceTimersByTime(100_000);
      expect(transport.connectionState).toBe('COMPLETED');
    });

    it('Grace period recovers when transient ICE disconnection reconnects within 10s', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      await transport.createOfferPayloads('ses_grace_test');
      const answerSdp = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.1\r\na=ice-ufrag:ans\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 CC:DD\r\na=sctp-port:5000\r\na=setup:active\r\na=mid:0\r\na=candidate:2 1 udp 2122260223 192.168.43.1 51234 typ host\r\n';
      await transport.applyAnswer(answerSdp);

      // DataChannel opens
      mockDataChannel.readyState = 'open';
      mockDataChannel.onopen();

      // Simulate transient ICE disconnection
      mockPeerConnection.connectionState = 'disconnected';
      mockPeerConnection.iceConnectionState = 'disconnected';
      mockPeerConnection.onconnectionstatechange();

      // State should not immediately become DISCONNECTED
      expect(stateChanges.find((s) => s.state === 'DISCONNECTED')).toBeUndefined();

      // Advance 5 seconds (within 10s grace period)
      vi.advanceTimersByTime(5_000);
      expect(stateChanges.find((s) => s.state === 'DISCONNECTED')).toBeUndefined();

      // ICE reconnects
      mockPeerConnection.connectionState = 'connected';
      mockPeerConnection.iceConnectionState = 'connected';
      mockPeerConnection.onconnectionstatechange();

      // Advance past the original 10s mark
      vi.advanceTimersByTime(10_000);
      // Disconnection was aborted; state remains connected
      expect(stateChanges.find((s) => s.state === 'DISCONNECTED')).toBeUndefined();
    });

    it('Transitions to DISCONNECTED when transient ICE disconnection persists past 10s', async () => {
      const stateChanges: { state: string; reason?: string }[] = [];
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        stateChanges.push({ state, reason });
      });

      await transport.createOfferPayloads('ses_grace_timeout_test');
      const answerSdp = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.43.1\r\na=ice-ufrag:ans\r\na=ice-pwd:pwd\r\na=fingerprint:sha-256 CC:DD\r\na=sctp-port:5000\r\na=setup:active\r\na=mid:0\r\na=candidate:2 1 udp 2122260223 192.168.43.1 51234 typ host\r\n';
      await transport.applyAnswer(answerSdp);

      mockDataChannel.readyState = 'open';
      mockDataChannel.onopen();

      // Disconnect
      mockPeerConnection.connectionState = 'disconnected';
      mockPeerConnection.iceConnectionState = 'disconnected';
      mockPeerConnection.onconnectionstatechange();

      // Advance past 10s grace period
      vi.advanceTimersByTime(11_000);

      const disconn = stateChanges.find((s) => s.state === 'DISCONNECTED');
      expect(disconn).toBeDefined();
      expect(disconn?.reason).toContain('lost Wi-Fi or hotspot signal');
    });

    it('Rejects sendChunk immediately when data channel is closed', async () => {
      await transport.createOfferPayloads('ses_sendchunk_test');
      mockDataChannel.readyState = 'closed';

      await expect(
        transport.sendChunk({ id: 'p1' } as any, {
          header: {
            magic: 0x50505254,
            version: 1,
            messageType: 0x01,
            transferId: 't1',
            fileId: 'f1',
            chunkIndex: 0,
            totalChunks: 1,
            payloadLength: 3
          },
          data: new Uint8Array([1, 2, 3])
        })
      ).rejects.toThrow('Air-gapped DataChannel is not open');
    });
  });
});

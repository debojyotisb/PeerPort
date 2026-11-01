import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compressSdp,
  decompressSdp,
  createQrPayloads,
  parseAndValidateQrPayload,
  QrPayloadReassembler,
  waitForIceGathering,
  pruneSdpForDataChannel,
  parseIceCandidateString,
  QR_SIGNALING_VERSION,
  DEFAULT_MAX_CHUNK_LENGTH
} from '../services/qr-signaling.js';

const MOCK_SDP = `v=0
o=- 4611731400430051253 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:K8sZ
a=ice-pwd:9xY58W3pQ1vL0rT6bN4mA2cD
a=fingerprint:sha-256 5C:42:38:D9:6A:F2:70:E3:4C:E6:AA:F1:C7:A9:72:63:F6:BC:54:6F:A0:BE:97:54:19:D3:5F:7A:B2:7C:1E:E0
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=candidate:1 1 UDP 2130706431 192.168.43.100 54321 typ host
a=candidate:2 1 UDP 2130706431 10.0.0.15 54322 typ host
a=end-of-candidates`;

const EXPECTED_PRUNED_SDP = pruneSdpForDataChannel(MOCK_SDP);

describe('Air-Gapped QR Signaling Service', () => {
  describe('SDP Pruning for DataChannel', () => {
    it('strips redundant RTP audio/video lines (a=extmap:, a=msid:, a=rtcp:)', () => {
      const verboseSdp = `${MOCK_SDP}
a=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid
a=msid-semantic: WMS
a=msid:stream1 track1
a=rtcp:9 IN IP4 0.0.0.0
a=rtcp-mux
a=rtcp-rsize`;
      const pruned = pruneSdpForDataChannel(verboseSdp);
      expect(pruned).not.toContain('a=extmap:');
      expect(pruned).not.toContain('a=msid-semantic:');
      expect(pruned).not.toContain('a=msid:');
      expect(pruned).not.toContain('a=rtcp:');
      expect(pruned).not.toContain('a=rtcp-mux');
      expect(pruned).not.toContain('a=rtcp-rsize');
      expect(pruned).toContain('a=candidate:1');
      expect(pruned).toContain('m=application');
    });
  });

  describe('parseIceCandidateString diagnostic helper', () => {
    it('correctly identifies private IP host candidate', () => {
      const cand = parseIceCandidateString('candidate:1 1 UDP 2130706431 192.168.43.100 54321 typ host');
      expect(cand).not.toBeNull();
      expect(cand?.address).toBe('192.168.43.100');
      expect(cand?.port).toBe(54321);
      expect(cand?.isPrivateIp).toBe(true);
      expect(cand?.isMdns).toBe(false);
      expect(cand?.isLoopback).toBe(false);
    });

    it('correctly identifies mDNS obfuscated candidate', () => {
      const cand = parseIceCandidateString('candidate:2 1 UDP 2130706431 a1b2c3d4-e5f6.local 54322 typ host');
      expect(cand).not.toBeNull();
      expect(cand?.address).toBe('a1b2c3d4-e5f6.local');
      expect(cand?.isMdns).toBe(true);
      expect(cand?.isPrivateIp).toBe(false);
    });

    it('correctly identifies loopback candidate', () => {
      const cand = parseIceCandidateString('candidate:3 1 UDP 2130706431 127.0.0.1 54323 typ host');
      expect(cand).not.toBeNull();
      expect(cand?.isLoopback).toBe(true);
    });
  });

  describe('SDP Deflate Compression & Decompression', () => {
    it('compresses and accurately decompresses an SDP string', async () => {
      const compressed = await compressSdp(MOCK_SDP);
      expect(typeof compressed).toBe('string');
      expect(compressed.length).toBeGreaterThan(0);
      expect(compressed.length).toBeLessThan(MOCK_SDP.length);

      const decompressed = await decompressSdp(compressed);
      expect(decompressed).toBe(MOCK_SDP);
    });

    it('achieves substantial compression ratio on realistic WebRTC SDPs', async () => {
      const fullSdp = MOCK_SDP.repeat(3); // Realistic ~1.5 KiB WebRTC session description
      const compressed = await compressSdp(fullSdp);
      expect(compressed.length / fullSdp.length).toBeLessThan(0.5);
    });
  });

  describe('createQrPayloads', () => {
    it('generates a single QR packet when payload is within max chunk length', async () => {
      const packets = await createQrPayloads('ses_123', 'offer', MOCK_SDP, 1000);
      expect(packets).toHaveLength(1);
      expect(packets[0]).toMatchObject({
        v: QR_SIGNALING_VERSION,
        sid: 'ses_123',
        type: 'offer',
        idx: 0,
        total: 1
      });
      expect(packets[0].exp).toBeGreaterThan(Date.now());
    });

    it('segments payload into multiple sequential QR packets when chunk length is restricted', async () => {
      const maxChunkLength = 100;
      const packets = await createQrPayloads('ses_456', 'answer', MOCK_SDP, maxChunkLength);
      expect(packets.length).toBeGreaterThan(1);

      packets.forEach((p, index) => {
        expect(p.v).toBe(QR_SIGNALING_VERSION);
        expect(p.sid).toBe('ses_456');
        expect(p.type).toBe('answer');
        expect(p.idx).toBe(index);
        expect(p.total).toBe(packets.length);
        expect(p.data.length).toBeLessThanOrEqual(maxChunkLength);
      });
    });

    it('rejects missing sessionId or sdp', async () => {
      await expect(createQrPayloads('', 'offer', MOCK_SDP)).rejects.toThrow();
      await expect(createQrPayloads('ses_789', 'offer', '')).rejects.toThrow();
    });
  });

  describe('parseAndValidateQrPayload', () => {
    it('successfully parses valid JSON signaling packet', async () => {
      const packets = await createQrPayloads('ses_valid', 'offer', MOCK_SDP);
      const rawText = JSON.stringify(packets[0]);

      const parsed = parseAndValidateQrPayload(rawText);
      expect(parsed.sid).toBe('ses_valid');
      expect(parsed.type).toBe('offer');
      expect(parsed.v).toBe(QR_SIGNALING_VERSION);
    });

    it('rejects oversized payloads (> 4096 bytes) for DoS protection', () => {
      const oversizedText = 'a'.repeat(4097);
      expect(() => parseAndValidateQrPayload(oversizedText)).toThrow('oversized');
    });

    it('rejects malformed non-JSON payloads', () => {
      expect(() => parseAndValidateQrPayload('invalid { json')).toThrow('not valid JSON');
    });

    it('rejects incompatible protocol versions', () => {
      const invalidVersion = JSON.stringify({
        v: 999,
        sid: 'ses_1',
        type: 'offer',
        idx: 0,
        total: 1,
        data: 'abc',
        exp: Date.now() + 60000
      });
      expect(() => parseAndValidateQrPayload(invalidVersion)).toThrow('Unsupported QR protocol version');
    });

    it('rejects expired payloads', () => {
      const expired = JSON.stringify({
        v: 1,
        sid: 'ses_1',
        type: 'offer',
        idx: 0,
        total: 1,
        data: 'abc',
        exp: Date.now() - 1000 // expired
      });
      expect(() => parseAndValidateQrPayload(expired)).toThrow('expired');
    });

    it('rejects invalid message types', () => {
      const invalidType = JSON.stringify({
        v: 1,
        sid: 'ses_1',
        type: 'unknown',
        idx: 0,
        total: 1,
        data: 'abc',
        exp: Date.now() + 60000
      });
      expect(() => parseAndValidateQrPayload(invalidType)).toThrow("expected 'offer' or 'answer'");
    });

    it('rejects invalid frame index bounds', () => {
      const outOfBounds = JSON.stringify({
        v: 1,
        sid: 'ses_1',
        type: 'offer',
        idx: 5,
        total: 2,
        data: 'abc',
        exp: Date.now() + 60000
      });
      expect(() => parseAndValidateQrPayload(outOfBounds)).toThrow('Invalid frame index bounds');
    });
  });

  describe('QrPayloadReassembler', () => {
    let reassembler: QrPayloadReassembler;

    beforeEach(() => {
      reassembler = new QrPayloadReassembler();
    });

    it('reassembles single-frame QR packet immediately', async () => {
      const packets = await createQrPayloads('ses_single', 'offer', MOCK_SDP, 2000);
      expect(packets).toHaveLength(1);

      const result = await reassembler.processPacket(packets[0]);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('ses_single');
      expect(result?.type).toBe('offer');
      expect(result?.sdp).toBe(EXPECTED_PRUNED_SDP);
    });

    it('reassembles multi-frame packets in sequential order', async () => {
      const packets = await createQrPayloads('ses_multi', 'answer', MOCK_SDP, 120);
      expect(packets.length).toBeGreaterThan(1);

      for (let i = 0; i < packets.length - 1; i++) {
        const intermediate = await reassembler.processPacket(packets[i]);
        expect(intermediate).toBeNull();
        expect(reassembler.getProgress().received).toBe(i + 1);
        expect(reassembler.getProgress().total).toBe(packets.length);
      }

      const finalResult = await reassembler.processPacket(packets[packets.length - 1]);
      expect(finalResult).not.toBeNull();
      expect(finalResult?.sessionId).toBe('ses_multi');
      expect(finalResult?.type).toBe('answer');
      expect(finalResult?.sdp).toBe(EXPECTED_PRUNED_SDP);
    });

    it('reassembles multi-frame packets received out of order', async () => {
      const packets = await createQrPayloads('ses_reversed', 'offer', MOCK_SDP, 120);
      expect(packets.length).toBeGreaterThan(1);

      // Feed chunks in reverse order
      const reversed = [...packets].reverse();
      for (let i = 0; i < reversed.length - 1; i++) {
        const intermediate = await reassembler.processPacket(reversed[i]);
        expect(intermediate).toBeNull();
      }

      const finalResult = await reassembler.processPacket(reversed[reversed.length - 1]);
      expect(finalResult).not.toBeNull();
      expect(finalResult?.sdp).toBe(EXPECTED_PRUNED_SDP);
    });

    it('safely handles duplicate scans of the same frame without double-counting', async () => {
      const packets = await createQrPayloads('ses_dup', 'offer', MOCK_SDP, 120);
      expect(packets.length).toBeGreaterThan(1);

      // Feed frame 0 twice
      await reassembler.processPacket(packets[0]);
      await reassembler.processPacket(packets[0]);
      expect(reassembler.getProgress().received).toBe(1);

      // Complete the remaining frames
      for (let i = 1; i < packets.length - 1; i++) {
        await reassembler.processPacket(packets[i]);
      }
      const result = await reassembler.processPacket(packets[packets.length - 1]);
      expect(result?.sdp).toBe(EXPECTED_PRUNED_SDP);
    });

    it('rejects mismatched session IDs when expectedSessionId is specified', async () => {
      const packets = await createQrPayloads('ses_alice', 'offer', MOCK_SDP);
      await expect(reassembler.processPacket(packets[0], 'ses_bob')).rejects.toThrow('Mismatched session ID');
    });
  });

  describe('waitForIceGathering', () => {
    it('resolves immediately when iceGatheringState is already complete', async () => {
      const mockPc = {
        iceGatheringState: 'complete',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      } as unknown as RTCPeerConnection;

      const promise = waitForIceGathering(mockPc);
      await expect(promise).resolves.toBeUndefined();
      expect(mockPc.addEventListener).not.toHaveBeenCalled();
    });

    it('resolves when icegatheringstatechange fires and state becomes complete', async () => {
      let listener: (() => void) | null = null;
      const mockPc = {
        iceGatheringState: 'gathering',
        addEventListener: vi.fn((event, fn) => {
          if (event === 'icegatheringstatechange') listener = fn;
        }),
        removeEventListener: vi.fn()
      } as unknown as RTCPeerConnection;

      const promise = waitForIceGathering(mockPc, 2000);

      // Simulate completion event
      setTimeout(() => {
        (mockPc as any).iceGatheringState = 'complete';
        listener?.();
      }, 50);

      await expect(promise).resolves.toBeUndefined();
      expect(mockPc.removeEventListener).toHaveBeenCalledWith('icegatheringstatechange', expect.any(Function));
    });

    it('resolves cleanly after timeout if ice gathering stalls', async () => {
      const mockPc = {
        iceGatheringState: 'gathering',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      } as unknown as RTCPeerConnection;

      // Use a short 50ms timeout for the test
      const start = Date.now();
      await waitForIceGathering(mockPc, 50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(mockPc.removeEventListener).toHaveBeenCalledWith('icegatheringstatechange', expect.any(Function));
    });
  });
});

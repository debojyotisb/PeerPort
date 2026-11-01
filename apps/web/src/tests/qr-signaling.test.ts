import { describe, it, expect, vi, beforeEach } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  compressSdp,
  decompressSdp,
  createQrPayloads,
  parseAndValidateQrPayload,
  QrPayloadReassembler,
  waitForIceGathering,
  pruneSdpForDataChannel,
  parseIceCandidateString,
  unmaskMdnsCandidateIfKnown,
  QR_SIGNALING_VERSION,
  QrSignalingPacket,
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
    it('generates a compact single QR packet when payload can be compacted', async () => {
      const packets = await createQrPayloads('ses_123', 'offer', MOCK_SDP, 1000);
      expect(packets).toHaveLength(1);
      expect(packets[0]).toMatchObject({
        v: 2,
        sid: 'ses_123',
        type: 'offer'
      });
      expect(packets[0].exp).toBeGreaterThan(Date.now());
    });

    it('falls back to Deflate single QR packet when compact extraction is not applicable', async () => {
      const nonCompactSdp = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP 5000\r\n';
      const packets = await createQrPayloads('ses_deflate', 'offer', nonCompactSdp, 1000);
      expect(packets).toHaveLength(1);
      expect(packets[0]).toMatchObject({
        v: QR_SIGNALING_VERSION,
        sid: 'ses_deflate',
        type: 'offer',
        idx: 0,
        total: 1
      });
    });

    it('segments payload into multiple sequential QR packets when chunk length is restricted', async () => {
      const maxChunkLength = 100;
      const packets = await createQrPayloads('ses_456', 'answer', MOCK_SDP, maxChunkLength);
      expect(packets.length).toBeGreaterThan(1);

      packets.forEach((p, index) => {
        expect(p.v).toBe(QR_SIGNALING_VERSION);
        expect(p.sid).toBe('ses_456');
        expect(p.type).toBe('answer');
        expect((p as any).idx).toBe(index);
        expect((p as any).total).toBe(packets.length);
        expect((p as any).data.length).toBeLessThanOrEqual(maxChunkLength);
      });
    });

    it('rejects missing sessionId or sdp', async () => {
      await expect(createQrPayloads('', 'offer', MOCK_SDP)).rejects.toThrow();
      await expect(createQrPayloads('ses_789', 'offer', '')).rejects.toThrow();
    });
  });

  describe('parseAndValidateQrPayload', () => {
    it('successfully parses valid JSON signaling packet (compact v2 and deflate v1)', async () => {
      // Test compact v2
      const compactPackets = await createQrPayloads('ses_valid_v2', 'offer', MOCK_SDP);
      const parsedCompact = parseAndValidateQrPayload(JSON.stringify(compactPackets[0]));
      expect(parsedCompact.sid).toBe('ses_valid_v2');
      expect(parsedCompact.type).toBe('offer');
      expect(parsedCompact.v).toBe(2);

      // Test deflate v1
      const legacyPacket: QrSignalingPacket = {
        v: QR_SIGNALING_VERSION,
        sid: 'ses_valid_v1',
        type: 'offer',
        idx: 0,
        total: 1,
        data: 'compressed_base64_data',
        exp: Date.now() + 60000
      };
      const parsedLegacy = parseAndValidateQrPayload(JSON.stringify(legacyPacket));
      expect(parsedLegacy.sid).toBe('ses_valid_v1');
      expect(parsedLegacy.type).toBe('offer');
      expect(parsedLegacy.v).toBe(QR_SIGNALING_VERSION);
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
      expect(result?.sdp).toContain('a=ice-ufrag:K8sZ');
      expect(result?.sdp).toContain('a=ice-pwd:9xY58W3pQ1vL0rT6bN4mA2cD');
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

  describe('unmaskMdnsCandidateIfKnown', () => {
    it('injects unmasked candidate line and updates c= line when mDNS candidates are present and fallback IP is provided', () => {
      const mdnsSdp = `v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 UDP 2130706431 8f92-4f32.local 54321 typ host\r\na=end-of-candidates\r\n`;
      const unmasked = unmaskMdnsCandidateIfKnown(mdnsSdp, '192.168.43.50');

      expect(unmasked).toContain('a=candidate:1 1 UDP 2130706431 192.168.43.50 54321 typ host');
      expect(unmasked).toContain('a=candidate:1 1 UDP 2130706431 8f92-4f32.local 54321 typ host');
      expect(unmasked).toContain('c=IN IP4 192.168.43.50');
    });

    it('preserves SDP untouched when fallback IP is loopback or invalid', () => {
      const mdnsSdp = `v=0\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 UDP 2130706431 8f92-4f32.local 54321 typ host\r\n`;
      const untouched1 = unmaskMdnsCandidateIfKnown(mdnsSdp, '127.0.0.1');
      expect(untouched1).toBe(mdnsSdp);

      const untouched2 = unmaskMdnsCandidateIfKnown(mdnsSdp, 'invalid-ip');
      expect(untouched2).toBe(mdnsSdp);
    });

    it('does not inject duplicates if candidates are already non-mDNS', () => {
      const normalSdp = `v=0\r\nc=IN IP4 192.168.1.10\r\na=candidate:1 1 UDP 2130706431 192.168.1.10 54321 typ host\r\n`;
      const result = unmaskMdnsCandidateIfKnown(normalSdp, '192.168.43.50');
      expect(result).not.toContain('192.168.43.50');
      expect(result).toContain('192.168.1.10');
    });
  });

  describe('jsQR Compatibility & End-to-End Decode', () => {
    it('successfully decodes a generated single-frame QR packet using jsQR and verifies SDP reconstruction', async () => {
      const packets = await createQrPayloads('ses_e2e_jsqr', 'offer', MOCK_SDP);
      expect(packets).toHaveLength(1);
      const jsonText = JSON.stringify(packets[0]);

      // Generate QR matrix
      const qr = QRCode.create(jsonText, { errorCorrectionLevel: 'L' });
      const size = qr.modules.size;
      const margin = 4;
      const scale = 4;
      const width = (size + margin * 2) * scale;
      const height = width;
      const buffer = new Uint8ClampedArray(width * height * 4);
      buffer.fill(255); // White background

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (qr.modules.get(r, c)) {
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const x = (c + margin) * scale + dx;
                const y = (r + margin) * scale + dy;
                const idx = (y * width + x) * 4;
                buffer[idx] = 0;
                buffer[idx + 1] = 0;
                buffer[idx + 2] = 0;
                buffer[idx + 3] = 255;
              }
            }
          }
        }
      }

      const decoded = jsQR(buffer, width, height, { inversionAttempts: 'attemptBoth' });
      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(jsonText);

      // Verify that decoded QR packet validates and reassembles back to valid SDP
      const parsedPacket = parseAndValidateQrPayload(decoded!.data);
      expect(parsedPacket.sid).toBe('ses_e2e_jsqr');
      const reassembler = new QrPayloadReassembler();
      const result = await reassembler.processPacket(parsedPacket);
      expect(result?.sessionId).toBe('ses_e2e_jsqr');
      expect(result?.type).toBe('offer');
      expect(result?.sdp).toContain('a=ice-ufrag:K8sZ');
      expect(result?.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    });
  });
});

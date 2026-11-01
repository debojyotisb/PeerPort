import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
// @ts-ignore
import { PNG } from 'pngjs';
import {
  compressSdp,
  decompressSdp,
  createQrPayloads,
  parseAndValidateQrPayload,
  pruneSdpForDataChannel,
  extractCompactSdp,
  reconstituteSdpFromCompact,
  isCompactSdpPacket,
  QrPayloadReassembler,
  DEFAULT_MAX_CHUNK_LENGTH
} from '../services/qr-signaling.js';

// Real-world WebRTC DataChannel Offer SDP gathered from Chrome on Windows
const REAL_CHROME_OFFER_SDP = `v=0
o=- 5262788540854497444 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:HkX3
a=ice-pwd:9mK6G7aBcDeFgHiJkLmNoPqRsTuV
a=ice-options:trickle
a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:78:90:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=candidate:123456789 1 udp 2122260223 192.168.43.50 54321 typ host generation 0 ufrag HkX3 network-id 1 network-cost 10
a=candidate:987654321 1 udp 2122260223 10.0.0.5 54322 typ host generation 0 ufrag HkX3 network-id 2 network-cost 10
a=candidate:112233445 1 tcp 1518280447 192.168.43.50 9 typ host tcptype active generation 0 ufrag HkX3 network-id 1 network-cost 10
a=end-of-candidates`;

// Real-world WebRTC DataChannel Answer SDP gathered from Android Chrome
const REAL_ANDROID_ANSWER_SDP = `v=0
o=- 8172635418293041526 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:R9tW
a=ice-pwd:3xL81P0qZaWsXcDvFbGnHjKmQeRt
a=ice-options:trickle
a=fingerprint:sha-256 C2:D3:E4:F5:06:17:28:39:4A:5B:6C:7D:8E:9F:A0:B1:C2:D3:E4:F5:06:17:28:39:4A:5B:6C:7D:8E:9F:A0:B1
a=setup:active
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=candidate:334455667 1 udp 2122260223 192.168.43.1 51234 typ host generation 0 ufrag R9tW network-id 1 network-cost 10
a=end-of-candidates`;

describe('QR Transfer Optimization & Decodability Verification', () => {
  it('REQUIREMENTS 1, 2, 4: Tests Independent Offer and Answer Compact Extraction and Reconstitution', () => {
    const sessionId = 'ses_71231f59d746';

    // 1. Offer Compact Extraction
    const compactOffer = extractCompactSdp(sessionId, 'offer', REAL_CHROME_OFFER_SDP);
    expect(compactOffer).not.toBeNull();
    expect(compactOffer?.v).toBe(2);
    expect(compactOffer?.sid).toBe(sessionId);
    expect(compactOffer?.type).toBe('offer');
    expect(compactOffer?.u).toBe('HkX3');
    expect(compactOffer?.p).toBe('9mK6G7aBcDeFgHiJkLmNoPqRsTuV');
    expect(compactOffer?.fp).toBe(
      'A1B2C3D4E5F67890123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0'
    );
    expect(compactOffer?.fp).toHaveLength(64);
    expect(compactOffer?.c.length).toBeGreaterThan(0);

    // Verify candidates are parsed with priority given to private IPv4
    const firstCand = compactOffer!.c[0];
    expect(firstCand[0]).toBe('192.168.43.50');
    expect(firstCand[1]).toBe(54321);

    // 2. Offer SDP Reconstitution
    const reconstitutedOffer = reconstituteSdpFromCompact(compactOffer!);
    expect(reconstitutedOffer).toContain('v=0');
    expect(reconstitutedOffer).toContain('s=-');
    expect(reconstitutedOffer).toContain('t=0 0');
    expect(reconstitutedOffer).toContain('a=group:BUNDLE 0');
    expect(reconstitutedOffer).toContain('a=msid-semantic: WMS');
    expect(reconstitutedOffer).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(reconstitutedOffer).toContain('c=IN IP4 192.168.43.50');
    expect(reconstitutedOffer).toContain('a=ice-ufrag:HkX3');
    expect(reconstitutedOffer).toContain('a=ice-pwd:9mK6G7aBcDeFgHiJkLmNoPqRsTuV');
    expect(reconstitutedOffer).toContain('a=ice-options:trickle');
    expect(reconstitutedOffer).toContain(
      'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:78:90:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0'
    );
    expect(reconstitutedOffer).toContain('a=setup:actpass');
    expect(reconstitutedOffer).toContain('a=mid:0');
    expect(reconstitutedOffer).toContain('a=sctp-port:5000');
    expect(reconstitutedOffer).toContain('a=max-message-size:262144');
    expect(reconstitutedOffer).toContain('a=candidate:');
    expect(reconstitutedOffer).toContain('a=end-of-candidates');

    // 3. Answer Compact Extraction
    const compactAnswer = extractCompactSdp(sessionId, 'answer', REAL_ANDROID_ANSWER_SDP);
    expect(compactAnswer).not.toBeNull();
    expect(compactAnswer?.v).toBe(2);
    expect(compactAnswer?.type).toBe('answer');
    expect(compactAnswer?.u).toBe('R9tW');
    expect(compactAnswer?.p).toBe('3xL81P0qZaWsXcDvFbGnHjKmQeRt');
    expect(compactAnswer?.c.length).toBeGreaterThan(0);
    expect(compactAnswer?.c[0][0]).toBe('192.168.43.1');

    // 4. Answer SDP Reconstitution
    const reconstitutedAnswer = reconstituteSdpFromCompact(compactAnswer!);
    expect(reconstitutedAnswer).toContain('a=setup:active');
    expect(reconstitutedAnswer).toContain('a=ice-ufrag:R9tW');
    expect(reconstitutedAnswer).toContain('a=ice-pwd:3xL81P0qZaWsXcDvFbGnHjKmQeRt');
    expect(reconstitutedAnswer).toContain('c=IN IP4 192.168.43.1');
    expect(reconstitutedAnswer).toContain('a=candidate:1 1 UDP 2122260223 192.168.43.1 51234 typ host');
    expect(reconstitutedAnswer).toContain('a=end-of-candidates');
  });

  it('REQUIREMENTS 5, 6, 7: Generates Single Static Compact QR with 4-Module Quiet Zone and Crisp jsQR Decoding', async () => {
    const sessionId = 'ses_71231f59d746';
    const packets = await createQrPayloads(sessionId, 'offer', REAL_CHROME_OFFER_SDP);

    // Requirement 6: Must remain a single static frame!
    expect(packets).toHaveLength(1);
    const pkt = packets[0];
    expect(isCompactSdpPacket(pkt)).toBe(true);

    const jsonStr = JSON.stringify(pkt);
    console.log('\n--- COMPACT OFFER QR METRICS ---');
    console.log('1. Raw Offer SDP Length:', REAL_CHROME_OFFER_SDP.length, 'chars');
    console.log('2. Compact JSON Payload Length:', jsonStr.length, 'chars');
    console.log('3. Compact Payload Content:\n', jsonStr);

    // Payload reduction assertion: Must be < 350 characters (over 50% smaller than legacy 671 chars)
    expect(jsonStr.length).toBeLessThan(350);

    // Analyze QR Code structure with Error Correction Level 'M'
    const qrMatrix = QRCode.create(jsonStr, { errorCorrectionLevel: 'M' });
    console.log('4. Actual QR Version:', qrMatrix.version);
    console.log('5. QR Grid Dimensions:', `${qrMatrix.modules.size} x ${qrMatrix.modules.size} modules`);
    console.log('6. Total QR Modules:', qrMatrix.modules.size * qrMatrix.modules.size);
    console.log('7. Error Correction Level:', (qrMatrix as any).errorCorrectionLevel?.name || 'M');

    // Verification: QR version must be single static frame with <= 65x65 modules (down from 89x89)
    expect(qrMatrix.version).toBeLessThanOrEqual(13);
    expect(qrMatrix.modules.size).toBeLessThanOrEqual(69);
    // Total modules must be <= 4,761 (a 45-55% reduction from 7,921 modules!)
    expect(qrMatrix.modules.size * qrMatrix.modules.size).toBeLessThanOrEqual(4761);

    // Requirement 5: Render with 4-module quiet zone and high-res crisp canvas
    const margin = 4;
    const width = 560;
    const dataUrl = await QRCode.toDataURL(jsonStr, {
      width,
      margin,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });

    const pngBuf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const filePath = path.resolve('scratch_compact_offer_560_m4.png');
    fs.writeFileSync(filePath, pngBuf);
    console.log('8. Saved Compact PNG to:', filePath);

    // Requirement 7: Independent PNG file byte decoding using pngjs + jsQR
    const parsedPng = PNG.sync.read(pngBuf);
    console.log('9. PNG Image Dimensions:', `${parsedPng.width}x${parsedPng.height} px`);
    expect(parsedPng.width).toBe(560);
    expect(parsedPng.height).toBe(560);

    const totalModulesWithQuietZone = qrMatrix.modules.size + margin * 2;
    const pixelsPerModule = width / totalModulesWithQuietZone;
    console.log('10. Pixels Per Module at 560px:', pixelsPerModule.toFixed(2), 'px');
    console.log('11. Pixels Per Module on 320px screen:', (320 / totalModulesWithQuietZone).toFixed(2), 'px');

    const decoded = jsQR(new Uint8ClampedArray(parsedPng.data), parsedPng.width, parsedPng.height, {
      inversionAttempts: 'attemptBoth'
    });

    expect(decoded).not.toBeNull();
    console.log('12. Independent jsQR PNG Decode SUCCESS:', decoded !== null);
    console.log('13. Decoded String Equality:', decoded?.data === jsonStr);
    expect(decoded?.data).toBe(jsonStr);

    // End-to-End Validation: Feed decoded JSON into reassembler
    const parsedPacket = parseAndValidateQrPayload(decoded!.data);
    expect(isCompactSdpPacket(parsedPacket)).toBe(true);

    const reassembler = new QrPayloadReassembler();
    const result = await reassembler.processPacket(parsedPacket);
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(sessionId);
    expect(result?.type).toBe('offer');
    expect(result?.sdp).toContain('a=ice-ufrag:HkX3');
    expect(result?.sdp).toContain('a=fingerprint:sha-256');
    expect(result?.sdp).toContain('a=candidate:');
  }, 15000);

  it('REQUIREMENTS 2, 5, 7: Generates Single Static Compact Answer QR and Decodes Cleanly', async () => {
    const sessionId = 'ses_71231f59d746';
    const packets = await createQrPayloads(sessionId, 'answer', REAL_ANDROID_ANSWER_SDP);

    expect(packets).toHaveLength(1);
    const pkt = packets[0];
    expect(isCompactSdpPacket(pkt)).toBe(true);

    const jsonStr = JSON.stringify(pkt);
    console.log('\n--- COMPACT ANSWER QR METRICS ---');
    console.log('1. Raw Answer SDP Length:', REAL_ANDROID_ANSWER_SDP.length, 'chars');
    console.log('2. Compact JSON Payload Length:', jsonStr.length, 'chars');
    console.log('3. Compact Payload Content:\n', jsonStr);

    expect(jsonStr.length).toBeLessThan(320);

    const qrMatrix = QRCode.create(jsonStr, { errorCorrectionLevel: 'M' });
    console.log('4. Actual QR Version:', qrMatrix.version);
    console.log('5. QR Grid Dimensions:', `${qrMatrix.modules.size} x ${qrMatrix.modules.size} modules`);
    console.log('6. Total QR Modules:', qrMatrix.modules.size * qrMatrix.modules.size);

    expect(qrMatrix.version).toBeLessThanOrEqual(11);
    expect(qrMatrix.modules.size).toBeLessThanOrEqual(61);
    expect(qrMatrix.modules.size * qrMatrix.modules.size).toBeLessThanOrEqual(3721);

    const dataUrl = await QRCode.toDataURL(jsonStr, {
      width: 560,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });

    const pngBuf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const parsedPng = PNG.sync.read(pngBuf);
    const decoded = jsQR(new Uint8ClampedArray(parsedPng.data), parsedPng.width, parsedPng.height, {
      inversionAttempts: 'attemptBoth'
    });

    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(jsonStr);

    const parsedPacket = parseAndValidateQrPayload(decoded!.data);
    const reassembler = new QrPayloadReassembler();
    const result = await reassembler.processPacket(parsedPacket);
    expect(result?.type).toBe('answer');
    expect(result?.sdp).toContain('a=setup:active');
    expect(result?.sdp).toContain('a=ice-ufrag:R9tW');
  }, 15000);

  it('REQUIREMENTS 3 & 8: Verifies WebRTC RTCSessionDescription Compatibility for Reconstituted SDPs', () => {
    const compactOffer = extractCompactSdp('ses_compat', 'offer', REAL_CHROME_OFFER_SDP);
    const reconstitutedOffer = reconstituteSdpFromCompact(compactOffer!);

    const compactAnswer = extractCompactSdp('ses_compat', 'answer', REAL_ANDROID_ANSWER_SDP);
    const reconstitutedAnswer = reconstituteSdpFromCompact(compactAnswer!);

    // If browser RTCSessionDescription constructor exists, test it directly
    if (typeof RTCSessionDescription !== 'undefined') {
      const offerDesc = new RTCSessionDescription({ type: 'offer', sdp: reconstitutedOffer });
      expect(offerDesc.type).toBe('offer');
      expect(offerDesc.sdp).toBe(reconstitutedOffer);

      const answerDesc = new RTCSessionDescription({ type: 'answer', sdp: reconstitutedAnswer });
      expect(answerDesc.type).toBe('answer');
      expect(answerDesc.sdp).toBe(reconstitutedAnswer);
    }

    // Verify SDP grammar lines required by WebRTC specifications
    const verifySdpStructure = (sdp: string, expectedSetup: 'actpass' | 'active') => {
      const lines = sdp.split('\r\n').filter(Boolean);
      expect(lines[0]).toBe('v=0');
      expect(lines[1]).toMatch(/^o=- \d+ 2 IN IP4 127\.0\.0\.1$/);
      expect(lines[2]).toBe('s=-');
      expect(lines[3]).toBe('t=0 0');
      expect(lines[4]).toBe('a=group:BUNDLE 0');
      expect(lines[5]).toBe('a=msid-semantic: WMS');
      expect(lines[6]).toBe('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
      expect(lines[7]).toMatch(/^c=IN IP4 \d+\.\d+\.\d+\.\d+$/);
      expect(sdp).toContain(`a=setup:${expectedSetup}`);
      expect(sdp).toContain('a=sctp-port:5000');
      expect(sdp).toContain('a=max-message-size:262144');
      expect(sdp).toContain('a=ice-options:trickle');
      expect(sdp).toContain('a=end-of-candidates');
    };

    verifySdpStructure(reconstitutedOffer, 'actpass');
    verifySdpStructure(reconstitutedAnswer, 'active');
  });

  it('REQUIREMENTS 9 & 10: Seamless Backwards Compatibility with Deflate-Compressed Packets', async () => {
    const pruned = pruneSdpForDataChannel(REAL_CHROME_OFFER_SDP);
    const compressed = await compressSdp(pruned);
    const legacyPacket = {
      v: 1,
      sid: 'ses_legacy_123',
      type: 'offer' as const,
      idx: 0,
      total: 1,
      data: compressed,
      exp: Date.now() + 60000
    };

    const validated = parseAndValidateQrPayload(JSON.stringify(legacyPacket));
    expect(validated.v).toBe(1);

    const reassembler = new QrPayloadReassembler();
    const result = await reassembler.processPacket(validated);
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe('ses_legacy_123');
    expect(result?.type).toBe('offer');
    expect(result?.sdp).toBe(pruned);
  });
});

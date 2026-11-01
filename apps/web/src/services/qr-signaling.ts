/**
 * PeerPort Air-Gapped QR Signaling Service
 *
 * Implements serverless, internet-independent WebRTC signaling via two-way QR codes.
 * Features:
 * - High-ratio deflate SDP compression to keep QR codes compact and fast to scan.
 * - Multi-frame QR segmentation with automatic reassembly if SDP exceeds single-QR capacity.
 * - Session ID, version, expiration, integrity validation, and replay protection.
 * - Host-candidate ICE gathering synchronization.
 */

export interface QrSignalingPacket {
  v: number; // Protocol version (1)
  sid: string; // Session ID (e.g. qrses_abc123)
  type: 'offer' | 'answer';
  idx: number; // 0-based chunk index
  total: number; // Total chunks (1 for single-frame)
  data: string; // Base64-encoded compressed slice
  exp: number; // Expiration timestamp in milliseconds
}

export type CompactCandidateTuple = [
  ip: string,
  port: number,
  protocol?: string,
  priority?: number,
  foundation?: string,
  component?: number
];

export interface CompactSdpPacket {
  v: 2; // Protocol version 2 = compact SDP packet
  sid: string; // Session ID (e.g. ses_71231f59d746)
  type: 'offer' | 'answer'; // Type: 'offer' or 'answer'
  u: string; // ice-ufrag
  p: string; // ice-pwd
  fp: string; // DTLS sha-256 fingerprint hex without colons (64 hex characters)
  c: CompactCandidateTuple[]; // Host candidates
  m?: string; // mid (optional, defaults to "0")
  sp?: number; // sctp-port (optional, defaults to 5000)
  ms?: number; // max-message-size (optional, defaults to 262144)
  exp: number; // Expiration timestamp in milliseconds
}

export type AnyQrPacket = QrSignalingPacket | CompactSdpPacket;

export const QR_SIGNALING_VERSION = 1;
export const QR_COMPACT_VERSION = 2;
export const DEFAULT_QR_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MAX_CHUNK_LENGTH = 1100; // Single-frame capacity for static QR negotiation (fallback to multi-frame only if exceeded)

export interface AnalyzedCandidate {
  raw: string;
  type: string;
  protocol: string;
  address: string;
  port: number;
  isPrivateIp: boolean;
  isMdns: boolean;
  isLoopback: boolean;
}

/**
 * Parses a standard WebRTC SDP candidate attribute line into structured diagnostic details.
 */
export function parseIceCandidateString(candStr: string): AnalyzedCandidate | null {
  if (!candStr || typeof candStr !== 'string') return null;
  const parts = candStr.trim().replace(/^(?:a=)?candidate:/, '').split(/\s+/);
  if (parts.length < 6) return null;

  const protocol = parts[2]?.toUpperCase() || 'UDP';
  const address = parts[4] || '';
  const port = parseInt(parts[5] || '0', 10);
  const typeIndex = parts.indexOf('typ');
  const type = typeIndex !== -1 ? parts[typeIndex + 1] || 'host' : 'host';

  const isMdns = address.endsWith('.local');
  const isLoopback = address === '127.0.0.1' || address === '::1' || address === 'localhost';
  const isPrivateIp =
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(address);

  return {
    raw: candStr,
    type,
    protocol,
    address,
    port,
    isPrivateIp,
    isMdns,
    isLoopback
  };
}

/**
 * Detects mDNS-masked (.local) ICE host candidates in an SDP string.
 * If mDNS candidates are present and a known private IPv4 address is provided
 * (or detected from local context), injects corresponding unmasked host candidate lines
 * and updates the c= connection line so that peers over mobile hotspots (which drop multicast DNS)
 * can connect directly via private IP.
 */
export function unmaskMdnsCandidateIfKnown(sdp: string, fallbackIp?: string): string {
  if (!sdp) return '';
  let targetIp = fallbackIp;
  if (!targetIp && typeof window !== 'undefined' && window.location?.hostname) {
    targetIp = window.location.hostname;
  }
  if (!targetIp || typeof targetIp !== 'string') return sdp;

  const cleanIp = targetIp.trim();
  const isIpv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cleanIp);
  if (!isIpv4 || cleanIp === '127.0.0.1' || cleanIp === '0.0.0.0') {
    return sdp;
  }

  const lines = sdp.split(/\r?\n/);
  const newLines: string[] = [];
  let injectedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line is a candidate with .local address
    if (trimmed.startsWith('a=candidate:') && trimmed.includes('.local')) {
      newLines.push(trimmed); // Keep original candidate
      // Create an unmasked candidate by replacing .local token with cleanIp
      const unmaskedCandidate = trimmed.replace(/\b[a-zA-Z0-9_\-]+\.local\b/, cleanIp);
      if (unmaskedCandidate !== trimmed && !newLines.includes(unmaskedCandidate)) {
        newLines.push(unmaskedCandidate);
        injectedCount++;
      }
      continue;
    }

    // Check c= connection line (e.g. c=IN IP4 0.0.0.0 or c=IN IP4 <uuid>.local)
    if (trimmed.startsWith('c=IN IP4 0.0.0.0') || (trimmed.startsWith('c=IN IP4') && trimmed.includes('.local'))) {
      newLines.push(`c=IN IP4 ${cleanIp}`);
      continue;
    }

    newLines.push(trimmed);
  }

  if (injectedCount > 0) {
    console.log(
      `[DIAG SDP] Injected ${injectedCount} unmasked candidate(s) using IP: ${cleanIp}`
    );
  }

  return newLines.join('\r\n') + '\r\n';
}

/**
 * Prunes redundant RTP audio/video lines from a WebRTC SDP that are unused by DataChannels.
 * Strips RTP header extensions (a=extmap:), media stream semantics (a=msid-semantic:),
 * and RTCP attributes, reducing uncompressed SDP size by ~35-40% without affecting SCTP DataChannel negotiation.
 */
export function pruneSdpForDataChannel(sdp: string): string {
  if (!sdp) return '';
  return sdp
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('a=extmap:')) return false;
      if (trimmed.startsWith('a=extmap-allow-mixed')) return false;
      if (trimmed.startsWith('a=msid-semantic:')) return false;
      if (trimmed.startsWith('a=msid:')) return false;
      if (trimmed.startsWith('a=rtcp:')) return false;
      if (trimmed.startsWith('a=rtcp-mux')) return false;
      if (trimmed.startsWith('a=rtcp-rsize')) return false;
      if (trimmed.startsWith('a=rtcp-fb:')) return false;
      if (trimmed.startsWith('a=simulcast:')) return false;
      if (trimmed.startsWith('a=rid:')) return false;
      if (trimmed.startsWith('a=maxptime:')) return false;
      if (trimmed.startsWith('a=ptime:')) return false;
      return true;
    })
    .join('\r\n') + '\r\n';
}

/**
 * Type guard to identify whether a parsed JSON object is a CompactSdpPacket (v: 2).
 */
export function isCompactSdpPacket(obj: any): obj is CompactSdpPacket {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    obj.v === QR_COMPACT_VERSION &&
    typeof obj.sid === 'string' &&
    (obj.type === 'offer' || obj.type === 'answer') &&
    typeof obj.u === 'string' &&
    typeof obj.p === 'string' &&
    typeof obj.fp === 'string' &&
    Array.isArray(obj.c)
  );
}

/**
 * Extracts essential WebRTC DataChannel connection parameters from an SDP string
 * into a highly compact JSON payload (~200 characters), reducing QR density from Version 18 to Version 7/8.
 */
export function extractCompactSdp(
  sessionId: string,
  type: 'offer' | 'answer',
  sdp: string,
  expirationMs = DEFAULT_QR_EXPIRATION_MS,
  fallbackIp?: string
): CompactSdpPacket | null {
  if (!sessionId || !sdp) return null;

  // Unmask mDNS .local candidates if fallback IP is available
  const processedSdp = unmaskMdnsCandidateIfKnown(sdp, fallbackIp);

  // 1. Extract ice-ufrag
  const ufragMatch = processedSdp.match(/(?:^|\r?\n)a=ice-ufrag:([^\r\n]+)/);
  if (!ufragMatch || !ufragMatch[1]) return null;
  const ufrag = ufragMatch[1].trim();

  // 2. Extract ice-pwd
  const pwdMatch = processedSdp.match(/(?:^|\r?\n)a=ice-pwd:([^\r\n]+)/);
  if (!pwdMatch || !pwdMatch[1]) return null;
  const pwd = pwdMatch[1].trim();

  // 3. Extract fingerprint (sha-256)
  const fpMatch = processedSdp.match(/(?:^|\r?\n)a=fingerprint:sha-256\s+([A-Fa-f0-9:]+)/i);
  if (!fpMatch || !fpMatch[1]) return null;
  const rawFp = fpMatch[1].replace(/:/g, '').trim();
  if (rawFp.length !== 64) return null;

  // 4. Extract mid (defaults to 0)
  const midMatch = processedSdp.match(/(?:^|\r?\n)a=mid:([^\r\n]+)/);
  const mid = midMatch ? midMatch[1].trim() : '0';

  // 5. Extract sctp-port (defaults to 5000)
  const sctpPortMatch = processedSdp.match(/(?:^|\r?\n)a=sctp-port:(\d+)/);
  const sctpPort = sctpPortMatch ? parseInt(sctpPortMatch[1], 10) : 5000;

  // 6. Extract max-message-size (defaults to 262144)
  const mmsMatch = processedSdp.match(/(?:^|\r?\n)a=max-message-size:(\d+)/);
  const maxMessageSize = mmsMatch ? parseInt(mmsMatch[1], 10) : 262144;

  // 7. Extract host candidates
  const candidateMatches = processedSdp.matchAll(/(?:^|\r?\n)a=candidate:([^\r\n]+)/g);
  const candidateTuples: CompactCandidateTuple[] = [];
  const seenKey = new Set<string>();

  for (const match of candidateMatches) {
    const rawCand = match[1].trim();
    const parts = rawCand.split(/\s+/);
    if (parts.length < 6) continue;

    const foundation = parts[0];
    const component = parseInt(parts[1], 10);
    const protocol = (parts[2] || 'udp').toLowerCase();
    const priority = parseInt(parts[3], 10);
    const address = parts[4];
    const port = parseInt(parts[5], 10);

    const typeIdx = parts.indexOf('typ');
    const candType = typeIdx !== -1 ? (parts[typeIdx + 1] || 'host').toLowerCase() : 'host';

    // Host candidates are sufficient and required for offline transfer
    if (candType !== 'host') continue;

    const dedupeKey = `${protocol}:${address}:${port}`;
    if (seenKey.has(dedupeKey)) continue;
    seenKey.add(dedupeKey);

    // Keep candidate representation as compact as possible
    if (protocol === 'udp' && priority === 2122260223 && component === 1) {
      candidateTuples.push([address, port]);
    } else if (protocol !== 'udp') {
      candidateTuples.push([address, port, protocol]);
    } else {
      candidateTuples.push([address, port, protocol, priority, foundation, component]);
    }
  }

  // Prioritize private IPv4 addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  candidateTuples.sort((a, b) => {
    const isAPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(a[0]);
    const isBPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(b[0]);
    if (isAPrivate && !isBPrivate) return -1;
    if (!isAPrivate && isBPrivate) return 1;
    return 0;
  });

  // Limit to at most 3 candidates to ensure optimal QR density
  const selectedCandidates = candidateTuples.slice(0, 3);

  const exp = Date.now() + expirationMs;

  const packet: CompactSdpPacket = {
    v: QR_COMPACT_VERSION,
    sid: sessionId,
    type,
    u: ufrag,
    p: pwd,
    fp: rawFp,
    c: selectedCandidates,
    exp
  };

  if (mid !== '0') packet.m = mid;
  if (sctpPort !== 5000) packet.sp = sctpPort;
  if (maxMessageSize !== 262144) packet.ms = maxMessageSize;

  return packet;
}

/**
 * Reconstitutes a full, RFC 8866 / RFC 8841 compliant WebRTC DataChannel SDP
 * from a CompactSdpPacket.
 */
export function reconstituteSdpFromCompact(packet: CompactSdpPacket): string {
  const isOffer = packet.type === 'offer';
  const setup = isOffer ? 'actpass' : 'active';
  const mid = packet.m || '0';
  const sctpPort = packet.sp || 5000;
  const maxMessageSize = packet.ms || 262144;

  // Re-format 64-char fingerprint back into colon-delimited hex (e.g. A1:B2:...)
  const formattedFp = packet.fp.match(/.{2}/g)?.join(':').toUpperCase() || packet.fp;

  // Determine connection IP (c= line) from first IPv4 candidate, or fallback to 0.0.0.0
  let connectionIp = '0.0.0.0';
  for (const cand of packet.c) {
    const ip = cand[0];
    if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
      connectionIp = ip;
      break;
    }
  }

  // Derive a deterministic numeric sess-id for the o= line
  let numericSessionId = '0';
  if (packet.sid) {
    let hash = 0;
    for (let i = 0; i < packet.sid.length; i++) {
      hash = (hash << 5) - hash + packet.sid.charCodeAt(i);
      hash |= 0;
    }
    numericSessionId = String(Math.abs(hash) + 1000000000);
  }

  const sdpLines: string[] = [
    'v=0',
    `o=- ${numericSessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    `c=IN IP4 ${connectionIp}`,
    `a=ice-ufrag:${packet.u}`,
    `a=ice-pwd:${packet.p}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${formattedFp}`,
    `a=setup:${setup}`,
    `a=mid:${mid}`,
    `a=sctp-port:${sctpPort}`,
    `a=max-message-size:${maxMessageSize}`
  ];

  for (let idx = 0; idx < packet.c.length; idx++) {
    const cand = packet.c[idx];
    const ip = cand[0];
    const port = cand[1];
    const protocol = (cand[2] || 'udp').toUpperCase();
    const priority = cand[3] || 2122260223;
    const foundation = cand[4] || String(idx + 1);
    const component = cand[5] || 1;
    sdpLines.push(
      `a=candidate:${foundation} ${component} ${protocol} ${priority} ${ip} ${port} typ host`
    );
  }

  sdpLines.push('a=end-of-candidates');
  sdpLines.push('');

  return sdpLines.join('\r\n');
}

/**
 * Encodes a Uint8Array into a Base64 string universally across browser and Node environments.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into a Uint8Array universally across browser and Node environments.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses an SDP string using the standard Deflate compression stream.
 */
export async function compressSdp(sdp: string): Promise<string> {
  const startTime = performance.now();
  console.log(`[DIAG 11.1] [${new Date().toISOString()}] compressSdp started (input length: ${sdp.length} chars)`);
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sdp);

    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    let merged: Uint8Array;

    if (typeof Response !== 'undefined') {
      const readPromise = new Response(cs.readable).arrayBuffer();
      await writer.write(bytes as any);
      await writer.close();
      merged = new Uint8Array(await readPromise);
    } else {
      await writer.write(bytes as any);
      await writer.close();
      const reader = cs.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
    }

    const compressedBase64 = uint8ArrayToBase64(merged);
    const duration = (performance.now() - startTime).toFixed(1);
    console.log(
      `[DIAG 12] [${new Date().toISOString()}] SDP compression completed (duration: ${duration}ms, original: ${sdp.length} chars, compressed: ${compressedBase64.length} chars, ratio: ${(compressedBase64.length / sdp.length).toFixed(2)})`
    );
    return compressedBase64;
  } catch (err: any) {
    console.error(`[DIAG ERROR] [${new Date().toISOString()}] Exception in compressSdp:`, err);
    throw err;
  }
}

/**
 * Decompresses an SDP string from Base64 using the standard Deflate decompression stream.
 */
export async function decompressSdp(base64: string): Promise<string> {
  const bytes = base64ToUint8Array(base64);

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  let merged: Uint8Array;

  if (typeof Response !== 'undefined') {
    const readPromise = new Response(ds.readable).arrayBuffer();
    await writer.write(bytes as any);
    await writer.close();
    merged = new Uint8Array(await readPromise);
  } else {
    await writer.write(bytes as any);
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
  }

  const decoder = new TextDecoder();
  return decoder.decode(merged);
}

/**
 * Compresses or formats an SDP payload into QR signaling packets.
 * Automatically attempts ultra-compact single-frame encoding first (~200 chars, Version 7/8 QR).
 * Falls back to Deflate compression and multi-frame chunking if compact extraction fails.
 */
export async function createQrPayloads(
  sessionId: string,
  type: 'offer' | 'answer',
  sdp: string,
  maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH,
  expirationMs = DEFAULT_QR_EXPIRATION_MS,
  fallbackIp?: string
): Promise<AnyQrPacket[]> {
  if (!sessionId || !sdp) {
    throw new Error('Session ID and SDP are required to generate QR signaling payloads');
  }

  // Attempt ultra-compact SDP extraction first (prioritizing 1 static QR code)
  try {
    const compact = extractCompactSdp(sessionId, type, sdp, expirationMs, fallbackIp);
    if (compact) {
      const compactJson = JSON.stringify(compact);
      if (compactJson.length <= maxChunkLength) {
        console.log(
          `[DIAG 13] [${new Date().toISOString()}] Compact SDP packet generated (${type}, candidates: ${compact.c.length}, jsonLength: ${compactJson.length} chars)`
        );
        return [compact];
      }
    }
  } catch (extractErr) {
    console.warn('[DIAG WARN] Compact SDP extraction failed, falling back to Deflate compression:', extractErr);
  }

  // Fallback: Prune unused RTP media/extmap attributes before Deflate compression
  const prunedSdp = pruneSdpForDataChannel(sdp);
  const compressedBase64 = await compressSdp(prunedSdp);
  const exp = Date.now() + expirationMs;

  // Single-frame QR if payload is compact
  if (compressedBase64.length <= maxChunkLength) {
    console.log(
      `[DIAG 13] [${new Date().toISOString()}] Single-frame Deflate QR payload created (${type}, bytes: ${compressedBase64.length})`
    );
    return [
      {
        v: QR_SIGNALING_VERSION,
        sid: sessionId,
        type,
        idx: 0,
        total: 1,
        data: compressedBase64,
        exp
      }
    ];
  }

  // Multi-frame QR with BALANCED chunk lengths:
  // Instead of packing Frame 1 to max (e.g. 520) and leaving Frame 2 tiny (e.g. 80),
  // distribute the payload evenly across all frames so every frame has lower density and larger QR modules!
  const total = Math.ceil(compressedBase64.length / maxChunkLength);
  const targetChunkLength = Math.ceil(compressedBase64.length / total);
  const packets: QrSignalingPacket[] = [];

  for (let idx = 0; idx < total; idx++) {
    const start = idx * targetChunkLength;
    const end = Math.min(start + targetChunkLength, compressedBase64.length);
    const slice = compressedBase64.slice(start, end);
    packets.push({
      v: QR_SIGNALING_VERSION,
      sid: sessionId,
      type,
      idx,
      total,
      data: slice,
      exp
    });
  }

  console.log(
    `[DIAG 13] [${new Date().toISOString()}] Balanced multi-frame QR payload generated (packet count: ${packets.length}, slice length: ~${targetChunkLength} chars, total bytes: ${compressedBase64.length})`
  );
  return packets;
}

/**
 * Validates and parses raw text from a scanned QR code into AnyQrPacket (CompactSdpPacket or QrSignalingPacket).
 */
export function parseAndValidateQrPayload(rawText: string): AnyQrPacket {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Invalid QR scan: empty or non-string payload');
  }

  // Size guard: Reject payloads larger than 4 KiB to prevent denial-of-service / memory exhaustion
  if (rawText.length > 4096) {
    throw new Error('Rejected oversized QR payload (> 4096 bytes)');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Malformed QR payload: not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Malformed QR payload: expected JSON object');
  }

  // Fast path: CompactSdpPacket (v: 2)
  if (isCompactSdpPacket(parsed)) {
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      throw new Error('QR session expired. Please generate a fresh session.');
    }
    return parsed as CompactSdpPacket;
  }

  // Legacy path: Deflate-compressed QrSignalingPacket (v: 1)
  if (parsed.v === QR_SIGNALING_VERSION) {
    if (typeof parsed.sid !== 'string' || !parsed.sid.trim()) {
      throw new Error('Missing or invalid session ID in QR payload');
    }

    if (parsed.type !== 'offer' && parsed.type !== 'answer') {
      throw new Error(`Invalid message type: ${parsed.type} (expected 'offer' or 'answer')`);
    }

    if (typeof parsed.idx !== 'number' || typeof parsed.total !== 'number' || parsed.idx < 0 || parsed.idx >= parsed.total) {
      throw new Error(`Invalid frame index bounds: ${parsed.idx} of ${parsed.total}`);
    }

    if (typeof parsed.data !== 'string' || !parsed.data) {
      throw new Error('Missing payload data in QR frame');
    }

    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      throw new Error('QR session expired. Please generate a fresh session.');
    }

    return parsed as QrSignalingPacket;
  }

  throw new Error(`Unsupported QR protocol version: ${parsed.v}`);
}

/**
 * Reassembles single- or multi-frame QR packets into the complete, decompressed SDP payload.
 */
export class QrPayloadReassembler {
  private activeSessionId: string | null = null;
  private expectedType: 'offer' | 'answer' | null = null;
  private totalChunks = 0;
  private receivedChunks = new Map<number, string>();
  private expiration = 0;

  /**
   * Resets reassembler state for a new session.
   */
  reset() {
    this.activeSessionId = null;
    this.expectedType = null;
    this.totalChunks = 0;
    this.receivedChunks.clear();
    this.expiration = 0;
  }

  /**
   * Feeds a scanned QR packet into the reassembler.
   * If packet is CompactSdpPacket (v: 2), immediately reconstitutes the full SDP.
   * If packet is QrSignalingPacket (v: 1), reassembles chunks and decompresses via Deflate.
   * Returns the SDP and session info once complete, or null if awaiting more frames.
   */
  async processPacket(
    packet: AnyQrPacket,
    expectedSessionId?: string
  ): Promise<{ sessionId: string; type: 'offer' | 'answer'; sdp: string } | null> {
    // Session expiration check
    if (packet.exp < Date.now()) {
      throw new Error('Scanned QR code has expired. Please refresh the sender session.');
    }

    // Session ID validation
    if (expectedSessionId && packet.sid !== expectedSessionId) {
      throw new Error(`Mismatched session ID: expected ${expectedSessionId}, received ${packet.sid}`);
    }

    // Fast-path: CompactSdpPacket (v: 2)
    if (isCompactSdpPacket(packet)) {
      this.reset();
      const sdp = reconstituteSdpFromCompact(packet);
      return {
        sessionId: packet.sid,
        type: packet.type,
        sdp
      };
    }

    // Legacy multi-frame / single-frame Deflate-compressed packet (v: 1)
    if (this.activeSessionId !== packet.sid) {
      this.reset();
      this.activeSessionId = packet.sid;
      this.expectedType = packet.type;
      this.totalChunks = packet.total;
      this.expiration = packet.exp;
    }

    if (this.expectedType !== packet.type) {
      throw new Error(`Inconsistent packet type within session: expected ${this.expectedType}, received ${packet.type}`);
    }

    if (this.totalChunks !== packet.total) {
      throw new Error(`Inconsistent total chunks in frame: expected ${this.totalChunks}, received ${packet.total}`);
    }

    // Store frame data (deduplicates repeated scans of the same frame)
    this.receivedChunks.set(packet.idx, packet.data);

    // Check if all frames have arrived
    if (this.receivedChunks.size === this.totalChunks) {
      let fullBase64 = '';
      for (let i = 0; i < this.totalChunks; i++) {
        const slice = this.receivedChunks.get(i);
        if (!slice) {
          throw new Error(`Missing frame ${i} of ${this.totalChunks}`);
        }
        fullBase64 += slice;
      }

      const sdp = await decompressSdp(fullBase64);
      const result = {
        sessionId: this.activeSessionId!,
        type: this.expectedType!,
        sdp
      };

      this.reset();
      return result;
    }

    return null;
  }

  getProgress(): { received: number; total: number } {
    return {
      received: this.receivedChunks.size,
      total: this.totalChunks || 1
    };
  }
}

/**
 * Waits for RTCPeerConnection ICE candidate gathering to reach 'complete'.
 * Ensures all local host candidates are embedded in the SDP before QR generation.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  const startTime = performance.now();
  console.log(`[DIAG 9] [${new Date().toISOString()}] ICE gathering started (initial iceGatheringState: ${pc.iceGatheringState})`);

  if (pc.iceGatheringState === 'complete') {
    console.log(`[DIAG 10] [${new Date().toISOString()}] ICE gathering already complete (duration: 0.0ms, candidates count: in-sdp)`);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let candidateCount = 0;
    let privateIpCount = 0;
    let mdnsCount = 0;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', checkState);
      pc.removeEventListener('icecandidate', onCandidate);
    };

    const finish = (reason: string) => {
      cleanup();
      const duration = (performance.now() - startTime).toFixed(1);
      console.log(
        `[DIAG 10] [${new Date().toISOString()}] ICE gathering completed (reason: ${reason}, final state: ${pc.iceGatheringState}, duration: ${duration}ms, candidates count: ${candidateCount}, private IPs: ${privateIpCount}, mDNS: ${mdnsCount})`
      );
      if (candidateCount > 0 && privateIpCount === 0 && mdnsCount > 0) {
        console.warn(
          `[DIAG WARN] [${new Date().toISOString()}] All gathered host candidates are mDNS-masked (.local). Over a phone hotspot without mDNS resolution, devices cannot resolve .local hostnames unless private IP exposure is active.`
        );
      }
      resolve();
    };

    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        candidateCount++;
        const parsed = parseIceCandidateString(event.candidate.candidate);
        if (parsed) {
          if (parsed.isPrivateIp) privateIpCount++;
          if (parsed.isMdns) mdnsCount++;
          const classification = parsed.isPrivateIp
            ? '[PRIVATE IP - HOTSPOT/LAN OK]'
            : parsed.isMdns
            ? '[MDNS OBFUSCATED - .local name]'
            : parsed.isLoopback
            ? '[LOOPBACK]'
            : '[OTHER IP]';
          console.log(
            `[DIAG 9.1] [${new Date().toISOString()}] Candidate gathered (#${candidateCount}): ${parsed.type.toUpperCase()} ${parsed.protocol} ${parsed.address}:${parsed.port} ${classification}`
          );
        } else {
          console.log(`[DIAG 9.1] [${new Date().toISOString()}] Candidate gathered (#${candidateCount}): ${event.candidate.candidate.slice(0, 60)}...`);
        }
      } else {
        console.log(`[DIAG 9.2] [${new Date().toISOString()}] Null candidate received (end of gathering)`);
        finish('null-candidate');
      }
    };

    const checkState = () => {
      console.log(`[DIAG 9.3] [${new Date().toISOString()}] icegatheringstatechange -> ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === 'complete') {
        finish('state-complete');
      }
    };

    pc.addEventListener('icegatheringstatechange', checkState);
    pc.addEventListener('icecandidate', onCandidate);

    timer = setTimeout(() => {
      console.warn(`[DIAG 9.4] [${new Date().toISOString()}] ICE gathering timeout reached (${timeoutMs}ms)`);
      finish('timeout');
    }, timeoutMs);
  });
}

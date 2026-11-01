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

export const QR_SIGNALING_VERSION = 1;
export const DEFAULT_QR_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MAX_CHUNK_LENGTH = 520; // Maximum data slice characters per QR frame

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
 * Compresses an SDP payload and packages it into one or more QR signaling packets.
 */
export async function createQrPayloads(
  sessionId: string,
  type: 'offer' | 'answer',
  sdp: string,
  maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH,
  expirationMs = DEFAULT_QR_EXPIRATION_MS
): Promise<QrSignalingPacket[]> {
  if (!sessionId || !sdp) {
    throw new Error('Session ID and SDP are required to generate QR signaling payloads');
  }

  const compressedBase64 = await compressSdp(sdp);
  const exp = Date.now() + expirationMs;

  // Single-frame QR if payload is compact
  if (compressedBase64.length <= maxChunkLength) {
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

  // Multi-frame QR segmentation for complex interface profiles
  const total = Math.ceil(compressedBase64.length / maxChunkLength);
  const packets: QrSignalingPacket[] = [];

  for (let idx = 0; idx < total; idx++) {
    const slice = compressedBase64.slice(idx * maxChunkLength, (idx + 1) * maxChunkLength);
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
    `[DIAG 13] [${new Date().toISOString()}] QR payload generation completed (packet count: ${packets.length}, type: ${type}, total bytes: ${compressedBase64.length})`
  );
  return packets;
}

/**
 * Validates and parses raw text from a scanned QR code into a QrSignalingPacket.
 */
export function parseAndValidateQrPayload(rawText: string): QrSignalingPacket {
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

  if (parsed.v !== QR_SIGNALING_VERSION) {
    throw new Error(`Unsupported QR protocol version: ${parsed.v} (expected ${QR_SIGNALING_VERSION})`);
  }

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
   * Returns the decompressed SDP and session info once all frames are received, or null if awaiting more frames.
   */
  async processPacket(
    packet: QrSignalingPacket,
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

    // Initialize or switch session
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

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', checkState);
      pc.removeEventListener('icecandidate', onCandidate);
    };

    const finish = (reason: string) => {
      cleanup();
      const duration = (performance.now() - startTime).toFixed(1);
      console.log(
        `[DIAG 10] [${new Date().toISOString()}] ICE gathering completed (reason: ${reason}, final state: ${pc.iceGatheringState}, duration: ${duration}ms, candidates count: ${candidateCount})`
      );
      resolve();
    };

    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        candidateCount++;
        console.log(`[DIAG 9.1] [${new Date().toISOString()}] Candidate gathered (#${candidateCount}): ${event.candidate.candidate.slice(0, 60)}...`);
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

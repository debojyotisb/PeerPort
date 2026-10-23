# PeerPort Security & Threat Model

## 1. Security Architecture Principles

1. **Zero-Knowledge Signaling**: The signaling server only facilitates ephemeral metadata and SDP exchanges. It never receives file content.
2. **Explicit Receiver Consent**: No file data is dispatched until the receiver verifies the sender's identity, inspects the file manifest, and explicitly clicks "Accept".
3. **End-to-End Cryptographic Integrity**: Every file payload is hashed in streaming chunks using SHA-256 via the Web Crypto API. The recipient verifies the full digest before finalizing the file.
4. **Sanitized File System Operations**: All incoming file names are scrubbed to prevent directory traversal (`../`), null-byte injection, and dangerous executable extensions.

---

## 2. Threat Analysis & Mitigations

### 2.1 Unauthorized Room Snooping / Man-in-the-Middle
* **Threat**: An attacker guesses or enumerates a room ID on the signaling server to intercept file offers.
* **Mitigation**:
  - Room IDs use 64-bit cryptographic entropy or 6-character alphanumeric codes with strict rate-limiting (maximum 5 failed attempts per IP per minute).
  - WebRTC channels require DTLS certificate fingerprint verification.
  - Out-of-band visual pairing PIN (4-digit security code or QR verification token) displayed on sender and receiver.

### 2.2 Memory Exhaustion (Denial of Service)
* **Threat**: A sender attempts to transmit a 10 GB file that crashes the receiver's mobile browser by exhausting RAM.
* **Mitigation**:
  - The receiver never buffers the entire file in JavaScript memory.
  - Files are streamed chunk-by-chunk directly into disk storage via the File System Access API (`FileSystemWritableFileStream`) or written to temporary disk blobs.
  - Senders enforce chunk streaming with strict backpressure (`bufferedAmountLowThreshold`).

### 2.3 Malicious Filenames / Path Traversal
* **Threat**: A sender offers a file named `../../../../etc/shadow` or `..\Windows\System32\payload.exe`.
* **Mitigation**:
  - Strict filename sanitization:
    ```typescript
    export function sanitizeFileName(name: string): string {
      const baseName = name.replace(/^.*[\\\/]/, ''); // Strip paths
      const cleaned = baseName.replace(/[\x00-\x1f\x80-\x9f]/g, ''); // Strip control chars
      return cleaned.substring(0, 255) || 'unnamed_file';
    }
    ```

### 2.4 Replay Attacks & Session Hijacking
* **Threat**: An attacker captures a signaling packet and attempts to replay it to force a file download.
* **Mitigation**:
  - Every session negotiation includes a random 128-bit session nonce and a timestamp with a 60-second validity window.
  - Handshake messages with expired timestamps or replayed nonces are rejected.


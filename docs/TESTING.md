# PeerPort Testing Protocol & Verification Matrix

PeerPort requires automated unit and integration tests alongside real-device cross-platform validation.

## 1. Automated Test Suite

Run all test suites across workspaces:
```bash
npm run test
```

### Coverage Areas
1. **Binary Framing & Serialization (`packages/transfer-protocol/tests/framing.test.ts`)**:
   - Pack & unpack 48-byte fixed binary headers with magic byte `0x50505254` validation.
   - Rejection of invalid magic headers, truncated buffers, and mismatched payload lengths.
2. **Streaming SHA-256 Checksums (`packages/transfer-protocol/tests/integrity.test.ts`)**:
   - Web Crypto API (`crypto.subtle`) hardware-accelerated SHA-256 calculation.
   - Verification of known test vectors and invalid hash string rejection.
3. **Security Sanitization (`packages/validation/tests/sanitizer.test.ts`)**:
   - Directory traversal attacks (`../../etc/shadow`, `..\..\Windows\System32\cmd.exe`).
   - Neutralization of Windows reserved device names (`CON`, `NUL`, `COM1`).
   - Removal of null bytes and ASCII control characters.
4. **Zod Protocol Schema Validation (`packages/validation/tests/schemas.test.ts`)**:
   - Full validation of `TransferManifest`, `SignalingMessage`, and device descriptors.
   - Strict rejection of empty files, malformed signaling types, and out-of-range timestamps.
5. **Signaling Server Lifecycle (`apps/signaling-server/tests/signaling.test.ts`)**:
   - Room creation, max 2 peer limit, passcode authorization checks.
   - Stale room TTL pruning.
   - IP rate limiter thresholding.
6. **State Machine (`apps/web/src/tests/connection-store.test.ts`)**:
   - Transition enforcement from `IDLE` ➔ `DISCOVERING` ➔ `CONNECTING` ➔ `AWAITING_APPROVAL` ➔ `TRANSFERRING` ➔ `COMPLETED`.

---

## 2. Real-Device Interoperability Matrix

| Test Scenario | Connection Method | Network Condition | Expected Result |
| :--- | :--- | :--- | :--- |
| **Scenario A: Android ➔ iPhone** | Android Local Hotspot (`WifiManager`) + Micro-HTTP | **Zero Internet / Airplane Mode** | iPhone scans QR via native Camera, joins Wi-Fi, loads Safari, downloads file directly. |
| **Scenario B: Android ➔ iPhone (Assisted)** | WebRTC DataChannel via WebSocket signaling | Internet available (different Wi-Fi/cellular) | Direct P2P via STUN host/srflx candidates. Signaling server never sees payload. |
| **Scenario C: Android ➔ Android** | WebRTC P2P or Local Hotspot | Same Wi-Fi or Hotspot | Direct high-speed local stream. |
| **Scenario D: Android ➔ PC (Windows/Mac)** | WebRTC DataChannel / Browser QR | Same LAN or Internet | Browser client connects, verifies SHA-256, downloads directly. |
| **Scenario E: Zero-Install Receiver** | Web Browser (Safari, Chrome, Edge) | Offline Hotspot or Internet Link | Receiver needs **zero app installation** to receive and save files. |


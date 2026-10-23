# ⚡ PeerPort

> **Fast, Secure, Cross-Platform P2P File Sharing with Direct Android-to-iOS Offline Transfers**

PeerPort is a complete, privacy-first peer-to-peer file-sharing application engineered to work across Android, iPhone, iPad, Windows, macOS, and Linux.

---

## 🌟 The Primary Technical Feat: Direct Android-to-iOS Sharing Without Internet

PeerPort solves the critical industry challenge of transferring files directly between an Android device and an iPhone when **neither device has internet access**:

1. **Android Local Hotspot**: Android activates a Local-Only Hotspot (`WifiManager.LocalOnlyHotspot`) and starts a local micro-server.
2. **Dual-Purpose QR Code**: PeerPort generates a standard Wi-Fi pairing QR code (`WIFI:S:PeerPort-XXXX;...`) combined with the local transfer URL.
3. **Native iOS Camera Scan**: The iPhone user points their native iOS Camera at the QR code and taps *"Join 'PeerPort-XXXX' Wi-Fi Network"*.
4. **Zero-Install Safari Experience**: Mobile Safari connects directly to the Android device over local Wi-Fi, reviews the file offer, accepts, and downloads files at 50–100+ MB/s.
5. **Zero Cloud Payload**: Files travel 100% device-to-device with hardware SHA-256 integrity verification.

---

## 🛠️ Architecture & Workspaces

```text
peerport/
├── apps/
│   ├── web/                     # React 18 + Vite + Tailwind + Lucide + Zustand + Zod
│   ├── signaling-server/        # Node.js + WebSocket lightweight signaling server
│   └── native-companion/       # Local Hotspot & Micro-HTTP file streaming engine
├── packages/
│   ├── shared-types/            # Canonical TypeScript types & interfaces
│   ├── transfer-protocol/       # 48-byte binary chunk framing, backpressure, SHA-256
│   └── validation/              # Strict Zod schemas and path traversal sanitizers
└── docs/
    ├── ARCHITECTURE.md          # Complete Phase 1 architecture & feasibility validation
    ├── NETWORKING.md            # Transport protocols & WebRTC tuning
    ├── SECURITY.md              # Threat model (STRIDE) & memory safety mitigations
    ├── PRIVACY.md               # Zero-cloud payload & privacy guarantees
    ├── TESTING.md               # Automated test coverage & device test matrix
    └── DEPLOYMENT.md            # Setup, installation, and deployment instructions
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Web Application
```bash
npm run dev:web
# Accessible at http://localhost:5173
```

### 3. Run the Signaling Server (Optional, for Internet-Assisted P2P)
```bash
npm run dev:server
# Runs on ws://localhost:8088
```

### 4. Run the Native Companion (For Offline Hotspot & Direct Transfers)
```bash
npm run dev:companion
# Runs on http://localhost:8080
```

### 5. Run Automated Tests
```bash
npm run test
```

---

## 🔒 Security & Privacy Guarantees

- **Zero Cloud Payload Storage**: Files never touch any cloud storage.
- **Explicit Receiver Approval**: The recipient inspects file names, types, and total size before any bytes transfer.
- **Hardware SHA-256 Verification**: Every file payload is validated against a cryptographic digest via the Web Crypto API.
- **Memory Safety**: Files are streamed in 64 KiB chunks with backpressure; multi-gigabyte files never exhaust browser RAM.
- **Path Traversal Protection**: All filenames are stripped of `../`, control codes, and Windows reserved device names (`CON`, `NUL`, etc.).


# PeerPort Deployment Guide

## 1. Quick Start (Local Development)

### Prerequisites
- Node.js v18.0.0 or higher (v20+ recommended)
- npm v9+

### Install Dependencies
```bash
npm install
```

### Run Full Stack (Single Command)
```bash
npm run dev
```
Starts:
- **Web App**: http://localhost:5173
- **Signaling Server**: ws://localhost:8088
- **Native Companion**: http://localhost:8080

### Or Run Services Individually
```bash
# Frontend only
npm run dev:web

# Signaling server only
npm run dev:server
```

### Run Test Suite
```bash
npm test
```

---

## 2. Production Deployment to Vercel (Frontend)

The frontend is configured for deployment as a monorepo workspace to Vercel.

### Vercel Project Settings
1. **Root Directory**: Leave as root `./` (recommended, using root `vercel.json`), or set to `apps/web`.
2. **Framework Preset**: `Vite`
3. **Build Command**: `npm run build --workspace=apps/web`
4. **Output Directory**: `apps/web/dist`
5. **Environment Variables**:
   - `VITE_SIGNALING_SERVER_URL`: Public WSS URL of your deployed signaling server (e.g. `wss://signaling.yourdomain.com` or `wss://peerport-signaling.onrender.com`).
   - `VITE_DEFAULT_STUN_SERVERS`: `stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302`

SPA rewrites are pre-configured in `vercel.json` so direct links (`/join/:sessionId` and `/?join=:sessionId`) route cleanly without 404s.

---

## 3. Deploying the Signaling Server (Backend)

The signaling server coordinates WebRTC handshakes (SDP and ICE candidates) over WebSockets. It does not store or forward file contents.

### Option A: Render (Free / Web Service)
1. In Render, create a new **Web Service** pointing to your repository.
2. **Root Directory**: `apps/signaling-server`
3. **Runtime**: `Node`
4. **Build Command**: `npm install && npm run build`
5. **Start Command**: `node dist/index.js`
6. **Environment Variables**:
   - `PORT`: `8088` (or let Render set default port `10000`)
   - `ROOM_TTL_SECONDS`: `300`
   - `MAX_CONNECTIONS_PER_ROOM`: `2`
7. Copy the service address (e.g., `https://peerport-signaling.onrender.com`).
8. Convert `https://` to `wss://` and add it as `VITE_SIGNALING_SERVER_URL` in your Vercel frontend project settings.

### Option B: Railway / Fly.io / VPS
Run container or direct Node service with `npm start` in `apps/signaling-server`.

---

## 4. Cross-Device Real-World Testing Protocol

### Sender (Android Phone with Chrome or Desktop PC)
1. Open the deployed website (e.g., `https://peerport.vercel.app`).
2. Click **Choose files** or drag & drop a photo, document, or video.
3. Click **Share with a Browser**.
4. PeerPort creates a secure session and presents a high-resolution QR code.

### Receiver (iPhone with Safari / iPad / Android)
1. Point native iOS Camera at the QR code (or tap the copied link).
2. iOS displays native Safari banner: *"Open 'peerport.vercel.app' in Safari"*.
3. Tap to open. Safari loads the page and connects directly to the session.
4. The receiver's screen immediately displays the **Approval Dialog** showing:
   - Sender's device name (e.g., "Android Device (Chrome)")
   - File list with individual file names, sizes, and total transfer size.
5. Tap **Accept & Download**.
6. Real file chunks stream directly peer-to-peer over WebRTC `RTCDataChannel`.
7. Once transfer finishes:
   - SHA-256 integrity verification completes.
   - Safari triggers native browser download to save the file.
   - Both devices display 100% completion status.

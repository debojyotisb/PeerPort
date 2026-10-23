# PeerPort Deployment Guide

## 1. Quick Start (Development)

### Prerequisites
- Node.js v18.0.0 or higher (v20+ recommended)
- npm v9+

### Install Dependencies
```bash
npm install
```

### Run Web Frontend
```bash
npm run dev:web
# Launches on http://localhost:5173
```

### Run Signaling Server
```bash
npm run dev:server
# Launches on ws://localhost:8088
```

### Run Native Companion / Local Bridge
```bash
npm run dev:companion
# Launches on http://localhost:8080 (Hotspot & Local File Micro-Server)
```

---

## 2. Production Deployment

### Building the Web Application
```bash
npm run build
```
The static bundle will be output to `apps/web/dist`. It can be hosted on any static CDN (Vercel, Cloudflare Pages, Netlify, or AWS S3 + CloudFront).

### Deploying the Signaling Server
The signaling server is a stateless, zero-payload container that can be deployed on:
- Fly.io (`fly launch`)
- Render (`Web Service` with Dockerfile or Node.js)
- Railway or AWS ECS / DigitalOcean VPS ($5 droplet)

**Environment Variables**:
```env
PORT=8088
ROOM_TTL_SECONDS=300
MAX_CONNECTIONS_PER_ROOM=2
```

### Running Native Companion on Android
On Android devices:
1. Wrap the companion as a lightweight foreground Android Service (using Android Studio / Kotlin or Capacitor background plugin).
2. The service calls `WifiManager.startLocalOnlyHotspot(...)` and binds the embedded Node/Go micro-server to port `8080`.
3. The React web UI interacts with `http://127.0.0.1:8080/api/hotspot/start` locally.


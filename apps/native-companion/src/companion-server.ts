import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { HotspotManager } from './hotspot-manager.js';
import { getLocalNetworkInterfaces } from './network-utils.js';
import { TransferManifestSchema, sanitizeFileName } from '@peerport/validation';

export interface CompanionServerOptions {
  port?: number;
  staticDir?: string;
}

export function createCompanionServer(options: CompanionServerOptions = {}) {
  const port = options.port || 8080;
  const hotspotManager = new HotspotManager();
  const activeTransfers = new Map<string, { manifest: any; fileBuffers: Map<string, Uint8Array> }>();

  const httpServer = http.createServer((req, res) => {
    // Enable CORS for local cross-origin connections
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // API: Status
    if (url.pathname === '/api/status') {
      const interfaces = getLocalNetworkInterfaces();
      const hotspot = hotspotManager.getSession();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        service: 'peerport-native-companion',
        interfaces,
        hotspot
      }));
      return;
    }

    // API: Hotspot Start
    if (url.pathname === '/api/hotspot/start' && req.method === 'POST') {
      hotspotManager.startHotspot(port).then((session) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, session }));
      });
      return;
    }

    // API: Hotspot Stop
    if (url.pathname === '/api/hotspot/stop' && req.method === 'POST') {
      hotspotManager.stopHotspot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // API: File Transfer Upload (Local Stream)
    if (url.pathname.startsWith('/api/transfer/upload') && req.method === 'POST') {
      const fileId = url.searchParams.get('fileId') || 'unknown';
      const transferId = url.searchParams.get('transferId') || 'unknown';
      const fileName = sanitizeFileName(url.searchParams.get('name') || 'file.bin');

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        let transfer = activeTransfers.get(transferId);
        if (!transfer) {
          transfer = { manifest: null, fileBuffers: new Map() };
          activeTransfers.set(transferId, transfer);
        }
        transfer.fileBuffers.set(fileId, fullBuffer);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, bytesReceived: fullBuffer.length, fileId }));
      });
      return;
    }

    // API: File Transfer Download (Direct Local Download for Browser Receiver / iOS Safari)
    if (url.pathname.startsWith('/api/transfer/download') && req.method === 'GET') {
      const fileId = url.searchParams.get('fileId');
      const transferId = url.searchParams.get('transferId');
      const fileName = sanitizeFileName(url.searchParams.get('name') || 'downloaded_file');

      const transfer = transferId ? activeTransfers.get(transferId) : null;
      const buffer = (transfer && fileId) ? transfer.fileBuffers.get(fileId) : null;

      if (!buffer) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found or transfer expired');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length
      });
      res.end(buffer);
      return;
    }

    // Static Web App Serving (so iPhone can load full PeerPort Web App offline over Wi-Fi!)
    if (options.staticDir && fs.existsSync(options.staticDir)) {
      let filePath = path.join(options.staticDir, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(options.staticDir, 'index.html'); // SPA fallback
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
          '.png': 'image/png'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Default Fallback HTML for zero-install browser landing page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PeerPort Local Transfer</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .badge { background: #0284c7; color: white; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; display: inline-block; margin-bottom: 16px; }
    p { color: #94a3b8; line-height: 1.5; font-size: 15px; }
    .btn { background: #38bdf8; color: #0f172a; padding: 12px 24px; border-radius: 8px; font-weight: 700; text-decoration: none; display: inline-block; margin-top: 16px; transition: transform 0.1s; }
    .btn:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Offline Direct Transfer</div>
    <h1>⚡ PeerPort</h1>
    <p>Connected directly to nearby sender over local Wi-Fi. No internet access or app installation required.</p>
    <div id="transfer-area">
      <p>Waiting for sender to dispatch file manifest...</p>
    </div>
  </div>
</body>
</html>`);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (message: string) => {
      // Local broadcast to all connected peers
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });
  });

  return {
    httpServer,
    wss,
    hotspotManager,
    listen: () => {
      return new Promise<void>((resolve) => {
        httpServer.listen(port, () => {
          console.log(`[PeerPort Native Companion] running on port ${port}`);
          resolve();
        });
      });
    },
    close: () => {
      return new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    }
  };
}


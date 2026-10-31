import {
  PeerTransport,
  PeerConnection,
  DiscoveredPeer,
  ConnectionState,
  TransportMode,
  TransferManifest,
  TransferResponse,
  BinaryChunk,
  TransferProgress,
  TransferCompletePayload
} from '@peerport/shared-types';

export interface HotspotSessionDetails {
  ssid: string;
  passphrase?: string;
  gatewayIp: string;
  port: number;
  qrPayload: string;
  webUrl: string;
  isActive: boolean;
}

export class HotspotTransport implements PeerTransport {
  readonly mode: TransportMode = 'LOCAL_HOTSPOT';
  connectionState: ConnectionState = 'IDLE';

  private companionBaseUrl: string;
  private ws: WebSocket | null = null;
  private currentSession: HotspotSessionDetails | null = null;

  private listeners = {
    onPeerFound: new Set<(peer: DiscoveredPeer) => void>(),
    onPeerLost: new Set<(peerId: string) => void>(),
    onConnectionStateChange: new Set<(state: ConnectionState, reason?: string) => void>(),
    onTransferRequest: new Set<(manifest: TransferManifest, approve: (accepted: boolean) => Promise<void>) => void>(),
    onTransferResponse: new Set<(response: TransferResponse) => void>(),
    onProgress: new Set<(progress: TransferProgress) => void>(),
    onTransferComplete: new Set<(payload: TransferCompletePayload) => void>(),
    onError: new Set<(error: Error) => void>()
  };

  constructor(companionUrl?: string) {
    this.companionBaseUrl =
      companionUrl ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COMPANION_SERVER_URL) ||
      (typeof window !== 'undefined' && window.location.port === '8080'
        ? window.location.origin
        : 'http://localhost:8080');
  }

  async initialize(): Promise<void> {
    this.updateState('IDLE');
  }

  subscribe<K extends keyof typeof this.listeners>(event: K, handler: any): () => void {
    const set = this.listeners[event] as Set<any>;
    set.add(handler);
    return () => set.delete(handler);
  }

  private updateState(state: ConnectionState, reason?: string) {
    this.connectionState = state;
    for (const listener of this.listeners.onConnectionStateChange) {
      listener(state, reason);
    }
  }

  async startLocalHotspot(): Promise<HotspotSessionDetails> {
    this.updateState('CONNECTING');
    try {
      const res = await fetch(`${this.companionBaseUrl}/api/hotspot/start`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to activate local hotspot: HTTP ${res.status}`);
      const data = await res.json();
      this.currentSession = data.session;
      this.connectLocalWebSocket();
      this.updateState('DISCOVERING');
      return this.currentSession!;
    } catch (err: any) {
      this.updateState('FAILED', err.message);
      throw err;
    }
  }

  async stopLocalHotspot(): Promise<void> {
    try {
      await fetch(`${this.companionBaseUrl}/api/hotspot/stop`, { method: 'POST' });
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.currentSession = null;
      this.updateState('IDLE');
    } catch (err) {
      console.error('Error stopping hotspot:', err);
    }
  }

  private connectLocalWebSocket() {
    const wsUrl = this.companionBaseUrl.replace(/^http/, 'ws');
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TRANSFER_OFFER') {
            for (const l of this.listeners.onTransferRequest) {
              l(msg.manifest, async (accepted: boolean) => {
                this.respondTransferRequest({ id: 'companion' } as any, msg.manifest.transferId, accepted);
              });
            }
          } else if (msg.type === 'TRANSFER_ACCEPT') {
            this.updateState('TRANSFERRING');
            for (const l of this.listeners.onTransferResponse) {
              l({ transferId: msg.transferId, accepted: true, timestamp: Date.now() });
            }
          }
        } catch (err) {
          console.error('Failed to parse local message:', err);
        }
      };
    } catch (err) {
      console.error('Local WebSocket unavailable:', err);
    }
  }

  async discoverPeers(): Promise<void> {
    this.updateState('DISCOVERING');
  }

  async stopDiscovery(): Promise<void> {
    if (this.connectionState === 'DISCOVERING') {
      this.updateState('IDLE');
    }
  }

  async connect(peerId: string): Promise<PeerConnection> {
    return {
      id: peerId,
      peer: {
        id: peerId,
        device: { deviceId: peerId, deviceName: 'Nearby Mobile Device', platform: 'ios' },
        mode: 'LOCAL_HOTSPOT',
        lastSeen: Date.now()
      },
      mode: 'LOCAL_HOTSPOT',
      state: this.connectionState,
      send: async () => {},
      close: async () => this.stopLocalHotspot()
    };
  }

  async sendTransferRequest(connection: PeerConnection, manifest: TransferManifest): Promise<void> {
    this.updateState('AWAITING_APPROVAL');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'TRANSFER_OFFER', manifest }));
    }
  }

  async respondTransferRequest(connection: PeerConnection, transferId: string, accepted: boolean): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: accepted ? 'TRANSFER_ACCEPT' : 'TRANSFER_REJECT', transferId }));
    }
    this.updateState(accepted ? 'TRANSFERRING' : 'REJECTED');
  }

  async sendChunk(connection: PeerConnection, chunk: BinaryChunk): Promise<void> {
    // Chunks can also be posted directly to local companion upload endpoint
  }

  async uploadFileDirect(file: File, transferId: string, fileId: string, onProgress: (pct: number) => void): Promise<void> {
    const url = `${this.companionBaseUrl}/api/transfer/upload?transferId=${encodeURIComponent(transferId)}&fileId=${encodeURIComponent(fileId)}&name=${encodeURIComponent(file.name)}`;
    
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during local file transfer'));
      xhr.send(file);
    });
  }

  async cancelTransfer(connection: PeerConnection, transferId: string): Promise<void> {
    this.updateState('CANCELLED');
  }

  async close(): Promise<void> {
    await this.stopLocalHotspot();
  }

  async closeConnection(connection: PeerConnection): Promise<void> {
    await this.stopLocalHotspot();
  }
}

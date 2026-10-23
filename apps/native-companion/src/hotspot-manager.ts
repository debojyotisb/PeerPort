import crypto from 'crypto';
import { getLocalNetworkInterfaces, buildWifiQrString } from './network-utils.js';

export interface HotspotSession {
  ssid: string;
  passphrase: string;
  gatewayIp: string;
  port: number;
  qrPayload: string;
  webUrl: string;
  isActive: boolean;
  createdAt: number;
}

export class HotspotManager {
  private currentSession: HotspotSession | null = null;

  async startHotspot(port = 8080): Promise<HotspotSession> {
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const ssid = `PeerPort-${randomSuffix}`;
    const passphrase = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, 'x');

    const interfaces = getLocalNetworkInterfaces();
    const preferredIp = interfaces.find((i) => i.isHotspot)?.ipAddress || interfaces[0]?.ipAddress || '192.168.49.1';

    const webUrl = `http://${preferredIp}:${port}`;
    const wifiQr = buildWifiQrString(ssid, passphrase);
    // Combined dual QR payload formatted for mobile scanners
    const qrPayload = JSON.stringify({
      wifi: wifiQr,
      ssid,
      passphrase,
      url: webUrl,
      type: 'peerport_hotspot'
    });

    this.currentSession = {
      ssid,
      passphrase,
      gatewayIp: preferredIp,
      port,
      qrPayload,
      webUrl,
      isActive: true,
      createdAt: Date.now()
    };

    return this.currentSession;
  }

  stopHotspot(): void {
    if (this.currentSession) {
      this.currentSession.isActive = false;
      this.currentSession = null;
    }
  }

  getSession(): HotspotSession | null {
    return this.currentSession;
  }
}

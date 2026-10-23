import { describe, it, expect } from 'vitest';
import { getLocalNetworkInterfaces, buildWifiQrString } from '../src/network-utils.js';
import { HotspotManager } from '../src/hotspot-manager.js';

describe('Native Companion & Offline Hotspot Logic', () => {
  it('discovers local network interfaces or defaults to loopback', () => {
    const interfaces = getLocalNetworkInterfaces();
    expect(interfaces.length).toBeGreaterThan(0);
    expect(interfaces[0].ipAddress).toBeDefined();
  });

  it('builds standard Wi-Fi configuration QR string recognizable by iOS Camera', () => {
    const qrString = buildWifiQrString('PeerPort-A1B2', 'secretPass123');
    expect(qrString).toBe('WIFI:S:PeerPort-A1B2;T:WPA;P:secretPass123;;');
  });

  it('escapes special characters in Wi-Fi SSIDs and passwords', () => {
    const qrString = buildWifiQrString('Peer;Port:Test', 'pass\\word"');
    expect(qrString).toContain('Peer\\;Port\\:Test');
    expect(qrString).toContain('pass\\\\word\\"');
  });

  it('manages hotspot session lifecycle', async () => {
    const manager = new HotspotManager();
    expect(manager.getSession()).toBeNull();

    const session = await manager.startHotspot(8080);
    expect(session.isActive).toBe(true);
    expect(session.ssid).toMatch(/^PeerPort-[A-F0-9]{4}$/);
    expect(session.webUrl).toContain(':8080');

    manager.stopHotspot();
    expect(manager.getSession()).toBeNull();
  });
});


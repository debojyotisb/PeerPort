import os from 'os';

export interface LocalNetworkInfo {
  interfaceName: string;
  ipAddress: string;
  isHotspot: boolean;
}

/**
 * Discovers active IPv4 network interfaces on the host.
 */
export function getLocalNetworkInterfaces(): LocalNetworkInfo[] {
  const interfaces = os.networkInterfaces();
  const results: LocalNetworkInfo[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Standard Android SoftAP subnet is 192.168.49.x or 192.168.43.x
        const isHotspot = addr.address.startsWith('192.168.49.') || addr.address.startsWith('192.168.43.');
        results.push({
          interfaceName: name,
          ipAddress: addr.address,
          isHotspot
        });
      }
    }
  }

  // Fallback to localhost if no external network is up
  if (results.length === 0) {
    results.push({
      interfaceName: 'lo',
      ipAddress: '127.0.0.1',
      isHotspot: false
    });
  }

  return results;
}

/**
 * Builds the standard Wi-Fi configuration string recognized by iOS and Android camera apps.
 * Format: WIFI:S:<SSID>;T:<WPA|WEP|nopass>;P:<PASSWORD>;H:<true|false>;;
 */
export function buildWifiQrString(ssid: string, password?: string, hidden = false): string {
  const auth = password ? 'WPA' : 'nopass';
  const passField = password ? `P:${escapeQrField(password)};` : '';
  const hiddenField = hidden ? 'H:true;' : '';
  return `WIFI:S:${escapeQrField(ssid)};T:${auth};${passField}${hiddenField};`;
}

function escapeQrField(val: string): string {
  return val.replace(/([\\;,":])/g, '\\$1');
}

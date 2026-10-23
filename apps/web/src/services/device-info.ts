import { DeviceInfo } from '@peerport/shared-types';

export function getLocalDeviceInfo(): DeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let platform: DeviceInfo['platform'] = 'browser';
  let deviceName = 'Browser Peer';

  if (/android/i.test(ua)) {
    platform = 'android';
    deviceName = 'Android Device';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    platform = 'ios';
    deviceName = 'Apple iPhone';
  } else if (/macintosh|mac os x/i.test(ua)) {
    platform = 'macos';
    deviceName = 'Mac Computer';
  } else if (/windows/i.test(ua)) {
    platform = 'windows';
    deviceName = 'Windows PC';
  } else if (/linux/i.test(ua)) {
    platform = 'linux';
    deviceName = 'Linux Device';
  }

  // Get or create unique ephemeral device ID
  let deviceId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('peerport_device_id') : null;
  if (!deviceId) {
    deviceId = `dev_${Math.random().toString(36).substring(2, 10)}`;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('peerport_device_id', deviceId);
    }
  }

  // Allow custom device name override in localStorage
  const customName = typeof localStorage !== 'undefined' ? localStorage.getItem('peerport_custom_name') : null;

  return {
    deviceId,
    deviceName: customName || deviceName,
    platform,
    browser: getBrowserName(ua)
  };
}

function getBrowserName(ua: string): string {
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/edg/i.test(ua)) return 'Edge';
  return 'Browser';
}

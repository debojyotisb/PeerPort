export type ConnectionState =
  | 'IDLE'
  | 'DISCOVERING'
  | 'CONNECTING'
  | 'AWAITING_APPROVAL'
  | 'TRANSFERRING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'DISCONNECTED'
  | 'EXPIRED';

export type TransferRole = 'SENDER' | 'RECEIVER';

export type TransportMode =
  | 'LOCAL_HOTSPOT'
  | 'LOCAL_LAN'
  | 'WEBRTC_P2P'
  | 'WEBRTC_RELAY'
  | 'QR_MANUAL';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'browser';
  browser?: string;
  isNativeCompanion?: boolean;
}

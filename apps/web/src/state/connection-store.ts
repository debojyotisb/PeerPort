import { create } from 'zustand';
import { ConnectionState, TransportMode, TransferRole, DeviceInfo } from '@peerport/shared-types';
import { getLocalDeviceInfo } from '../services/device-info.js';

interface ConnectionStoreState {
  connectionState: ConnectionState;
  role: TransferRole | null;
  mode: TransportMode;
  localDevice: DeviceInfo;
  remoteDevice: DeviceInfo | null;
  roomId: string | null;
  roomPasscode: string | null;
  hotspotInfo: {
    ssid: string;
    passphrase?: string;
    url: string;
    qrPayload: string;
  } | null;
  errorMessage: string | null;
  isRelayActive: boolean;

  // Actions
  setConnectionState: (state: ConnectionState, error?: string) => void;
  setRole: (role: TransferRole | null) => void;
  setMode: (mode: TransportMode) => void;
  setRemoteDevice: (device: DeviceInfo | null) => void;
  setRoomId: (roomId: string | null, passcode?: string) => void;
  setHotspotInfo: (info: ConnectionStoreState['hotspotInfo']) => void;
  setRelayActive: (active: boolean) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  connectionState: 'IDLE',
  role: null,
  mode: 'WEBRTC_P2P',
  localDevice: getLocalDeviceInfo(),
  remoteDevice: null,
  roomId: null,
  roomPasscode: null,
  hotspotInfo: null,
  errorMessage: null,
  isRelayActive: false,

  setConnectionState: (state, error) => set({ connectionState: state, errorMessage: error || null }),
  setRole: (role) => set({ role }),
  setMode: (mode) => set({ mode }),
  setRemoteDevice: (remoteDevice) => set({ remoteDevice }),
  setRoomId: (roomId, roomPasscode) => set({ roomId, roomPasscode: roomPasscode || null }),
  setHotspotInfo: (hotspotInfo) => set({ hotspotInfo }),
  setRelayActive: (isRelayActive) => set({ isRelayActive }),
  reset: () =>
    set({
      connectionState: 'IDLE',
      role: null,
      remoteDevice: null,
      roomId: null,
      roomPasscode: null,
      hotspotInfo: null,
      errorMessage: null,
      isRelayActive: false
    })
}));

import { DeviceInfo } from './state.js';

export type SignalingMessageType =
  | 'JOIN_ROOM'
  | 'ROOM_JOINED'
  | 'PEER_JOINED'
  | 'PEER_LEFT'
  | 'OFFER'
  | 'ANSWER'
  | 'ICE_CANDIDATE'
  | 'TRANSFER_OFFER'
  | 'TRANSFER_ACCEPT'
  | 'TRANSFER_REJECT'
  | 'TRANSFER_CANCEL'
  | 'TRANSFER_COMPLETE'
  | 'HEARTBEAT'
  | 'ERROR';

export interface SignalingMessage<T = unknown> {
  type: SignalingMessageType;
  roomId: string;
  senderId: string;
  targetId?: string;
  payload: T;
  timestamp: number;
}

export interface JoinRoomPayload {
  device: DeviceInfo;
  passcode?: string;
}

export interface RoomJoinedPayload {
  roomId: string;
  selfId: string;
  existingPeers: DeviceInfo[];
  expiresAt: number;
}

export interface WebRtcSignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface TransferCompletePayload {
  transferId: string;
  fileId: string;
  sha256: string;
  verified: boolean;
}

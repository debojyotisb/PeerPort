import { ConnectionState, TransportMode, DeviceInfo } from './state.js';
import { TransferManifest, TransferResponse, BinaryChunk, TransferProgress } from './transfer.js';

export interface DiscoveredPeer {
  id: string;
  device: DeviceInfo;
  mode: TransportMode;
  lastSeen: number;
}

export interface PeerConnection {
  id: string;
  peer: DiscoveredPeer;
  mode: TransportMode;
  state: ConnectionState;
  send(data: string | ArrayBuffer | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface PeerTransportEvents {
  onPeerFound: (peer: DiscoveredPeer) => void;
  onPeerLost: (peerId: string) => void;
  onConnectionStateChange: (state: ConnectionState, reason?: string) => void;
  onTransferRequest: (manifest: TransferManifest, approve: (accepted: boolean) => Promise<void>) => void;
  onTransferResponse: (response: TransferResponse) => void;
  onProgress: (progress: TransferProgress) => void;
  onTransferComplete: (fileId: string, sha256: string) => void;
  onError: (error: Error) => void;
}

export interface PeerTransport {
  readonly mode: TransportMode;
  readonly connectionState: ConnectionState;
  
  initialize(): Promise<void>;
  discoverPeers(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(peerId: string): Promise<PeerConnection>;
  sendTransferRequest(connection: PeerConnection, manifest: TransferManifest): Promise<void>;
  respondTransferRequest(connection: PeerConnection, transferId: string, accepted: boolean): Promise<void>;
  sendChunk(connection: PeerConnection, chunk: BinaryChunk): Promise<void>;
  cancelTransfer(connection: PeerConnection, transferId: string): Promise<void>;
  closeConnection(connection: PeerConnection): Promise<void>;
  
  subscribe<K extends keyof PeerTransportEvents>(event: K, handler: PeerTransportEvents[K]): () => void;
}

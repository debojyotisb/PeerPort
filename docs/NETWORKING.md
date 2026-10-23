# PeerPort Networking Specification

## 1. Overview & Transport Abstraction

PeerPort decouples the application layer from physical network implementations via the `PeerTransport` interface. The application logic (file selection, transfer state machine, UI progress) interacts strictly with this transport contract.

```typescript
export interface PeerTransport {
  readonly mode: TransportMode;
  initialize(): Promise<void>;
  discoverPeers(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(peerId: string): Promise<PeerConnection>;
  sendTransferRequest(connection: PeerConnection, manifest: TransferManifest): Promise<void>;
  respondTransferRequest(connection: PeerConnection, accepted: boolean): Promise<void>;
  sendChunk(connection: PeerConnection, chunk: BinaryChunk): Promise<void>;
  closeConnection(connection: PeerConnection): Promise<void>;
  onPeerFound(callback: (peer: DiscoveredPeer) => void): void;
  onConnectionStateChange(callback: (state: ConnectionState) => void): void;
  onMessageReceived(callback: (message: ProtocolMessage) => void): void;
  onChunkReceived(callback: (chunk: BinaryChunk) => void): void;
}
```

---

## 2. Supported Transport Modes

### Mode 1: Fully Offline Local Sharing (`LOCAL_HOTSPOT` / `LOCAL_LAN`)
* **Mechanism**:
  - Android activates Local-Only Hotspot (`WifiManager.LocalOnlyHotspot`).
  - Companion micro-HTTP/WS server binds to `192.168.49.1:8080` (or `0.0.0.0:8080`).
  - QR Code displays `WIFI:S:PeerPort-XXXX;T:WPA;P:password;;http://192.168.49.1:8080`.
  - iOS joins Wi-Fi via native camera scan, opens Safari, and initiates transfer directly over local TCP/WebSocket.
* **Internet requirement**: NONE. Payload travels 100% locally.

### Mode 2: Internet-Assisted WebRTC Direct (`WEBRTC_P2P`)
* **Mechanism**:
  - Both devices connect to WebSocket signaling server (`wss://signaling.peerport.app`).
  - Devices exchange SDP Offer, SDP Answer, and ICE candidates.
  - `RTCPeerConnection` creates an unordered, reliable `RTCDataChannel`.
  - Data flows peer-to-peer over DTLS-SRTP.
* **Internet requirement**: Low bandwidth signaling only. Payload is direct P2P.

### Mode 3: Encrypted TURN Relay (`WEBRTC_RELAY`)
* **Mechanism**:
  - Used only when symmetric NAT or strict enterprise firewalls prevent direct P2P.
  - Encrypted chunks route through TURN relay server.
  - UI displays an explicit warning that transfer is traversing an encrypted relay.

---

## 3. WebRTC DataChannel Tuning & Backpressure Management

To achieve maximum throughput (50+ MB/s) while avoiding JavaScript heap exhaustion, WebRTC DataChannels are configured with:

1. **Chunk Sizing**: 64 KiB (65,536 bytes) per chunk. Larger chunks cause SCTP packet fragmentation and packet drops; smaller chunks introduce excessive per-chunk JS overhead.
2. **Backpressure Thresholding**:
   ```typescript
   dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256 KiB
   
   async function sendChunkWithBackpressure(dataChannel: RTCDataChannel, chunk: ArrayBuffer) {
     if (dataChannel.bufferedAmount > 1024 * 1024) { // 1 MB queue limit
       await new Promise<void>((resolve) => {
         dataChannel.onbufferedamountlow = () => {
           dataChannel.onbufferedamountlow = null;
           resolve();
         };
       });
     }
     dataChannel.send(chunk);
   }
   ```
3. **Delivery Mode**: Ordered = false (chunks carry sequence indexes in 32-byte binary headers, eliminating head-of-line blocking).

---

## 4. Connection State Machine

PeerPort tracks connection states using an immutable, validated transition table:

| Current State | Valid Next States | Trigger Event |
| :--- | :--- | :--- |
| `IDLE` | `DISCOVERING`, `CONNECTING` | Start scan / Join room |
| `DISCOVERING` | `CONNECTING`, `IDLE`, `FAILED` | Select peer / Cancel / Error |
| `CONNECTING` | `AWAITING_APPROVAL`, `FAILED`, `DISCONNECTED` | Handshake complete / Timeout |
| `AWAITING_APPROVAL` | `TRANSFERRING`, `REJECTED`, `CANCELLED` | Accept / Reject / Cancel |
| `TRANSFERRING` | `COMPLETED`, `FAILED`, `CANCELLED`, `DISCONNECTED` | All chunks + Hash verified |
| `COMPLETED` | `IDLE` | Reset / New transfer |
| `REJECTED` | `IDLE` | Reset |
| `FAILED` | `IDLE`, `CONNECTING` | Retry or Reset |


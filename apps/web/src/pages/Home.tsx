import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from '../components/Navbar.js';
import { FileDropzone } from '../components/FileDropzone.js';
import { ActionCards } from '../components/ActionCards.js';
import { QrModal } from '../components/QrModal.js';
import { ApprovalDialog } from '../components/ApprovalDialog.js';
import { TransferModal } from '../components/TransferModal.js';
import { CompletionModal } from '../components/CompletionModal.js';
import { ArchitectureHelpModal } from '../components/ArchitectureHelpModal.js';
import { useConnectionStore } from '../state/connection-store.js';
import { useTransferStore } from '../state/transfer-store.js';
import { WebRtcTransport } from '../services/webrtc-transport.js';
import { TransferEngine } from '../services/transfer-engine.js';
import { generateSecureId } from '../services/device-info.js';
import { triggerFileDownload } from '../services/file-selection.js';
import { PeerConnection } from '@peerport/shared-types';
import { Loader2, UserCheck, AlertCircle, RefreshCw } from 'lucide-react';

export const Home: React.FC = () => {
  const {
    connectionState,
    role,
    roomId,
    remoteDevice,
    errorMessage,
    setConnectionState,
    setRole,
    setRoomId,
    setRemoteDevice,
    setMode,
    reset: resetConnection
  } = useConnectionStore();

  const {
    selectedFiles,
    incomingManifest,
    progress,
    completedFiles,
    setIncomingManifest,
    setProgress,
    addCompletedFile,
    resetTransfer
  } = useTransferStore();

  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [transferEngine] = useState(() => new TransferEngine());
  const transportRef = useRef<WebRtcTransport | null>(null);
  const connectionRef = useRef<PeerConnection | null>(null);
  const approveCallbackRef = useRef<((accepted: boolean) => Promise<void>) | null>(null);

  // Check URL parameters for direct session joining (supports ?join=ID, /join/ID, or #join=ID)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let joinSessionId: string | null = null;

    // Check search query ?join=SESSION_ID
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('join')) {
      joinSessionId = urlParams.get('join');
    }

    // Check hash #join=SESSION_ID
    if (!joinSessionId && window.location.hash) {
      const match = window.location.hash.match(/[#&?]join=([A-Za-z0-9_-]+)/);
      if (match && match[1]) joinSessionId = match[1];
    }

    // Check pathname /join/SESSION_ID
    if (!joinSessionId && window.location.pathname.startsWith('/join/')) {
      const parts = window.location.pathname.split('/join/');
      if (parts[1]) joinSessionId = parts[1].replace(/\/+$/, '');
    }

    if (joinSessionId && connectionState === 'IDLE') {
      handleJoinSession(joinSessionId);
    }
  }, []);

  const handleStartSharing = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file before generating a sharing session.');
      return;
    }

    const sessionId = generateSecureId('ses');
    setRoomId(sessionId);
    setRole('SENDER');
    setMode('WEBRTC_P2P');
    setConnectionState('CONNECTING');

    const webrtc = new WebRtcTransport();
    transportRef.current = webrtc;
    setupTransportListeners(webrtc, 'SENDER');

    try {
      await webrtc.joinRoom(sessionId);
      setIsQrModalOpen(true);
    } catch (err: any) {
      console.error('Failed to create sharing session:', err);
      setConnectionState('FAILED', err.message || 'Could not connect to signaling service');
    }
  };

  const handleJoinSession = async (sessionId: string) => {
    if (!sessionId) return;

    setRoomId(sessionId);
    setRole('RECEIVER');
    setMode('WEBRTC_P2P');
    setConnectionState('CONNECTING');

    const webrtc = new WebRtcTransport();
    transportRef.current = webrtc;
    setupTransportListeners(webrtc, 'RECEIVER');

    try {
      await webrtc.joinRoom(sessionId);
      setIsQrModalOpen(false);
    } catch (err: any) {
      console.error('Failed to join session:', err);
      setConnectionState('FAILED', err.message || 'Could not join session');
    }
  };

  const setupTransportListeners = (webrtc: WebRtcTransport, currentRole: 'SENDER' | 'RECEIVER') => {
    webrtc.subscribe('onConnectionStateChange', (state: any, reason?: any) => {
      setConnectionState(state, reason);
    });

    webrtc.subscribe('onPeerFound', async (peer: any) => {
      setRemoteDevice(peer.device);

      // As the sender, when the receiver joins the room, initiate WebRTC peer connection
      if (currentRole === 'SENDER') {
        try {
          const conn = await webrtc.connect(peer.id);
          connectionRef.current = conn;
        } catch (err: any) {
          console.error('WebRTC connect error:', err);
          setConnectionState('FAILED', 'Failed to negotiate direct peer connection');
        }
      }
    });

    webrtc.subscribe('onPeerLost', () => {
      setRemoteDevice(null);
      if (connectionState === 'TRANSFERRING' || connectionState === 'AWAITING_APPROVAL') {
        setConnectionState('DISCONNECTED', 'Remote device disconnected');
      }
    });

    webrtc.subscribe('onChannelReady', async () => {
      // DataChannel is open! If we are the sender with selected files, dispatch transfer manifest
      if (currentRole === 'SENDER' && selectedFiles.length > 0) {
        setIsQrModalOpen(false);
        const manifest = transferEngine.createManifest(selectedFiles);
        try {
          await webrtc.sendTransferRequest(connectionRef.current || ({ id: 'receiver' } as any), manifest);
          setConnectionState('AWAITING_APPROVAL');
        } catch (err: any) {
          console.error('Failed to send transfer manifest:', err);
        }
      }
    });

    webrtc.subscribe('onTransferRequest', (manifest: any, approveCallback: any) => {
      approveCallbackRef.current = approveCallback;
      setIncomingManifest(manifest);
      setConnectionState('AWAITING_APPROVAL');
    });

    webrtc.subscribe('onTransferResponse', async (response: any) => {
      if (response.accepted) {
        setConnectionState('TRANSFERRING');
        setIsQrModalOpen(false);

        // Sender: Start streaming real file chunks with backpressure
        if (currentRole === 'SENDER' && selectedFiles.length > 0) {
          const manifest = transferEngine.createManifest(selectedFiles);
          try {
            for (let i = 0; i < selectedFiles.length; i++) {
              const file = selectedFiles[i];
              const sha256 = await transferEngine.sendFile(
                webrtc,
                connectionRef.current || ({ id: 'receiver' } as any),
                file,
                manifest,
                i,
                (prog) => setProgress(prog)
              );

              addCompletedFile({
                id: file.name,
                name: file.name,
                size: file.size,
                mimeType: file.type || 'application/octet-stream',
                sha256,
                blob: file,
                blobUrl: URL.createObjectURL(file),
                verified: true
              });
            }
            setConnectionState('COMPLETED');
          } catch (err: any) {
            console.error('Transfer stream error:', err);
            setConnectionState('FAILED', err.message || 'File transfer was interrupted');
          }
        }
      } else {
        setConnectionState('REJECTED', response.reason || 'Receiver declined the transfer request');
      }
    });

    // Receiver: Handle real incoming chunks over WebRTC DataChannel
    webrtc.subscribe('onChunkReceived', async (chunk: any) => {
      try {
        const completedFile = await transferEngine.handleIncomingChunk(chunk, (prog) => {
          setProgress(prog);
        });

        if (completedFile) {
          addCompletedFile(completedFile);
          // Automatically trigger native browser download
          if (completedFile.blob) {
            triggerFileDownload(completedFile.blob, completedFile.name);
          }

          if (transferEngine.isAllFilesReceived()) {
            setConnectionState('COMPLETED');
          }
        }
      } catch (err: any) {
        console.error('Error handling chunk on receiver:', err);
      }
    });

    webrtc.subscribe('onError', (err: any) => {
      setConnectionState('FAILED', err.message);
    });
  };

  const handleApprovalResponse = async (accepted: boolean) => {
    if (approveCallbackRef.current) {
      await approveCallbackRef.current(accepted);
    }

    if (accepted && incomingManifest) {
      transferEngine.prepareReceiver(incomingManifest);
      setConnectionState('TRANSFERRING');
    } else {
      setConnectionState('REJECTED');
      setIncomingManifest(null);
    }
  };

  const handleCancelTransfer = () => {
    transferEngine.cancel();
    if (transportRef.current && connectionRef.current) {
      transportRef.current.cancelTransfer(connectionRef.current, 'current');
    }
    setConnectionState('CANCELLED');
  };

  const handleResetAll = () => {
    resetConnection();
    resetTransfer();
    transferEngine.cancel();
    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }
    connectionRef.current = null;
    approveCallbackRef.current = null;
    setIsQrModalOpen(false);

    // Clean URL query if in join mode
    if (typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Navbar onOpenHelp={() => setIsHelpOpen(true)} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col items-center">
        {/* Receiver Waiting Banner (shown when receiver opens QR code join link) */}
        {role === 'RECEIVER' && connectionState !== 'COMPLETED' && (
          <div className="w-full mb-6 p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-sky-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Receiver Session Active
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {remoteDevice
                    ? `Connected to sender: ${remoteDevice.deviceName}. Waiting for file offer...`
                    : 'Connecting to sender. Please wait for the sender to send files...'}
                </p>
              </div>
            </div>
            <button
              onClick={handleResetAll}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Exit
            </button>
          </div>
        )}

        {/* Failure / Disconnection banner */}
        {(connectionState === 'FAILED' || connectionState === 'DISCONNECTED' || connectionState === 'REJECTED') && (
          <div className="w-full mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  {connectionState === 'REJECTED' ? 'Transfer Declined' : 'Connection Interrupted'}
                </h4>
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {errorMessage || (connectionState === 'REJECTED' ? 'The transfer request was declined by the receiver.' : 'The connection to the other device was lost.')}
                </p>
              </div>
            </div>
            <button
              onClick={handleResetAll}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        )}

        {/* Hero title */}
        <div className="text-center max-w-xl mx-auto mb-8">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-3">
            Cross-Platform Direct Sharing
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
            Share photos, videos, and documents between Android, iPhone, and PC with zero cloud uploads. The receiver scans the QR code or opens the link—no app install needed.
          </p>
        </div>

        {/* File Dropzone */}
        <div className="w-full mb-8">
          <FileDropzone />
        </div>

        {/* Action Cards */}
        <ActionCards
          onFindNearby={handleStartSharing}
          onShareWithBrowser={handleStartSharing}
        />
      </main>

      {/* QR Code Modal for Sender */}
      <QrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        onJoinRoom={handleJoinSession}
      />

      {/* Receiver Approval Dialog */}
      <ApprovalDialog
        manifest={incomingManifest}
        onApprove={handleApprovalResponse}
      />

      {/* Live Chunk Transfer Progress Modal */}
      <TransferModal
        isOpen={connectionState === 'TRANSFERRING'}
        role={role}
        progress={progress}
        onCancel={handleCancelTransfer}
      />

      {/* Transfer Completion & Verification Modal */}
      <CompletionModal
        isOpen={connectionState === 'COMPLETED'}
        completedFiles={completedFiles}
        onReset={handleResetAll}
      />

      {/* Architectural Documentation & Feasibility Modal */}
      <ArchitectureHelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-500 dark:text-slate-500">
        PeerPort • Privacy-First Direct Transport • 100% Zero-Cloud Payload Guarantee
      </footer>
    </div>
  );
};

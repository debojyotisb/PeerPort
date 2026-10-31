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
import { PeerConnection, TransferManifest, TransferCompletePayload } from '@peerport/shared-types';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

export const Home: React.FC = () => {
  const {
    connectionState,
    role,
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
    setOutgoingManifest,
    setIncomingManifest,
    setProgress,
    addCompletedFile,
    resetTransfer
  } = useTransferStore();

  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [transferEngine] = useState(() => new TransferEngine());

  // Stable references across component renders and transfer lifecycles
  const transportRef = useRef<WebRtcTransport | null>(null);
  const connectionRef = useRef<PeerConnection | null>(null);
  const approveCallbackRef = useRef<((accepted: boolean) => Promise<void>) | null>(null);
  const activeManifestRef = useRef<TransferManifest | null>(null);
  const incomingManifestRef = useRef<TransferManifest | null>(null);
  const activeTransferManifestRef = useRef<TransferManifest | null>(null);
  const sentHashesRef = useRef<Map<string, string>>(new Map());
  const ackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transportCleanupRef = useRef<(() => void) | null>(null);

  // Sync incomingManifest ref
  useEffect(() => {
    incomingManifestRef.current = incomingManifest;
  }, [incomingManifest]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (ackTimeoutRef.current) {
        clearTimeout(ackTimeoutRef.current);
        ackTimeoutRef.current = null;
      }
      transportCleanupRef.current?.();
      transportCleanupRef.current = null;
      transportRef.current?.close();
      transportRef.current = null;
    };
  }, []);

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

    // Clean up previous transport session if any
    transportCleanupRef.current?.();
    transportCleanupRef.current = null;
    transportRef.current?.close();

    const sessionId = generateSecureId('ses');
    setRoomId(sessionId);
    setRole('SENDER');
    setMode('WEBRTC_P2P');
    setConnectionState('CONNECTING');

    activeManifestRef.current = null;
    activeTransferManifestRef.current = null;
    sentHashesRef.current.clear();

    // Clean URL query if present so sender is never confused with a join session on re-render
    if (typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const webrtc = new WebRtcTransport();
    transportRef.current = webrtc;
    transportCleanupRef.current = setupTransportListeners(webrtc, 'SENDER');

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

    // Clean up previous transport session if any
    transportCleanupRef.current?.();
    transportCleanupRef.current = null;
    transportRef.current?.close();

    setRoomId(sessionId);
    setRole('RECEIVER');
    setMode('WEBRTC_P2P');
    setConnectionState('CONNECTING');

    activeManifestRef.current = null;
    activeTransferManifestRef.current = null;
    sentHashesRef.current.clear();

    const webrtc = new WebRtcTransport();
    transportRef.current = webrtc;
    transportCleanupRef.current = setupTransportListeners(webrtc, 'RECEIVER');

    try {
      await webrtc.joinRoom(sessionId);
      setIsQrModalOpen(false);
    } catch (err: any) {
      console.error('Failed to join session:', err);
      setConnectionState('FAILED', err.message || 'Could not join session');
    }
  };

  const setupTransportListeners = (webrtc: WebRtcTransport, currentRole: 'SENDER' | 'RECEIVER'): (() => void) => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      webrtc.subscribe('onConnectionStateChange', (state: any, reason?: any) => {
        setConnectionState(state, reason);
      })
    );

    unsubs.push(
      webrtc.subscribe('onPeerFound', async (peer: any) => {
        setRemoteDevice(peer.device);

        // Sender initiates WebRTC connection when receiver joins room
        if (currentRole === 'SENDER') {
          try {
            const conn = await webrtc.connect(peer.id);
            connectionRef.current = conn;
          } catch (err: any) {
            console.error('WebRTC connect error:', err);
            setConnectionState('FAILED', 'Failed to negotiate direct peer connection');
          }
        }
      })
    );

    unsubs.push(
      webrtc.subscribe('onPeerLost', () => {
        setRemoteDevice(null);
        if (connectionState === 'TRANSFERRING' || connectionState === 'AWAITING_APPROVAL') {
          setConnectionState('DISCONNECTED', 'Remote device disconnected');
        }
      })
    );

    unsubs.push(
      webrtc.subscribe('onChannelReady', async () => {
        // DataChannel is open! Sender dispatches transfer manifest
        if (currentRole === 'SENDER' && selectedFiles.length > 0) {
          setIsQrModalOpen(false);

          // Generate manifest EXACTLY ONCE for this transfer session
          let manifest = activeManifestRef.current;
          if (!manifest) {
            manifest = transferEngine.createManifest(selectedFiles);
            activeManifestRef.current = manifest;
            setOutgoingManifest(manifest);
          }

          try {
            await webrtc.sendTransferRequest(connectionRef.current || ({ id: 'receiver' } as any), manifest);
            setConnectionState('AWAITING_APPROVAL');
          } catch (err: any) {
            console.error('Failed to send transfer manifest:', err);
          }
        }
      })
    );

    unsubs.push(
      webrtc.subscribe('onTransferRequest', (manifest: TransferManifest, approveCallback: any) => {
        if (currentRole === 'RECEIVER') {
          approveCallbackRef.current = approveCallback;
          setIncomingManifest(manifest);
          incomingManifestRef.current = manifest;
          setConnectionState('AWAITING_APPROVAL');
        }
      })
    );

    unsubs.push(
      webrtc.subscribe('onTransferResponse', async (response: any) => {
        if (response.accepted) {
          setConnectionState('TRANSFERRING');
          setIsQrModalOpen(false);

          // Sender: stream chunks using the STABLE manifest instance created earlier
          if (currentRole === 'SENDER' && selectedFiles.length > 0) {
            const manifest = activeManifestRef.current;
            if (!manifest) {
              console.error('Active outgoing manifest missing during send');
              setConnectionState('FAILED', 'Transfer manifest missing');
              return;
            }

            try {
              sentHashesRef.current.clear();

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

                const fileId = manifest.files[i]?.id || `file_${i}`;
                sentHashesRef.current.set(fileId, sha256);
              }

              // All chunks transmitted: Sender enters waiting state for receiver acknowledgement
              // Set a 30-second timeout so sender doesn't wait indefinitely if receiver crashes
              if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
              ackTimeoutRef.current = setTimeout(() => {
                if (useConnectionStore.getState().connectionState === 'TRANSFERRING') {
                  setConnectionState(
                    'FAILED',
                    'Delivery acknowledgement timed out: receiver did not confirm file receipt.'
                  );
                }
              }, 30_000);
            } catch (err: any) {
              console.error('Transfer stream error:', err);
              setConnectionState('FAILED', err.message || 'File transfer was interrupted');
            }
          }
        } else {
          setConnectionState('REJECTED', response.reason || 'Receiver declined the transfer request');
        }
      })
    );

    // Receiver: Handle real incoming chunks over WebRTC DataChannel
    unsubs.push(
      webrtc.subscribe('onChunkReceived', async (chunk: any) => {
        if (currentRole !== 'RECEIVER') return;

        try {
          const completedFile = await transferEngine.handleIncomingChunk(chunk, (prog) => {
            setProgress(prog);
          });

          if (completedFile) {
            // Deduplicated insertion into store by stable file ID
            addCompletedFile(completedFile);

            // NO automatic triggerFileDownload: user must explicitly click "Save"

            if (transferEngine.isAllFilesReceived()) {
              // All files assembled and SHA-256 verified!
              const currentActive = activeTransferManifestRef.current || transferEngine.getActiveManifest();
              const verifiedList = useTransferStore.getState().completedFiles.map((f) => ({
                fileId: f.id,
                sha256: f.sha256,
                verified: f.verified
              }));

              if (currentActive) {
                try {
                  await webrtc.sendTransferComplete(connectionRef.current || ({ id: 'sender' } as any), {
                    transferId: currentActive.transferId,
                    verified: true,
                    files: verifiedList
                  });
                } catch (ackErr) {
                  console.warn('Failed to send completion acknowledgement to sender:', ackErr);
                }
              }

              setConnectionState('COMPLETED');
            }
          }
        } catch (err: any) {
          console.error('Error handling chunk on receiver:', err);
        }
      })
    );

    // Sender: Receive TRANSFER_COMPLETE acknowledgement from receiver
    unsubs.push(
      webrtc.subscribe('onTransferComplete', (payload: TransferCompletePayload) => {
        if (currentRole === 'SENDER') {
          if (ackTimeoutRef.current) {
            clearTimeout(ackTimeoutRef.current);
            ackTimeoutRef.current = null;
          }

          const manifest = activeManifestRef.current;
          if (!manifest || payload.transferId !== manifest.transferId) {
            console.warn('Received TRANSFER_COMPLETE for mismatched transfer ID:', payload.transferId);
            return;
          }

          if (!payload.verified) {
            setConnectionState('FAILED', 'Receiver reported integrity checksum verification failure.');
            return;
          }

          // Receiver verified successfully! Populate completed files on sender for delivery summary
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const fileMeta = manifest.files[i];
            const fileId = fileMeta?.id || `file_${i}`;
            addCompletedFile({
              id: fileId,
              name: file.name,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
              sha256: sentHashesRef.current.get(fileId) || '',
              verified: true
            });
          }

          setConnectionState('COMPLETED');
        }
      })
    );

    unsubs.push(
      webrtc.subscribe('onError', (err: any) => {
        setConnectionState('FAILED', err.message);
      })
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  };

  const handleApprovalResponse = async (accepted: boolean) => {
    // 1. Capture the current manifest before clearing UI state
    const manifest = incomingManifest || incomingManifestRef.current;

    // Clear approveCallbackRef after capturing it so no stale callback persists
    const approveCallback = approveCallbackRef.current;
    approveCallbackRef.current = null;

    // Clear incomingManifest and incomingManifestRef immediately so ApprovalDialog closes immediately
    setIncomingManifest(null);
    incomingManifestRef.current = null;

    if (accepted && manifest) {
      // 1. Prepare the receiver transfer engine SYNCHRONOUSLY before sending accept,
      // preventing the first incoming chunk from being dropped on rapid transmission.
      activeTransferManifestRef.current = manifest;
      transferEngine.prepareReceiver(manifest);

      // 3. If approval callback is missing, cancel engine, clear ref, and transition to FAILED
      if (!approveCallback) {
        activeTransferManifestRef.current = null;
        transferEngine.cancel();
        setConnectionState('FAILED', 'Approval callback missing. Could not notify sender.');
        return;
      }

      // 2. Await the approval callback. Only transition the UI to TRANSFERRING after successful approval communication.
      try {
        await approveCallback(true);
        setConnectionState('TRANSFERRING');
      } catch (err: any) {
        console.error('Failed to communicate acceptance to sender:', err);
        // 3. If approval callback fails, cancel engine, clear ref, and transition to FAILED
        activeTransferManifestRef.current = null;
        transferEngine.cancel();
        setConnectionState(
          'FAILED',
          'Could not send transfer approval to sender. Please check your connection and try again.'
        );
      }
    } else {
      // 4. For rejection, clear active manifest, transition to REJECTED, and communicate rejection safely
      activeTransferManifestRef.current = null;
      setConnectionState('REJECTED');

      if (approveCallback) {
        try {
          await approveCallback(false);
        } catch (err) {
          console.warn('Failed to communicate decline to sender:', err);
        }
      }
    }
  };

  const handleCancelTransfer = () => {
    if (ackTimeoutRef.current) {
      clearTimeout(ackTimeoutRef.current);
      ackTimeoutRef.current = null;
    }
    activeTransferManifestRef.current = null;
    transferEngine.cancel();
    if (transportRef.current && connectionRef.current) {
      transportRef.current.cancelTransfer(connectionRef.current, 'current');
    }
    setConnectionState('CANCELLED');
  };

  const handleResetAll = () => {
    if (ackTimeoutRef.current) {
      clearTimeout(ackTimeoutRef.current);
      ackTimeoutRef.current = null;
    }

    transportCleanupRef.current?.();
    transportCleanupRef.current = null;

    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }

    connectionRef.current = null;
    approveCallbackRef.current = null;
    activeManifestRef.current = null;
    incomingManifestRef.current = null;
    activeTransferManifestRef.current = null;
    sentHashesRef.current.clear();
    setIsQrModalOpen(false);

    // Revoke any blob URLs safely before store reset
    completedFiles.forEach((f) => {
      if (f.blobUrl) {
        try {
          URL.revokeObjectURL(f.blobUrl);
        } catch {}
      }
    });

    resetConnection();
    resetTransfer();
    transferEngine.cancel();

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
        role={role}
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

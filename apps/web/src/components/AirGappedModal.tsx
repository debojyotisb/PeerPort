import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  X,
  QrCode,
  Camera,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Clipboard,
  ShieldCheck,
  Eye,
  CameraOff,
  WifiOff,
  HelpCircle
} from 'lucide-react';
import { AirGappedTransport } from '../services/air-gapped-transport.js';
import {
  QrSignalingPacket,
  QrPayloadReassembler,
  parseAndValidateQrPayload
} from '../services/qr-signaling.js';
import { generateSecureId } from '../services/device-info.js';

export type AirGappedPhase =
  | 'INITIALIZING'
  | 'CREATING_OFFER'
  | 'GENERATING_QR'
  | 'WAITING_FOR_RECEIVER'
  | 'SCANNING_ANSWER'
  | 'SCANNING_OFFER'
  | 'GENERATING_ANSWER'
  | 'WAITING_FOR_SENDER'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'FAILED';

interface AirGappedModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: 'SENDER' | 'RECEIVER';
  transport: AirGappedTransport | null;
  sessionId: string;
  onSessionReady?: (role: 'SENDER' | 'RECEIVER', sessionId: string) => void;
  onRetry?: () => void;
}

export const AirGappedModal: React.FC<AirGappedModalProps> = ({
  isOpen,
  onClose,
  role: initialRole,
  transport,
  sessionId,
  onSessionReady,
  onRetry
}) => {
  const [role, setRole] = useState<'SENDER' | 'RECEIVER'>(initialRole);
  const [phase, setPhase] = useState<AirGappedPhase>('INITIALIZING');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // QR display state
  const [packets, setPackets] = useState<QrSignalingPacket[]>([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [autoCycle, setAutoCycle] = useState(true);

  // Scanner state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ received: number; total: number }>({ received: 0, total: 1 });
  const [manualPayloadText, setManualPayloadText] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reassemblerRef = useRef<QrPayloadReassembler>(new QrPayloadReassembler());
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGeneratingOfferRef = useRef(false);

  // Initialize role and workflow when modal opens
  useEffect(() => {
    if (isOpen) {
      setRole(initialRole);
      setErrorMessage(null);
      setCameraError(null);
      setManualError(null);
      setManualPayloadText('');
      setPackets([]);
      setActiveFrameIndex(0);
      setQrDataUrl('');
      isGeneratingOfferRef.current = false;
      reassemblerRef.current.reset();

      if (initialRole === 'SENDER') {
        startSenderOffer();
      } else {
        setPhase('SCANNING_OFFER');
        setStatusMessage('Point camera at the Offer QR code on the sender device.');
      }
    } else {
      cleanup();
    }
  }, [isOpen, initialRole, sessionId]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    stopCamera();
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  // Subscribe to transport connection lifecycle
  useEffect(() => {
    if (!transport || !isOpen) return;

    const unsubs: (() => void)[] = [];

    // Triggered when DataChannel transitions to 'open'
    unsubs.push(
      transport.subscribe('onChannelReady', () => {
        setPhase('CONNECTED');
        setStatusMessage('Direct P2P DataChannel connected! Preparing file transfer...');
        stopCamera();

        // Automatically dismiss modal after 800ms to allow transfer to start cleanly
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = setTimeout(() => {
          onClose();
        }, 800);
      })
    );

    // Triggered on connection state transitions
    unsubs.push(
      transport.subscribe('onConnectionStateChange', (state: any, reason?: string) => {
        console.log(`[DIAG STATE] [${new Date().toISOString()}] AirGappedModal received onConnectionStateChange -> ${state} (current phase: ${phase}, reason: ${reason || 'none'})`);
        if (state === 'FAILED') {
          setPhase('FAILED');
          setErrorMessage(reason || 'Failed to establish direct peer connection. Check local network.');
          stopCamera();
        } else if (
          state === 'CONNECTING' &&
          phase !== 'CONNECTED' &&
          phase !== 'CREATING_OFFER' &&
          phase !== 'GENERATING_QR' &&
          phase !== 'WAITING_FOR_RECEIVER' &&
          phase !== 'GENERATING_ANSWER' &&
          phase !== 'WAITING_FOR_SENDER'
        ) {
          console.warn(`[DIAG WARN] [${new Date().toISOString()}] Transitioning phase ${phase} -> CONNECTING`);
          setPhase('CONNECTING');
          setStatusMessage('Negotiating direct WebRTC link over local network...');
        }
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [transport, isOpen, phase, onClose]);

  // Sender: generate Offer payloads
  const startSenderOffer = async () => {
    if (!transport) {
      console.warn(`[DIAG WARN] [${new Date().toISOString()}] startSenderOffer called without transport instance!`);
      return;
    }
    if (isGeneratingOfferRef.current) {
      console.log(`[DIAG DUP] [${new Date().toISOString()}] startSenderOffer already in progress, skipping duplicate invocation`);
      return;
    }
    isGeneratingOfferRef.current = true;
    console.log(`[DIAG START] [${new Date().toISOString()}] startSenderOffer started (sessionId: ${sessionId})`);
    setPhase('CREATING_OFFER');
    setStatusMessage('Generating local WebRTC offer with host candidates...');
    setErrorMessage(null);

    try {
      setPhase('GENERATING_QR');
      const generatedPackets = await transport.createOfferPayloads(sessionId);
      console.log(`[DIAG OFFERS] [${new Date().toISOString()}] Generated packets received in modal: ${generatedPackets.length}`);
      setPackets(generatedPackets);
      setActiveFrameIndex(0);
      setPhase('WAITING_FOR_RECEIVER');
      setStatusMessage('Show this Offer QR code to the receiver.');
    } catch (err: any) {
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] Failed to create offer payloads:`, err);
      setPhase('FAILED');
      setErrorMessage(err.message || 'Failed to gather local network addresses. Ensure Wi-Fi or hotspot is active.');
    } finally {
      isGeneratingOfferRef.current = false;
    }
  };

  // Render QR image whenever packets or active frame changes
  useEffect(() => {
    if (packets.length === 0) {
      setQrDataUrl('');
      return;
    }

    const currentPacket = packets[activeFrameIndex];
    if (!currentPacket) return;

    const raw = JSON.stringify(currentPacket);
    const renderStartTime = performance.now();
    console.log(
      `[DIAG 14] [${new Date().toISOString()}] QR rendering started (frame: ${activeFrameIndex + 1}/${packets.length}, payload length: ${raw.length} chars)`
    );

    QRCode.toDataURL(raw, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
      .then((url) => {
        const duration = (performance.now() - renderStartTime).toFixed(1);
        console.log(
          `[DIAG 15] [${new Date().toISOString()}] QR rendering completed (duration: ${duration}ms, dataUrl length: ${url.length} chars)`
        );
        setQrDataUrl(url);
      })
      .catch((err) => {
        console.error(`[DIAG ERROR] [${new Date().toISOString()}] Error generating QR image:`, err);
        setErrorMessage(`QR generation error: ${err.message || 'Data too large for QR code'}`);
      });
  }, [packets, activeFrameIndex]);

  // Multi-frame QR auto-cycling
  useEffect(() => {
    const isShowingQr = phase === 'WAITING_FOR_RECEIVER' || phase === 'WAITING_FOR_SENDER';
    if (packets.length <= 1 || !autoCycle || !isShowingQr) return;

    const timer = setInterval(() => {
      setActiveFrameIndex((prev) => (prev + 1) % packets.length);
    }, 2000);

    return () => clearInterval(timer);
  }, [packets.length, autoCycle, phase]);

  // Camera management for scanning phases
  useEffect(() => {
    const isScanning = phase === 'SCANNING_OFFER' || phase === 'SCANNING_ANSWER';
    if (isOpen && isScanning) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isOpen, phase]);

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access not supported in this browser. Use manual payload entry below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }
      setCameraActive(true);
      startBarcodeDetection();
    } catch (err: any) {
      console.warn('Camera access denied or failed:', err);
      setCameraError('Camera access unavailable. Use manual payload entry below.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  };

  const startBarcodeDetection = () => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleScannedPayload(barcodes[0].rawValue);
            }
          } catch {
            // Transient frame processing error, ignore
          }
        }, 250);
        return;
      } catch (err) {
        console.warn('BarcodeDetector initialization failed:', err);
      }
    }

    setCameraError('Native QR scanner unavailable in this browser. Use manual payload entry below.');
  };

  const handleScannedPayload = async (rawText: string) => {
    try {
      const packet = parseAndValidateQrPayload(rawText);
      const expectedSession = role === 'SENDER' ? sessionId : undefined;

      const result = await reassemblerRef.current.processPacket(packet, expectedSession);
      const progress = reassemblerRef.current.getProgress();
      setScanProgress(progress);

      if (result) {
        stopCamera();

        if (role === 'SENDER' && result.type === 'answer') {
          // Sender received answer -> Connecting
          setPhase('CONNECTING');
          setStatusMessage('Applying remote answer and establishing connection...');
          if (transport) {
            await transport.applyAnswer(result.sdp);
          }
        } else if (role === 'RECEIVER' && result.type === 'offer') {
          // Receiver received offer -> Generating Answer
          setPhase('GENERATING_ANSWER');
          setStatusMessage('Processing offer and generating local answer...');
          if (transport) {
            onSessionReady?.('RECEIVER', result.sessionId);
            const answerPackets = await transport.createAnswerPayloads(result.sessionId, result.sdp);
            setPackets(answerPackets);
            setActiveFrameIndex(0);
            setPhase('WAITING_FOR_SENDER');
            setStatusMessage('Show this Answer QR code to the sender to finalize the link.');
          }
        }
      }
    } catch (err: any) {
      setManualError(err.message || 'Invalid QR payload format');
    }
  };

  const handleManualSubmit = () => {
    if (!manualPayloadText.trim()) {
      setManualError('Please paste the payload JSON text first.');
      return;
    }
    setManualError(null);
    handleScannedPayload(manualPayloadText.trim());
  };

  const handleCopyCurrentPacket = () => {
    const current = packets[activeFrameIndex];
    if (!current) return;
    navigator.clipboard.writeText(JSON.stringify(current));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = () => {
    cleanup();
    setErrorMessage(null);
    setManualError(null);
    setManualPayloadText('');
    reassemblerRef.current.reset();

    if (onRetry) {
      onRetry();
      return;
    }

    // Default self-contained retry
    const newSessionId = generateSecureId('ses');
    onSessionReady?.(role, newSessionId);

    if (role === 'SENDER') {
      startSenderOffer();
    } else {
      setPhase('SCANNING_OFFER');
      setStatusMessage('Point camera at the Offer QR code on the sender device.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <QrCode className="w-5 h-5" />
            </span>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Air-Gapped Offline Transfer
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            100% serverless peer-to-peer WebRTC. No internet, router, or external servers required.
          </p>
        </div>

        {/* Connection Phase / Status Pill */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 mb-5 text-xs font-semibold">
          <div className="flex items-center gap-2">
            {phase === 'CONNECTED' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 animate-bounce" />
            ) : phase === 'FAILED' ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />
            )}
            <span className={phase === 'CONNECTED' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : phase === 'FAILED' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'}>
              {statusMessage || phase}
            </span>
          </div>

          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono uppercase">
            {role}
          </span>
        </div>

        {/* FAILED STATE VIEW */}
        {phase === 'FAILED' && (
          <div className="flex flex-col items-center py-4 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Connection Failed
            </h4>
            <p className="text-xs text-rose-600 dark:text-rose-400 mb-4 max-w-sm">
              {errorMessage || 'Unable to establish direct peer-to-peer connection.'}
            </p>

            <div className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-600 dark:text-slate-400 mb-5 space-y-1.5">
              <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-1">
                <HelpCircle className="w-3.5 h-3.5 text-sky-500" />
                <span>Troubleshooting Checklist:</span>
              </div>
              <p>• Ensure both devices are connected to the same Wi-Fi network or phone hotspot.</p>
              <p>• If using a phone hotspot, ensure mobile data is turned off if you want genuine 0% internet.</p>
              <p>• If using a commercial Wi-Fi router, ensure AP/Client isolation is disabled.</p>
              <p>• Ensure both QR codes were scanned completely without glare.</p>
            </div>

            <button
              type="button"
              onClick={handleRetry}
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-md shadow-sky-600/20"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* CONNECTED SUCCESS VIEW */}
        {phase === 'CONNECTED' && (
          <div className="flex flex-col items-center py-8 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-10 h-10 animate-scale-in" />
            </div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              Direct P2P Link Established!
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              WebRTC DataChannel is open. Transitioning to file transfer...
            </p>
          </div>
        )}

        {/* CONNECTING IN-PROGRESS VIEW */}
        {phase === 'CONNECTING' && (
          <div className="flex flex-col items-center py-8 text-center animate-fade-in">
            <Loader2 className="w-12 h-12 text-sky-500 animate-spin mb-4" />
            <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Establishing Direct Connection
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
              Exchanging SCTP handshake packets directly over your local Wi-Fi or hotspot. This usually takes 1-3 seconds...
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
              <span>Zero cloud servers involved • 100% direct</span>
            </div>
          </div>
        )}

        {/* SENDER STEP 1: Offer QR Display */}
        {role === 'SENDER' && (phase === 'CREATING_OFFER' || phase === 'GENERATING_QR' || phase === 'WAITING_FOR_RECEIVER') && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 1:</strong> On the receiving phone, tap <em>"Receive Files"</em> and scan this code with the camera.
            </div>

            {phase === 'CREATING_OFFER' || phase === 'GENERATING_QR' ? (
              <div className="w-64 h-64 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-2" />
                <span className="text-xs text-slate-500">Compressing local SDP offer...</span>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-3 flex flex-col items-center min-w-[240px] min-h-[240px] justify-center">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Offer QR" className="w-56 h-56 rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-2" />
                    <span className="text-xs text-slate-500">Rendering QR Code...</span>
                  </div>
                )}
              </div>
            )}

            {/* Multi-frame pagination controls */}
            {packets.length > 1 && (
              <div className="flex items-center gap-3 mb-3 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveFrameIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeFrameIndex === 0}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <span>
                  Frame {activeFrameIndex + 1} of {packets.length}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveFrameIndex((prev) => Math.min(packets.length - 1, prev + 1))}
                  disabled={activeFrameIndex === packets.length - 1}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setAutoCycle(!autoCycle)}
                  className={`px-2 py-1 rounded text-[10px] ${
                    autoCycle ? 'bg-sky-500 text-white' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  {autoCycle ? 'Cycling On' : 'Cycling Off'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 w-full mt-2">
              <button
                type="button"
                onClick={handleCopyCurrentPacket}
                className="flex-1 py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy Payload'}</span>
              </button>

              <button
                type="button"
                onClick={() => setPhase('SCANNING_ANSWER')}
                className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/20 transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>Scan Answer QR</span>
              </button>
            </div>
          </div>
        )}

        {/* SENDER STEP 2: Scanning Receiver Answer */}
        {role === 'SENDER' && phase === 'SCANNING_ANSWER' && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 2:</strong> Scan the Answer QR code displayed on the receiver's screen.
            </div>

            {/* Video Viewport */}
            <div className="relative w-full max-w-xs h-60 bg-black rounded-2xl overflow-hidden mb-3 border border-slate-300 dark:border-slate-700 flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-cover" />
              {cameraActive && (
                <div className="absolute inset-0 border-2 border-sky-500/60 rounded-2xl pointer-events-none animate-pulse m-6" />
              )}
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-slate-400 bg-slate-900/90">
                  <CameraOff className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs">Camera paused or unavailable</span>
                </div>
              )}
            </div>

            {scanProgress.total > 1 && (
              <div className="text-xs text-sky-600 dark:text-sky-400 font-medium mb-3">
                Scanned {scanProgress.received} of {scanProgress.total} answer frames...
              </div>
            )}

            {/* Manual fallback input */}
            {(cameraError || !cameraActive) && (
              <div className="w-full mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Manual Answer Paste:
                </label>
                <textarea
                  rows={3}
                  value={manualPayloadText}
                  onChange={(e) => setManualPayloadText(e.target.value)}
                  placeholder="Paste the receiver's JSON answer payload here..."
                  className="w-full text-xs p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono mb-2"
                />
                <button
                  type="button"
                  onClick={handleManualSubmit}
                  className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors"
                >
                  Apply Answer
                </button>
              </div>
            )}

            {manualError && (
              <p className="text-xs text-rose-500 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{manualError}</span>
              </p>
            )}

            <button
              type="button"
              onClick={() => setPhase('WAITING_FOR_RECEIVER')}
              className="mt-4 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Offer QR</span>
            </button>
          </div>
        )}

        {/* RECEIVER STEP 1: Scanning Sender Offer */}
        {role === 'RECEIVER' && phase === 'SCANNING_OFFER' && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Step 1:</strong> Point camera at the Offer QR code displayed on the sender's screen.
            </div>

            {/* Video Viewport */}
            <div className="relative w-full max-w-xs h-60 bg-black rounded-2xl overflow-hidden mb-3 border border-slate-300 dark:border-slate-700 flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-cover" />
              {cameraActive && (
                <div className="absolute inset-0 border-2 border-emerald-500/60 rounded-2xl pointer-events-none animate-pulse m-6" />
              )}
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-slate-400 bg-slate-900/90">
                  <CameraOff className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs">Camera paused or unavailable</span>
                </div>
              )}
            </div>

            {scanProgress.total > 1 && (
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-3">
                Scanned {scanProgress.received} of {scanProgress.total} offer frames...
              </div>
            )}

            {/* Manual fallback input */}
            {(cameraError || !cameraActive) && (
              <div className="w-full mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Manual Offer Paste:
                </label>
                <textarea
                  rows={3}
                  value={manualPayloadText}
                  onChange={(e) => setManualPayloadText(e.target.value)}
                  placeholder="Paste the sender's JSON offer payload here..."
                  className="w-full text-xs p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono mb-2"
                />
                <button
                  type="button"
                  onClick={handleManualSubmit}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                >
                  Process Offer
                </button>
              </div>
            )}

            {manualError && (
              <p className="text-xs text-rose-500 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{manualError}</span>
              </p>
            )}
          </div>
        )}

        {/* RECEIVER STEP 2: Show Answer QR */}
        {role === 'RECEIVER' && (phase === 'GENERATING_ANSWER' || phase === 'WAITING_FOR_SENDER') && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Step 2:</strong> Show this Answer QR to the sender's camera to finalize connection.
            </div>

            {phase === 'GENERATING_ANSWER' ? (
              <div className="w-64 h-64 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
                <span className="text-xs text-slate-500">Generating local SDP answer...</span>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-3 flex flex-col items-center min-w-[240px] min-h-[240px] justify-center">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Answer QR" className="w-56 h-56 rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
                    <span className="text-xs text-slate-500">Rendering QR Code...</span>
                  </div>
                )}
              </div>
            )}

            {packets.length > 1 && (
              <div className="flex items-center gap-3 mb-3 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveFrameIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeFrameIndex === 0}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <span>
                  Frame {activeFrameIndex + 1} of {packets.length}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveFrameIndex((prev) => Math.min(packets.length - 1, prev + 1))}
                  disabled={activeFrameIndex === packets.length - 1}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyCurrentPacket}
              className="w-full py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Copy Answer Payload'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

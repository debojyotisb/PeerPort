import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
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
  HelpCircle,
  Play,
  Pause,
  ScanLine,
  Activity
} from 'lucide-react';
import { AirGappedTransport } from '../services/air-gapped-transport.js';
import {
  QrSignalingPacket,
  CompactSdpPacket,
  AnyQrPacket,
  QrPayloadReassembler,
  parseAndValidateQrPayload,
  isCompactSdpPacket
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

export interface ScannerDiagnostics {
  cameraActive: boolean;
  cameraResolution: string;
  decoderInit: string;
  scanAttempts: number;
  qrDetected: boolean;
  qrDetectionState: 'Searching' | 'Pattern Found' | 'Decoded (Valid Packet)' | 'Decoded (Invalid JSON)' | 'Decoded (Non-PeerPort)';
  qrDetectedLength: number;
  decoderUsed: string;
  jsonParsed: boolean;
  packetType: string;
  framesReceived: string;
  payloadReassembled: boolean;
  sdpDecompressed: boolean;
  sdpLength: number;
  remoteAccepted: boolean;
  answerStarted: boolean;
  answerRendered: boolean;
  lastError: string | null;
}

const initialDiagnostics: ScannerDiagnostics = {
  cameraActive: false,
  cameraResolution: 'pending',
  decoderInit: 'initializing...',
  scanAttempts: 0,
  qrDetected: false,
  qrDetectionState: 'Searching',
  qrDetectedLength: 0,
  decoderUsed: 'None',
  jsonParsed: false,
  packetType: 'none',
  framesReceived: '0/1',
  payloadReassembled: false,
  sdpDecompressed: false,
  sdpLength: 0,
  remoteAccepted: false,
  answerStarted: false,
  answerRendered: false,
  lastError: null
};

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

  // QR display & pre-rendered cache state
  const [packets, setPackets] = useState<AnyQrPacket[]>([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [cachedQrUrls, setCachedQrUrls] = useState<string[]>([]);
  // Prioritize ONE static QR: Auto-cycling is disabled by default!
  const [autoCycle, setAutoCycle] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Independent QR scanner test state
  const [scannerTestMode, setScannerTestMode] = useState(false);
  const [scannerTestResult, setScannerTestResult] = useState<string | null>(null);
  const [staticTestQrUrl, setStaticTestQrUrl] = useState<string>('');

  // Scanner state & refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<any>(null);
  const isScanningActiveRef = useRef<boolean>(false);
  const isDecodingRef = useRef<boolean>(false);
  const lastDecoderUsedRef = useRef<string>('None');

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && mediaStreamRef.current) {
      if (node.srcObject !== mediaStreamRef.current) {
        node.srcObject = mediaStreamRef.current;
        node.setAttribute('playsinline', 'true');
        node.muted = true;
        node.play().catch((e) => console.warn('[DIAG VIDEO] video.play() error:', e));
      }
    }
  }, []);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ received: number; total: number }>({ received: 0, total: 1 });
  const [lastScannedFrame, setLastScannedFrame] = useState<number | null>(null);
  const [manualPayloadText, setManualPayloadText] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Visible real-time scanner diagnostics
  const [diagnostics, setDiagnostics] = useState<ScannerDiagnostics>(initialDiagnostics);

  const reassemblerRef = useRef<QrPayloadReassembler>(new QrPayloadReassembler());
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGeneratingOfferRef = useRef(false);

  // Pre-generate static test QR code once
  useEffect(() => {
    const testPayload = JSON.stringify({
      peerport: 'scanner-test',
      status: 'ok',
      msg: 'Static QR Scanner Verification Test'
    });
    QRCode.toDataURL(testPayload, {
      width: 320,
      margin: 3,
      errorCorrectionLevel: 'L',
      color: { dark: '#000000', light: '#ffffff' }
    })
      .then((url) => setStaticTestQrUrl(url))
      .catch(console.error);
  }, []);

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
      setCachedQrUrls([]);
      setAutoCycle(false);
      setIsPaused(false);
      setScannerTestMode(false);
      setScannerTestResult(null);
      setLastScannedFrame(null);
      setDiagnostics(initialDiagnostics);
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
          // If the transport reports an explicit terminal failure or timeout, transition to FAILED
          const isTimeoutOrTerminal =
            reason?.includes('timed out') ||
            reason?.includes('timeout') ||
            reason?.includes('WebRTC Network Offline') ||
            reason?.includes('Direct peer-to-peer network link failed');

          if (
            !isTimeoutOrTerminal &&
            (phase === 'WAITING_FOR_SENDER' ||
              phase === 'WAITING_FOR_RECEIVER' ||
              phase === 'GENERATING_ANSWER' ||
              phase === 'CREATING_OFFER' ||
              phase === 'GENERATING_QR')
          ) {
            console.warn(
              `[DIAG WARN] [${new Date().toISOString()}] Suppressing premature FAILED transition while in phase: ${phase}. Handshake in progress.`
            );
            return;
          }
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
      // Warm up camera permission on sender to unmask local host IPv4 addresses (RFC 8835 / Chrome mDNS)
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          console.log(`[DIAG CAMERA] [${new Date().toISOString()}] Upfront camera warmup to unmask private IPv4 candidates...`);
          const warmupStream = await navigator.mediaDevices.getUserMedia({ video: true });
          warmupStream.getTracks().forEach((track) => track.stop());
          console.log(`[DIAG CAMERA] [${new Date().toISOString()}] Upfront camera warmup successful; host IPv4 addresses unmasked.`);
        } catch (warmupErr) {
          console.warn('[DIAG CAMERA] Upfront camera warmup skipped or denied:', warmupErr);
        }
      }

      setPhase('GENERATING_QR');
      const generatedPackets = await transport.createOfferPayloads(sessionId);
      console.log(`[DIAG OFFERS] [${new Date().toISOString()}] Generated packets received in modal: ${generatedPackets.length}`);
      setPackets(generatedPackets);
      setActiveFrameIndex(0);
      setPhase('WAITING_FOR_RECEIVER');
      setStatusMessage(
        generatedPackets.length === 1
          ? 'Show this static Offer QR code to the receiver.'
          : `Show this Offer QR code to the receiver (${generatedPackets.length} frames).`
      );
    } catch (err: any) {
      console.error(`[DIAG ERROR] [${new Date().toISOString()}] Failed to create offer payloads:`, err);
      setPhase('FAILED');
      setErrorMessage(err.message || 'Failed to gather local network addresses. Ensure Wi-Fi or hotspot is active.');
    } finally {
      isGeneratingOfferRef.current = false;
    }
  };

  // Pre-render ALL QR frame images ONCE upfront with Error Correction Level 'M', width 560, and standard 4-module quiet zone
  useEffect(() => {
    if (packets.length === 0) {
      setCachedQrUrls([]);
      return;
    }

    let active = true;
    const renderStartTime = performance.now();
    console.log(
      `[DIAG 14] Pre-rendering ${packets.length} QR frame(s) with Error Correction 'M', width 560, and 4-module quiet zone...`
    );

    Promise.all(
      packets.map((pkt) => {
        const raw = JSON.stringify(pkt);
        return QRCode.toDataURL(raw, {
          width: 560,
          margin: 4,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
      })
    )
      .then((urls) => {
        if (!active) return;
        const duration = (performance.now() - renderStartTime).toFixed(1);
        console.log(
          `[DIAG 15] All ${urls.length} QR frame(s) pre-rendered in ${duration}ms! Frame lengths: ${urls.map(u => u.length).join(', ')}`
        );
        setCachedQrUrls(urls);
      })
      .catch((err) => {
        if (!active) return;
        console.error(`[DIAG ERROR] [${new Date().toISOString()}] Error pre-rendering QR images:`, err);
        setErrorMessage(`QR generation error: ${err.message || 'Data too large for QR code'}`);
      });

    return () => {
      active = false;
    };
  }, [packets]);

  // Multi-frame QR auto-cycling (disabled by default, user-controllable)
  useEffect(() => {
    const isShowingQr = phase === 'WAITING_FOR_RECEIVER' || phase === 'WAITING_FOR_SENDER';
    if (packets.length <= 1 || !autoCycle || !isShowingQr || isPaused) return;

    const timer = setInterval(() => {
      setActiveFrameIndex((prev) => (prev + 1) % packets.length);
    }, 4500);

    return () => clearInterval(timer);
  }, [packets.length, autoCycle, phase, isPaused]);

  // Camera management for scanning phases (and independent test mode)
  useEffect(() => {
    const isScanning = phase === 'SCANNING_OFFER' || phase === 'SCANNING_ANSWER' || scannerTestMode;
    if (isOpen && isScanning) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isOpen, phase, scannerTestMode]);

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setDiagnostics(initialDiagnostics);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access not supported in this browser. Use manual payload entry below.');
      setDiagnostics((prev) => ({
        ...prev,
        lastError: 'getUserMedia not supported in this browser environment'
      }));
      return;
    }

    try {
      // Request environment camera with ideal 1280x720 and continuous autofocus
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // Apply continuous autofocus on supported tracks
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const caps: any = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            await (track as any).applyConstraints({
              advanced: [{ focusMode: 'continuous' }]
            });
            console.log('[DIAG CAMERA] Continuous autofocus applied');
          }
        } catch (e) {
          console.warn('[DIAG CAMERA] Continuous autofocus not supported on this device track:', e);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      const vw = videoRef.current?.videoWidth || 1280;
      const vh = videoRef.current?.videoHeight || 720;
      setCameraActive(true);
      setDiagnostics((prev) => ({
        ...prev,
        cameraActive: true,
        cameraResolution: `${vw}x${vh}`
      }));

      // Initialize BarcodeDetector if available and supported
      let detector: any = null;
      let detectorName = 'jsQR (Pure JS Universal Fallback)';
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          if (typeof (window as any).BarcodeDetector.getSupportedFormats === 'function') {
            const formats: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
              detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
              detectorName = 'Dual (BarcodeDetector + jsQR Fallback)';
            }
          } else {
            detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            detectorName = 'Dual (BarcodeDetector + jsQR Fallback)';
          }
        } catch (e: any) {
          console.warn('[DIAG SCANNER] BarcodeDetector init failed, using jsQR fallback:', e);
          detector = null;
        }
      }
      barcodeDetectorRef.current = detector;
      setDiagnostics((prev) => ({
        ...prev,
        decoderInit: detectorName
      }));

      // Start continuous scanning loop
      startScanningLoop();
    } catch (err: any) {
      console.warn('Camera access denied or failed:', err);
      setCameraError(err.message || 'Camera access unavailable. Use manual payload entry below.');
      setCameraActive(false);
      setDiagnostics((prev) => ({
        ...prev,
        lastError: `Camera initialization error: ${err.message || 'Permission denied'}`
      }));
    }
  };

  const stopCamera = () => {
    isScanningActiveRef.current = false;
    isDecodingRef.current = false;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  };

  const startScanningLoop = () => {
    isScanningActiveRef.current = true;
    let attempts = 0;

    const scanFrame = async () => {
      if (!isScanningActiveRef.current) return;
      const video = videoRef.current;

      if (video && video.readyState >= 2 && video.videoWidth > 0 && !isDecodingRef.current) {
        isDecodingRef.current = true;
        attempts++;
        if (attempts % 4 === 0) {
          setDiagnostics((prev) => ({ ...prev, scanAttempts: attempts }));
        }

        try {
          let decodedText: string | null = null;
          let engineUsed: 'BarcodeDetector' | 'jsQR' | 'jsQR (Center Zoom)' | 'jsQR (Full Frame)' | 'None' = 'None';

          // Engine 1: BarcodeDetector
          if (barcodeDetectorRef.current) {
            try {
              const barcodes = await barcodeDetectorRef.current.detect(video);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                decodedText = barcodes[0].rawValue;
                engineUsed = 'BarcodeDetector';
              }
            } catch {
              // BarcodeDetector threw - proceed directly to jsQR fallback
            }
          }

          // Engine 2: jsQR Fallback on canvas ImageData
          if (!decodedText) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const canvas = canvasRef.current || document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (ctx && vw > 0 && vh > 0) {
              // Pass A: Center-crop scan at 1:1 scale (no downscaling blur)
              // Highly effective when aiming camera at a laptop screen from 20-40cm away
              const cropW = Math.floor(vw * 0.70);
              const cropH = Math.floor(vh * 0.70);
              const cropX = Math.floor(vw * 0.15);
              const cropY = Math.floor(vh * 0.15);

              if (canvas.width !== cropW || canvas.height !== cropH) {
                canvas.width = cropW;
                canvas.height = cropH;
              }
              ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
              const cropImgData = ctx.getImageData(0, 0, cropW, cropH);
              const cropResult = jsQR(cropImgData.data, cropW, cropH, { inversionAttempts: 'attemptBoth' });

              if (cropResult && cropResult.data) {
                decodedText = cropResult.data;
                engineUsed = 'jsQR (Center Zoom)';
              } else {
                // Pass B: Full-frame scan (if center zoom didn't match)
                const scale = Math.min(1, 960 / vw);
                const fw = Math.floor(vw * scale);
                const fh = Math.floor(vh * scale);
                if (canvas.width !== fw || canvas.height !== fh) {
                  canvas.width = fw;
                  canvas.height = fh;
                }
                ctx.drawImage(video, 0, 0, fw, fh);
                const fullImgData = ctx.getImageData(0, 0, fw, fh);
                const fullResult = jsQR(fullImgData.data, fw, fh, { inversionAttempts: 'attemptBoth' });

                if (fullResult && fullResult.data) {
                  decodedText = fullResult.data;
                  engineUsed = 'jsQR (Full Frame)';
                }
              }
            }
          }

          if (decodedText) {
            lastDecoderUsedRef.current = engineUsed.startsWith('jsQR') ? 'jsQR' : 'BarcodeDetector';
            console.log(`[DIAG SCANNER] Recognized QR Code via ${engineUsed}! Length: ${decodedText.length}`);
            await handleScannedPayload(decodedText, engineUsed);
          } else {
            // No QR detected in this frame
            if (attempts % 8 === 0) {
              setDiagnostics((prev) => ({
                ...prev,
                qrDetected: false,
                qrDetectionState: 'Searching'
              }));
            }
          }
        } catch (frameErr: any) {
          console.warn('[DIAG SCANNER] Frame processing exception:', frameErr);
        } finally {
          isDecodingRef.current = false;
        }
      }

      if (isScanningActiveRef.current) {
        // Throttle ~80ms to provide smooth 12fps scanning with negligible CPU usage
        setTimeout(() => {
          if (isScanningActiveRef.current) {
            requestAnimationFrame(scanFrame);
          }
        }, 80);
      }
    };

    requestAnimationFrame(scanFrame);
  };

  const handleScannedPayload = async (rawText: string, engineUsed: string = 'None') => {
    try {
      // Independent scanner test mode verification
      if (scannerTestMode) {
        try {
          const parsed = JSON.parse(rawText);
          if (parsed.peerport === 'scanner-test') {
            setScannerTestResult(`✓ Test QR Code Verified! (${rawText.length} chars decoded via ${engineUsed})`);
            return;
          }
        } catch {
          // Non-JSON in test mode
        }
        setScannerTestResult(`Recognized QR (${rawText.length} chars via ${engineUsed}): ${rawText.slice(0, 40)}...`);
        return;
      }

      // Step 1: Validate payload format (supports both CompactSdpPacket v2 and Deflate QrSignalingPacket v1)
      let packet: AnyQrPacket;
      try {
        packet = parseAndValidateQrPayload(rawText);
      } catch (validationErr: any) {
        console.warn('[DIAG SCANNER] Scanned payload validation failed:', validationErr.message);
        setDiagnostics((prev) => ({
          ...prev,
          qrDetected: true,
          qrDetectionState: 'Decoded (Non-PeerPort)',
          qrDetectedLength: rawText.length,
          decoderUsed: engineUsed,
          lastError: validationErr.message || 'Scanned payload is not a valid PeerPort signaling packet'
        }));
        return;
      }

      // Step 2: Valid PeerPort packet recognized
      const isCompact = isCompactSdpPacket(packet);
      const packetTypeName = isCompact
        ? (packet.type === 'offer' ? 'compact-offer' : 'compact-answer')
        : packet.type;
      const legacy = !isCompact ? (packet as QrSignalingPacket) : null;
      const frameDesc = legacy
        ? `Frame ${legacy.idx + 1} of ${legacy.total}`
        : 'Static 1/1';

      setDiagnostics((prev) => ({
        ...prev,
        qrDetected: true,
        qrDetectionState: 'Decoded (Valid Packet)',
        qrDetectedLength: rawText.length,
        decoderUsed: engineUsed,
        jsonParsed: true,
        packetType: packetTypeName,
        framesReceived: frameDesc,
        lastError: null
      }));

      const expectedSession = role === 'SENDER' ? sessionId : undefined;
      const result = await reassemblerRef.current.processPacket(packet, expectedSession);
      const progress = reassemblerRef.current.getProgress();
      setScanProgress(progress);
      setLastScannedFrame(legacy ? legacy.idx + 1 : 1);

      if (result) {
        // Step 4: Reassembled and Decompressed
        setDiagnostics((prev) => ({
          ...prev,
          payloadReassembled: true,
          sdpDecompressed: true,
          sdpLength: result.sdp.length
        }));

        stopCamera();

        if (role === 'SENDER' && result.type === 'answer') {
          // Sender received answer -> Connecting
          setDiagnostics((prev) => ({ ...prev, remoteAccepted: true }));
          setPhase('CONNECTING');
          setStatusMessage('Applying remote answer and establishing connection...');
          if (transport) {
            await transport.applyAnswer(result.sdp);
          }
        } else if (role === 'RECEIVER' && result.type === 'offer') {
          // Receiver received offer -> Generating Answer
          setDiagnostics((prev) => ({
            ...prev,
            remoteAccepted: true,
            answerStarted: true
          }));
          setPhase('GENERATING_ANSWER');
          setStatusMessage('Processing offer and generating local answer...');
          if (transport) {
            onSessionReady?.('RECEIVER', result.sessionId);
            const answerPackets = await transport.createAnswerPayloads(result.sessionId, result.sdp);
            setDiagnostics((prev) => ({
              ...prev,
              answerRendered: true
            }));
            setPackets(answerPackets);
            setActiveFrameIndex(0);
            setPhase('WAITING_FOR_SENDER');
            setStatusMessage(
              answerPackets.length === 1
                ? 'Show this static Answer QR code to the sender.'
                : `Show this Answer QR code to the sender (${answerPackets.length} frames).`
            );
          }
        }
      }
    } catch (err: any) {
      console.error('[DIAG SCANNER] Error handling scanned payload:', err);
      setManualError(err.message || 'Invalid QR payload format');
      setDiagnostics((prev) => ({ ...prev, lastError: err.message || 'Format error' }));
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
    setScannerTestMode(false);
    setScannerTestResult(null);
    setLastScannedFrame(null);
    setDiagnostics(initialDiagnostics);
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

  const currentQrUrl = cachedQrUrls[activeFrameIndex] || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header with Independent Scanner Test button */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <QrCode className="w-5 h-5" />
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Air-Gapped Offline Transfer
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setScannerTestMode(!scannerTestMode);
                setScannerTestResult(null);
              }}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors flex items-center gap-1.5 ${
                scannerTestMode
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>{scannerTestMode ? 'Exit Test' : 'Test Scanner'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            100% serverless peer-to-peer WebRTC. No internet, router, or external servers required.
          </p>
        </div>

        {/* Hidden offscreen canvas for jsQR image extraction */}
        <canvas ref={canvasRef} className="hidden" />

        {/* INDEPENDENT QR SCANNER TEST TOOL */}
        {scannerTestMode && (
          <div className="w-full mb-5 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs animate-fade-in">
            <h4 className="font-bold text-amber-900 dark:text-amber-200 mb-1 flex items-center gap-1.5">
              <ScanLine className="w-4 h-4 text-amber-600" />
              <span>Independent Scanner Diagnostics</span>
            </h4>
            <p className="text-amber-800 dark:text-amber-300 mb-3 text-[11px]">
              Point this phone camera at the static QR code below (or open this screen on another device) to verify autofocus, lighting, and camera decoding before starting WebRTC.
            </p>

            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl shadow-inner border border-amber-200 dark:border-amber-800 mb-3">
              {staticTestQrUrl ? (
                <img src={staticTestQrUrl} alt="Static Test QR" className="w-48 h-48 rounded-lg" />
              ) : (
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              )}
              <span className="text-[10px] text-slate-400 mt-1 font-mono">Test Payload: peerport-scanner-test</span>
            </div>

            {/* Test Video Viewport */}
            <div className="relative w-full h-44 bg-black rounded-xl overflow-hidden mb-2 border border-amber-300 dark:border-amber-700 flex items-center justify-center">
              <video ref={setVideoRef} className="w-full h-full object-cover" />
              {cameraActive && (
                <div className="absolute inset-0 border-2 border-amber-500/60 rounded-xl pointer-events-none animate-pulse m-4" />
              )}
            </div>

            {scannerTestResult ? (
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-bold text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{scannerTestResult}</span>
              </div>
            ) : (
              <div className="text-center text-amber-700 dark:text-amber-400 font-medium text-[11px]">
                Aim camera at test QR code... (Attempts: {diagnostics.scanAttempts})
              </div>
            )}
          </div>
        )}

        {/* Connection Phase / Status Pill */}
        {!scannerTestMode && (
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
        )}

        {/* FAILED STATE VIEW */}
        {!scannerTestMode && phase === 'FAILED' && (
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

            <div className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-600 dark:text-slate-400 mb-5 space-y-2">
              <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-1">
                <HelpCircle className="w-4 h-4 text-sky-500 shrink-0" />
                <span>Actionable Diagnostic Remedies:</span>
              </div>
              {errorMessage?.includes('Network Offline') || errorMessage?.includes('hotspot') || errorMessage?.includes('network link') ? (
                <>
                  <p className="text-amber-700 dark:text-amber-300 font-medium">
                    • <strong>Local Network Link:</strong> Direct transfer requires both devices to be connected to the same Wi-Fi network or mobile hotspot.
                  </p>
                  <p className="text-slate-700 dark:text-slate-300">
                    • <strong>Offline Hotspot:</strong> Turning mobile data OFF on your phone hotspot is fully supported. Keep Wi-Fi active on both devices.
                  </p>
                  <p className="text-slate-700 dark:text-slate-300">
                    • <strong>Client Isolation:</strong> Some public or guest Wi-Fi networks block device-to-device communication. Use a mobile hotspot if direct connection fails.
                  </p>
                </>
              ) : (
                <>
                  <p>• Ensure both devices are connected to the same Wi-Fi network or mobile hotspot.</p>
                  <p>• Turning mobile data OFF on the hotspot phone does not affect local Wi-Fi. Keep Wi-Fi active.</p>
                  <p>• Ensure both Offer and Answer QR codes are scanned completely.</p>
                  <p>• Test your camera and scanner independently using the <strong>Test Scanner</strong> button in the header.</p>
                </>
              )}
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
        {!scannerTestMode && phase === 'CONNECTED' && (
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
        {!scannerTestMode && phase === 'CONNECTING' && (
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

        {/* SENDER STEP 1: Offer QR Display (Prioritizing ONE Static QR) */}
        {!scannerTestMode && role === 'SENDER' && (phase === 'CREATING_OFFER' || phase === 'GENERATING_QR' || phase === 'WAITING_FOR_RECEIVER') && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 1:</strong> On the receiving phone, tap <em>"Receive Files"</em> and scan this code with the camera.
              {packets.length > 1 && (
                <div className="mt-1 font-semibold text-amber-700 dark:text-amber-400">
                  Notice: Scan all {packets.length} frames (1 of {packets.length}, 2 of {packets.length}) on the receiving phone.
                </div>
              )}
            </div>

            {phase === 'CREATING_OFFER' || phase === 'GENERATING_QR' ? (
              <div className="w-72 h-72 sm:w-80 sm:h-80 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-3xl mb-4">
                <Loader2 className="w-10 h-10 animate-spin text-sky-500 mb-3" />
                <span className="text-xs text-slate-500 font-medium">Generating local SDP offer...</span>
              </div>
            ) : (
              <div className="p-5 sm:p-6 bg-white rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700 mb-3 flex flex-col items-center justify-center min-w-[280px] min-h-[280px] sm:min-w-[360px] sm:min-h-[360px]">
                {currentQrUrl ? (
                  <img
                    src={currentQrUrl}
                    alt={`Offer QR Frame ${activeFrameIndex + 1}`}
                    style={{ imageRendering: 'pixelated' }}
                    className="w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-sky-500 mb-3" />
                    <span className="text-xs text-slate-500 font-medium">Rendering high-contrast QR code...</span>
                  </div>
                )}
              </div>
            )}

            {/* Frame navigation controls (Fallback only if multi-frame required) */}
            {packets.length > 1 && (
              <div className="w-full flex flex-col items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 font-bold text-xs">
                    Frame {activeFrameIndex + 1} of {packets.length}
                  </span>
                  {autoCycle && !isPaused ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                      Auto-cycle: 4.5s
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[11px]">
                      Static (Manual Navigation)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFrameIndex((prev) => Math.max(0, prev - 1));
                      setIsPaused(true);
                    }}
                    disabled={activeFrameIndex === 0}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-200 transition-colors"
                    title="Previous Frame"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  {/* Frame selector pills */}
                  <div className="flex items-center gap-1.5">
                    {packets.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveFrameIndex(idx);
                          setIsPaused(true);
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                          activeFrameIndex === idx
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        Frame {idx + 1}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveFrameIndex((prev) => Math.min(packets.length - 1, prev + 1));
                      setIsPaused(true);
                    }}
                    disabled={activeFrameIndex === packets.length - 1}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-200 transition-colors"
                    title="Next Frame"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!autoCycle) {
                        setAutoCycle(true);
                        setIsPaused(false);
                      } else {
                        setIsPaused(!isPaused);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors"
                  >
                    {autoCycle && !isPaused ? <Pause className="w-3.5 h-3.5 text-amber-500" /> : <Play className="w-3.5 h-3.5 text-emerald-500" />}
                    <span>{autoCycle && !isPaused ? 'Pause' : 'Auto-Cycle'}</span>
                  </button>
                </div>
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
        {!scannerTestMode && role === 'SENDER' && phase === 'SCANNING_ANSWER' && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 2:</strong> Scan the Answer QR code displayed on the receiver's screen.
            </div>

            {/* Video Viewport */}
            <div className="relative w-full max-w-xs h-64 bg-black rounded-3xl overflow-hidden mb-3 border border-slate-300 dark:border-slate-700 flex items-center justify-center shadow-lg">
              <video ref={setVideoRef} className="w-full h-full object-cover" />
              {cameraActive && (
                <div className="absolute inset-0 border-2 border-sky-500/60 rounded-3xl pointer-events-none animate-pulse m-6" />
              )}
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-slate-400 bg-slate-900/90">
                  <CameraOff className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs">Camera paused or unavailable</span>
                </div>
              )}
            </div>

            {/* Real-Time Visible Scanner Diagnostics Panel */}
            <div className="w-full mb-3 p-3 rounded-2xl bg-slate-900 border border-slate-700 text-[11px] font-mono text-slate-300">
              <div className="flex items-center justify-between font-bold text-slate-200 mb-2 pb-1 border-b border-slate-800">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  <span>Real-Time Scanner Diagnostics</span>
                </span>
                <span className="text-[10px] text-amber-400 font-bold">{diagnostics.scanAttempts} scans</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                <div>1. Camera: <span className={diagnostics.cameraActive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.cameraActive ? `✓ ${diagnostics.cameraResolution}` : '○ Inactive'}</span></div>
                <div>2. Decoder: <span className="text-sky-400">{diagnostics.decoderInit}</span></div>
                <div>3. QR Detected: <span className={diagnostics.qrDetected ? 'text-emerald-400 font-bold' : diagnostics.qrDetectionState !== 'Searching' ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                  {diagnostics.qrDetected ? `✓ ${diagnostics.qrDetectionState} (${diagnostics.qrDetectedLength}c)` : diagnostics.qrDetectionState !== 'Searching' ? `⚠ ${diagnostics.qrDetectionState}` : '○ Scanning...'}
                </span></div>
                <div>4. Engine Used: <span className="text-emerald-400">{diagnostics.decoderUsed}</span></div>
                <div>5. JSON Packet: <span className={diagnostics.jsonParsed ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.jsonParsed ? `✓ ${diagnostics.packetType}` : '○ Pending'}</span></div>
                <div>6. Reassembled: <span className={diagnostics.payloadReassembled ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.payloadReassembled ? '✓ Complete' : '○ Pending'}</span></div>
                <div>7. Decompressed: <span className={diagnostics.sdpDecompressed ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.sdpDecompressed ? `✓ ${diagnostics.sdpLength} chars` : '○ Pending'}</span></div>
                <div>8. Link State: <span className={diagnostics.remoteAccepted ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.remoteAccepted ? '✓ Answer Applied' : '○ Waiting'}</span></div>
              </div>
              {diagnostics.lastError && (
                <div className="mt-2 pt-1 border-t border-slate-800 text-rose-400 font-semibold">
                  Error: {diagnostics.lastError}
                </div>
              )}
            </div>

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
                  Process Answer
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
              className="mt-3 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Offer QR</span>
            </button>
          </div>
        )}

        {/* RECEIVER STEP 1: Scanning Sender Offer */}
        {!scannerTestMode && role === 'RECEIVER' && phase === 'SCANNING_OFFER' && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Step 1:</strong> Point this camera at the Offer QR code displayed on the sender device.
            </div>

            {/* Video Viewport */}
            <div className="relative w-full max-w-xs h-64 bg-black rounded-3xl overflow-hidden mb-3 border border-slate-300 dark:border-slate-700 flex items-center justify-center shadow-lg">
              <video ref={setVideoRef} className="w-full h-full object-cover" />
              {cameraActive && (
                <div className="absolute inset-0 border-2 border-emerald-500/60 rounded-3xl pointer-events-none animate-pulse m-6" />
              )}
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-slate-400 bg-slate-900/90">
                  <CameraOff className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs">Camera paused or unavailable</span>
                </div>
              )}
            </div>

            {/* Real-Time Visible Scanner Diagnostics Panel */}
            <div className="w-full mb-3 p-3 rounded-2xl bg-slate-900 border border-slate-700 text-[11px] font-mono text-slate-300">
              <div className="flex items-center justify-between font-bold text-slate-200 mb-2 pb-1 border-b border-slate-800">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Real-Time Scanner Diagnostics</span>
                </span>
                <span className="text-[10px] text-amber-400 font-bold">{diagnostics.scanAttempts} scans</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                <div>1. Camera: <span className={diagnostics.cameraActive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.cameraActive ? `✓ ${diagnostics.cameraResolution}` : '○ Inactive'}</span></div>
                <div>2. Decoder: <span className="text-sky-400">{diagnostics.decoderInit}</span></div>
                <div>3. QR Detected: <span className={diagnostics.qrDetected ? 'text-emerald-400 font-bold' : diagnostics.qrDetectionState !== 'Searching' ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                  {diagnostics.qrDetected ? `✓ ${diagnostics.qrDetectionState} (${diagnostics.qrDetectedLength}c)` : diagnostics.qrDetectionState !== 'Searching' ? `⚠ ${diagnostics.qrDetectionState}` : '○ Scanning...'}
                </span></div>
                <div>4. Engine Used: <span className="text-emerald-400">{diagnostics.decoderUsed}</span></div>
                <div>5. JSON Packet: <span className={diagnostics.jsonParsed ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.jsonParsed ? `✓ ${diagnostics.packetType}` : '○ Pending'}</span></div>
                <div>6. Reassembled: <span className={diagnostics.payloadReassembled ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.payloadReassembled ? '✓ Complete' : '○ Pending'}</span></div>
                <div>7. Decompressed: <span className={diagnostics.sdpDecompressed ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.sdpDecompressed ? `✓ ${diagnostics.sdpLength} chars` : '○ Pending'}</span></div>
                <div>8. Offer Applied: <span className={diagnostics.remoteAccepted ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.remoteAccepted ? '✓ Applied' : '○ Pending'}</span></div>
                <div>9. Answer Started: <span className={diagnostics.answerStarted ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.answerStarted ? '✓ In Progress' : '○ Pending'}</span></div>
                <div>10. Answer Rendered: <span className={diagnostics.answerRendered ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{diagnostics.answerRendered ? '✓ Ready' : '○ Pending'}</span></div>
              </div>
              {diagnostics.lastError && (
                <div className="mt-2 pt-1 border-t border-slate-800 text-rose-400 font-semibold">
                  Error: {diagnostics.lastError}
                </div>
              )}
            </div>

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

        {/* RECEIVER STEP 2: Show Answer QR (Prioritizing ONE Static QR) */}
        {!scannerTestMode && role === 'RECEIVER' && (phase === 'GENERATING_ANSWER' || phase === 'WAITING_FOR_SENDER') && (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Step 2:</strong> Show this Answer QR to the sender's camera to finalize connection.
              {packets.length > 1 && (
                <div className="mt-1 font-semibold text-amber-700 dark:text-amber-400">
                  Notice: Sender needs to scan all {packets.length} frames (1 of {packets.length}, 2 of {packets.length}).
                </div>
              )}
            </div>

            {phase === 'GENERATING_ANSWER' ? (
              <div className="w-72 h-72 sm:w-80 sm:h-80 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-3xl mb-4">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-3" />
                <span className="text-xs text-slate-500 font-medium">Generating local SDP answer...</span>
              </div>
            ) : (
              <div className="p-5 sm:p-6 bg-white rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700 mb-3 flex flex-col items-center justify-center min-w-[280px] min-h-[280px] sm:min-w-[360px] sm:min-h-[360px]">
                {currentQrUrl ? (
                  <img
                    src={currentQrUrl}
                    alt={`Answer QR Frame ${activeFrameIndex + 1}`}
                    style={{ imageRendering: 'pixelated' }}
                    className="w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-3" />
                    <span className="text-xs text-slate-500 font-medium">Rendering high-contrast QR code...</span>
                  </div>
                )}
              </div>
            )}

            {/* Frame navigation controls (Fallback only if multi-frame required) */}
            {packets.length > 1 && (
              <div className="w-full flex flex-col items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-bold text-xs">
                    Frame {activeFrameIndex + 1} of {packets.length}
                  </span>
                  {autoCycle && !isPaused ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                      Auto-cycle: 4.5s
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[11px]">
                      Static (Manual Navigation)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFrameIndex((prev) => Math.max(0, prev - 1));
                      setIsPaused(true);
                    }}
                    disabled={activeFrameIndex === 0}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-200 transition-colors"
                    title="Previous Frame"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    {packets.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveFrameIndex(idx);
                          setIsPaused(true);
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                          activeFrameIndex === idx
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        Frame {idx + 1}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveFrameIndex((prev) => Math.min(packets.length - 1, prev + 1));
                      setIsPaused(true);
                    }}
                    disabled={activeFrameIndex === packets.length - 1}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-200 transition-colors"
                    title="Next Frame"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!autoCycle) {
                        setAutoCycle(true);
                        setIsPaused(false);
                      } else {
                        setIsPaused(!isPaused);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors"
                  >
                    {autoCycle && !isPaused ? <Pause className="w-3.5 h-3.5 text-amber-500" /> : <Play className="w-3.5 h-3.5 text-emerald-500" />}
                    <span>{autoCycle && !isPaused ? 'Pause' : 'Auto-Cycle'}</span>
                  </button>
                </div>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

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
  CameraOff
} from 'lucide-react';
import { AirGappedTransport } from '../services/air-gapped-transport.js';
import {
  QrSignalingPacket,
  QrPayloadReassembler,
  parseAndValidateQrPayload
} from '../services/qr-signaling.js';

interface AirGappedModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: 'SENDER' | 'RECEIVER';
  transport: AirGappedTransport | null;
  sessionId: string;
  onSessionReady?: (role: 'SENDER' | 'RECEIVER', sessionId: string) => void;
}

export const AirGappedModal: React.FC<AirGappedModalProps> = ({
  isOpen,
  onClose,
  role: initialRole,
  transport,
  sessionId,
  onSessionReady
}) => {
  const [role, setRole] = useState<'SENDER' | 'RECEIVER'>(initialRole);
  const [step, setStep] = useState<'OFFER_QR' | 'SCAN_ANSWER' | 'SCAN_OFFER' | 'ANSWER_QR'>('OFFER_QR');

  // QR display state
  const [packets, setPackets] = useState<QrSignalingPacket[]>([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [autoCycle, setAutoCycle] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

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

  // Synchronize initial role when modal opens
  useEffect(() => {
    if (isOpen) {
      setRole(initialRole);
      setStep(initialRole === 'SENDER' ? 'OFFER_QR' : 'SCAN_OFFER');
      setPackets([]);
      setActiveFrameIndex(0);
      setQrDataUrl('');
      setGenerationError(null);
      setCameraError(null);
      setManualError(null);
      setManualPayloadText('');
      reassemblerRef.current.reset();
    } else {
      stopCamera();
    }
  }, [isOpen, initialRole]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Generate Sender Offer when in OFFER_QR step
  useEffect(() => {
    if (!isOpen || !transport || role !== 'SENDER' || step !== 'OFFER_QR') return;

    let isMounted = true;
    setIsGenerating(true);
    setGenerationError(null);

    transport
      .createOfferPayloads(sessionId)
      .then((generatedPackets) => {
        if (!isMounted) return;
        setPackets(generatedPackets);
        setActiveFrameIndex(0);
        setIsGenerating(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to generate air-gapped offer:', err);
        setGenerationError(err.message || 'Could not generate offer');
        setIsGenerating(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, transport, role, step, sessionId]);

  // Render QR code whenever active packet changes
  useEffect(() => {
    if (packets.length === 0) {
      setQrDataUrl('');
      return;
    }

    const currentPacket = packets[activeFrameIndex];
    if (!currentPacket) return;

    const raw = JSON.stringify(currentPacket);
    QRCode.toDataURL(raw, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Error rendering QR image:', err));
  }, [packets, activeFrameIndex]);

  // Multi-frame QR auto-cycling
  useEffect(() => {
    if (packets.length <= 1 || !autoCycle || (step !== 'OFFER_QR' && step !== 'ANSWER_QR')) {
      return;
    }

    const timer = setInterval(() => {
      setActiveFrameIndex((prev) => (prev + 1) % packets.length);
    }, 2000);

    return () => clearInterval(timer);
  }, [packets.length, autoCycle, step]);

  // Manage camera streaming for scanner steps
  useEffect(() => {
    const isScanningStep = step === 'SCAN_ANSWER' || step === 'SCAN_OFFER';
    if (isOpen && isScanningStep) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isOpen, step]);

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported in this browser. Please use manual payload entry.');
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
      console.warn('Camera permission denied or camera unavailable:', err);
      setCameraError(err.message || 'Camera permission denied or camera unavailable. Use manual payload entry.');
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
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }

    // Check if native BarcodeDetector API is available
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const rawText = barcodes[0].rawValue;
              handleScannedPayload(rawText);
            }
          } catch {
            // Frame processing error, ignore and continue next tick
          }
        }, 250);
        return;
      } catch (err) {
        console.warn('Failed to initialize native BarcodeDetector:', err);
      }
    }

    // Fallback: If BarcodeDetector is not natively supported, prompt user for manual paste
    setCameraError('Native QR scanning is unavailable in this browser. Use manual payload entry below.');
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
          // Sender received completed answer
          if (transport) {
            await transport.applyAnswer(result.sdp);
            onClose();
          }
        } else if (role === 'RECEIVER' && result.type === 'offer') {
          // Receiver received completed offer, generate answer
          setIsGenerating(true);
          setGenerationError(null);
          if (transport) {
            onSessionReady?.('RECEIVER', result.sessionId);
            const answerPackets = await transport.createAnswerPayloads(result.sessionId, result.sdp);
            setPackets(answerPackets);
            setActiveFrameIndex(0);
            setIsGenerating(false);
            setStep('ANSWER_QR');
          }
        }
      }
    } catch (err: any) {
      setManualError(err.message || 'Invalid or incompatible QR packet');
    }
  };

  const handleManualSubmit = () => {
    if (!manualPayloadText.trim()) {
      setManualError('Please paste the payload text first.');
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
            <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <QrCode className="w-5 h-5" />
            </span>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Air-Gapped QR Transfer
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Completely serverless connection between phones. No internet, Wi-Fi router, or signaling server required.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 mb-5 text-xs font-semibold">
          <span className={role === 'SENDER' && step === 'OFFER_QR' ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-500'}>
            1. Offer QR
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span className={step === 'SCAN_OFFER' || step === 'ANSWER_QR' ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-500'}>
            2. Receiver Answer
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span className={step === 'SCAN_ANSWER' ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-500'}>
            3. Finalize Link
          </span>
        </div>

        {/* STEP 1: Sender displays Offer QR */}
        {role === 'SENDER' && step === 'OFFER_QR' && (
          <div className="flex flex-col items-center">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 1:</strong> Have the receiving device open PeerPort and tap <em>"Receive via QR"</em> to scan this code.
            </div>

            {isGenerating ? (
              <div className="w-64 h-64 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-2" />
                <span className="text-xs text-slate-500">Compressing local SDP offer...</span>
              </div>
            ) : generationError ? (
              <div className="w-full p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{generationError}</span>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-3 flex flex-col items-center">
                {qrDataUrl && <img src={qrDataUrl} alt="Offer QR" className="w-56 h-56 rounded-lg" />}
              </div>
            )}

            {/* Multi-frame pagination controls if SDP required chunking */}
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
                onClick={() => setStep('SCAN_ANSWER')}
                className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/20 transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>Scan Answer QR</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Sender scans Receiver's Answer QR */}
        {role === 'SENDER' && step === 'SCAN_ANSWER' && (
          <div className="flex flex-col items-center">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Step 2:</strong> Scan the Answer QR code displayed on the receiver's screen to connect.
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

            {/* Camera error / Manual fallback input */}
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
              onClick={() => setStep('OFFER_QR')}
              className="mt-4 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Offer QR</span>
            </button>
          </div>
        )}

        {/* RECEIVER STEP 1: Scan Offer QR */}
        {role === 'RECEIVER' && step === 'SCAN_OFFER' && (
          <div className="flex flex-col items-center">
            <div className="w-full p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 mb-4 text-xs text-sky-800 dark:text-sky-300">
              <strong>Receiver Mode:</strong> Point your camera at the Offer QR code on the sender's phone.
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
        {role === 'RECEIVER' && step === 'ANSWER_QR' && (
          <div className="flex flex-col items-center">
            <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Answer Ready:</strong> Show this QR code to the sender's camera so they can finalize the link.
            </div>

            {isGenerating ? (
              <div className="w-64 h-64 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
                <span className="text-xs text-slate-500">Generating local SDP answer...</span>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-3 flex flex-col items-center">
                {qrDataUrl && <img src={qrDataUrl} alt="Answer QR" className="w-56 h-56 rounded-lg" />}
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


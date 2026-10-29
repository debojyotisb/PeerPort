import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, Globe, Loader2, UserCheck, ShieldCheck } from 'lucide-react';
import { useConnectionStore } from '../state/connection-store.js';

interface QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinRoom: (roomId: string) => void;
}

export const QrModal: React.FC<QrModalProps> = ({ isOpen, onClose, onJoinRoom }) => {
  const { roomId, connectionState, remoteDevice } = useConnectionStore();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // The actual joining URL that the receiver's camera scans
  const joiningUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?join=${roomId || ''}`
    : `https://peerport.app/?join=${roomId || ''}`;

  useEffect(() => {
    if (!isOpen || !roomId) return;

    QRCode.toDataURL(joiningUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR code:', err));
  }, [isOpen, roomId, joiningUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(joiningUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isReceiverJoined = remoteDevice !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
          Share with a Browser
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          Scan with iPhone camera, Android camera, or open the link on any browser. No app install required on receiver.
        </p>

        {/* Live Session Status Banner */}
        <div className={`p-3 rounded-xl mb-4 flex items-center gap-2.5 text-xs font-medium border ${
          isReceiverJoined
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400'
        }`}>
          {isReceiverJoined ? (
            <>
              <UserCheck className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>
                Receiver connected: <strong>{remoteDevice.deviceName}</strong> ({remoteDevice.platform})
              </span>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-sky-500" />
              <span>Waiting for receiver to join session...</span>
            </>
          )}
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center">
          <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-4">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="PeerPort Joining QR Code" className="w-56 h-56 rounded-lg" />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              </div>
            )}
          </div>

          {/* Copy Joining URL */}
          <div className="w-full text-center">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                readOnly
                value={joiningUrl}
                className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono truncate"
              />
              <button
                onClick={handleCopy}
                className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Link'}
              </button>
            </div>

            <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>End-to-end direct peer transfer. Payload never touches cloud storage.</span>
            </p>
          </div>

          {/* Manual Session ID Entry Fallback */}
          <div className="w-full mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="Or paste Session ID"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-sky-500"
            />
            <button
              disabled={!manualCode.trim()}
              onClick={() => onJoinRoom(manualCode.trim())}
              className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 font-bold text-xs disabled:opacity-40 hover:bg-sky-400 transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

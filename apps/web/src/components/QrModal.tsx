import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, Wifi, Globe, Smartphone } from 'lucide-react';
import { useConnectionStore } from '../state/connection-store.js';

interface QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinRoom: (roomId: string) => void;
}

export const QrModal: React.FC<QrModalProps> = ({ isOpen, onClose, onJoinRoom }) => {
  const { roomId, hotspotInfo, mode } = useConnectionStore();
  const [activeTab, setActiveTab] = useState<'webrtc' | 'hotspot'>(
    mode === 'LOCAL_HOTSPOT' ? 'hotspot' : 'webrtc'
  );
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const currentUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/#room=${roomId || 'PP-ROOM'}`
      : `http://localhost:5173/#room=${roomId || 'PP-ROOM'}`;

  useEffect(() => {
    if (!isOpen) return;

    const payload =
      activeTab === 'hotspot' && hotspotInfo
        ? hotspotInfo.qrPayload || `WIFI:S:${hotspotInfo.ssid};T:WPA;P:${hotspotInfo.passphrase || ''};;`
        : currentUrl;

    QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR:', err));
  }, [isOpen, activeTab, roomId, hotspotInfo, currentUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Connect with Nearby Device
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          Scan with iPhone camera, iPad, Android, or desktop browser.
        </p>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 mb-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('webrtc')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'webrtc'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Browser / Wi-Fi P2P
          </button>
          <button
            onClick={() => setActiveTab('hotspot')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'hotspot'
                ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            Offline Hotspot (Android ➔ iOS)
          </button>
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center">
          <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 mb-4">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="PeerPort Pairing QR Code" className="w-56 h-56 rounded-lg" />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-slate-400">
                Generating QR...
              </div>
            )}
          </div>

          {activeTab === 'webrtc' ? (
            <div className="w-full text-center">
              <div className="inline-block px-4 py-1.5 rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-600 dark:text-sky-400 font-mono text-sm font-bold tracking-widest mb-3">
                {roomId || 'PP-ROOM'}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={currentUrl}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono truncate"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1 hover:opacity-90 transition-opacity"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-left">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-amber-500" />
                iPhone / Android Connection Instructions:
              </div>
              <ol className="text-[11px] text-slate-600 dark:text-slate-300 list-decimal pl-4 space-y-1">
                <li>Point iOS Camera at the QR code above.</li>
                <li>Tap <strong>"Join 'PeerPort-XXXX' Wi-Fi Network"</strong> banner.</li>
                <li>Safari will automatically open the local direct download portal.</li>
              </ol>
            </div>
          )}

          {/* Manual Room Entry */}
          <div className="w-full mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="Or enter 6-digit Room Code"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white uppercase font-mono tracking-wider focus:outline-none focus:border-sky-500"
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


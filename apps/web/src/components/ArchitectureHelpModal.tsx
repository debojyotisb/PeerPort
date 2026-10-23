import React from 'react';
import { X, ShieldCheck, Zap, Wifi, Globe, Smartphone, Lock } from 'lucide-react';

interface ArchitectureHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureHelpModal: React.FC<ArchitectureHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-sky-500 text-slate-950 flex items-center justify-center font-bold">
            <Zap className="w-5 h-5 fill-slate-950" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              PeerPort Architecture & Networking
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified Cross-Platform Technical Guarantees
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-1.5">
              <Wifi className="w-4 h-4 text-amber-500" />
              Scenario A: Android to iPhone (No Internet Required)
            </h4>
            <p className="leading-relaxed">
              Apple iOS does not support Wi-Fi Direct (P2P Wi-Fi). PeerPort solves this by having Android initiate a <strong>Local-Only Hotspot</strong> (`WifiManager.LocalOnlyHotspot`). The iPhone connects via its native camera app scanning the Wi-Fi QR code. Safari then loads the PeerPort app and streams files over local Wi-Fi at 50–100+ MB/s. Zero internet, zero cloud.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-1.5">
              <Globe className="w-4 h-4 text-sky-500" />
              Scenario B: Internet-Assisted WebRTC Direct
            </h4>
            <p className="leading-relaxed">
              When both peers have internet, the lightweight signaling server only brokers the room handshake (SDP offer/answer and ICE candidates). Once connected, the <strong>RTCDataChannel</strong> streams file chunks directly peer-to-peer over DTLS-SRTP. The signaling server never receives or stores file contents.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-1.5">
              <Lock className="w-4 h-4 text-emerald-500" />
              Integrity & Memory Safety Controls
            </h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Files stream in bounded 64 KiB chunks via backpressure flow control; large multi-GB files never exhaust RAM.</li>
              <li>Every file is verified with hardware SHA-256 via Web Crypto API before release.</li>
              <li>Filenames are scrubbed against path traversal and reserved device names.</li>
            </ul>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs"
        >
          Close
        </button>
      </div>
    </div>
  );
};


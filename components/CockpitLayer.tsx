import React from 'react';
import { AppMode } from '../types';

interface CockpitLayerProps {
  currentMode: AppMode;
  aiText: string;
  isProcessing: boolean;
  onModeSelect: (mode: AppMode) => void;
  isTorchOn: boolean;
  onToggleTorch: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onSwitchCamera: () => void;
  isListening: boolean;
  onToggleListening: () => void;
}

const CockpitLayer: React.FC<CockpitLayerProps> = ({
  currentMode,
  aiText,
  isProcessing,
  onModeSelect,
  isTorchOn,
  onToggleTorch,
  isMuted,
  onToggleMute,
  onSwitchCamera,
  isListening,
  onToggleListening
}) => {

  const getButtonStyles = (mode: AppMode, isEmergency: boolean = false) => {
    const isActive = currentMode === mode;
    const base = "flex flex-col items-center justify-center h-24 w-full rounded-3xl transition-all duration-300 active:scale-95 border-2 backdrop-blur-md";

    if (isEmergency) {
      return `${base} ${isActive
        ? 'bg-red-600 border-red-500 text-white shadow-xl shadow-red-900/60'
        : 'bg-red-950/40 border-red-500/30 text-red-500 hover:bg-red-900/30'}`;
    }

    return `${base} ${isActive
      ? 'bg-yellow-400 border-yellow-400 text-black shadow-[0_0_25px_rgba(250,204,21,0.5)] scale-105 z-10'
      : 'bg-zinc-900/40 border-white/10 text-zinc-300 hover:bg-zinc-800/60 hover:border-white/30 hover:text-white'}`;
  };

  const renderFormattedText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <span key={index} className="text-yellow-400 font-bold mx-1 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]">
            {part.slice(2, -2)}
          </span>
        );
      }
      return <span key={index} className="text-white/90">{part}</span>;
    });
  };

  return (
    <div className="absolute top-0 left-0 w-full h-full z-50 flex flex-col justify-between safe-area-inset p-4">

      {/* A. HEADER */}
      <div className="w-full flex items-start justify-between">

        {/* Left: Mode Info */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-3 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/5 w-fit">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-400 animate-ping' : 'bg-green-500'}`}></div>
            <span className="text-[9px] font-bold tracking-[0.25em] text-white/60 uppercase font-mono">
              {isProcessing ? 'ANALİZ...' : 'CANLI'}
            </span>
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter drop-shadow-xl mt-2 ml-1">
            {currentMode === AppMode.IDLE ? 'HAZIR' : currentMode}
          </h2>
        </div>

        {/* Right: Tools (Flash & Mute) */}
        <div className="flex gap-2">
          {/* Mic Toggle */}
          <button
            onClick={onToggleListening}
            className={`w-12 h-12 rounded-2xl border backdrop-blur-xl flex items-center justify-center shadow-lg transition-colors ${isListening ? 'bg-red-500 border-red-500 text-white animate-pulse' : 'bg-white/5 border-white/10 text-white'}`}
          >
            <span className="text-xl">{isListening ? '🎙️' : '🎤'}</span>
          </button>
          {/* Mute Toggle */}
          <button
            onClick={onToggleMute}
            className={`w-12 h-12 rounded-2xl border backdrop-blur-xl flex items-center justify-center shadow-lg transition-colors ${isMuted ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-white/5 border-white/10 text-white'}`}
          >
            <span className="text-xl">{isMuted ? '🔇' : '🔊'}</span>
          </button>

          {/* Flashlight Toggle */}
          <button
            onClick={onToggleTorch}
            className={`w-12 h-12 rounded-2xl border backdrop-blur-xl flex items-center justify-center shadow-lg transition-colors ${isTorchOn ? 'bg-yellow-400 border-yellow-300 text-black shadow-[0_0_15px_rgba(250,204,21,0.6)]' : 'bg-white/5 border-white/10 text-white/50'}`}
          >
            <span className="text-xl">{isTorchOn ? '🔦' : '⚡'}</span>
          </button>
        </div>
      </div>

      {/* B. STAGE (AI Output) */}
      <div className="flex-grow flex flex-col items-center justify-center text-center pointer-events-none px-4">
        {isProcessing ? (
          <div className="flex flex-col items-center gap-4 animate-pulse">
            <span className="text-6xl">🤔</span>
            <span className="text-yellow-400 font-mono text-sm tracking-[0.3em] uppercase border-b border-yellow-400/30 pb-1">
              ÇEVRE ANALİZ EDİLİYOR
            </span>
          </div>
        ) : (
          <div className="transition-all duration-500 ease-out">
            <h1 className="text-4xl md:text-5xl font-medium leading-snug drop-shadow-2xl">
              {renderFormattedText(aiText)}
            </h1>
          </div>
        )}
      </div>

      {/* C. FOOTER (Controls Only) */}
      <div className="w-full pb-4">

        <div className="flex justify-center mb-4 opacity-50">
          <div className="h-px w-8 bg-white/30 self-center"></div>
          <span className="mx-3 text-[10px] text-white font-bold tracking-[0.3em] uppercase">KONTROL PANELİ</span>
          <div className="h-px w-8 bg-white/30 self-center"></div>
        </div>

        {/* Control Grid */}
        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => onModeSelect(AppMode.SCAN)} className={getButtonStyles(AppMode.SCAN)}>
            <span className="text-3xl mb-1">👁️</span>
            <span className="font-bold text-xs uppercase tracking-widest">TARA</span>
          </button>
          <button onClick={() => onModeSelect(AppMode.READ)} className={getButtonStyles(AppMode.READ)}>
            <span className="text-3xl mb-1">📖</span>
            <span className="font-bold text-xs uppercase tracking-widest">OKU</span>
          </button>
          <button onClick={() => onModeSelect(AppMode.NAVIGATE)} className={getButtonStyles(AppMode.NAVIGATE)}>
            <span className="text-3xl mb-1">🧭</span>
            <span className="font-bold text-xs uppercase tracking-widest">YOL</span>
          </button>
          <button onClick={() => onModeSelect(AppMode.EMERGENCY)} className={getButtonStyles(AppMode.EMERGENCY, true)}>
            <span className="text-3xl mb-1">🆘</span>
            <span className="font-bold text-xs uppercase tracking-widest">ACİL</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CockpitLayer;
import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [emergencyNumber, setEmergencyNumber] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedKey = localStorage.getItem('GEMINI_API_KEY') || import.meta.env.VITE_GEMINI_API_KEY || '';
    const storedORKey = localStorage.getItem('OPENROUTER_API_KEY') || import.meta.env.VITE_OPENROUTER_API_KEY || '';
    const storedGroqKey = localStorage.getItem('GROQ_API_KEY') || import.meta.env.VITE_GROQ_API_KEY || '';
    const storedNumber = localStorage.getItem('EMERGENCY_NUMBER');

    setApiKey(storedKey);
    setOpenRouterKey(storedORKey);
    setGroqApiKey(storedGroqKey);
    if (storedNumber) setEmergencyNumber(storedNumber);
  }, []);

  const handleSave = () => {
    localStorage.setItem('GEMINI_API_KEY', apiKey.trim());
    localStorage.setItem('OPENROUTER_API_KEY', openRouterKey.trim());
    localStorage.setItem('GROQ_API_KEY', groqApiKey.trim());
    localStorage.setItem('EMERGENCY_NUMBER', emergencyNumber.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
      window.location.reload();
    }, 1000);
  };

  const handleClear = () => {
    localStorage.removeItem('GEMINI_API_KEY');
    localStorage.removeItem('OPENROUTER_API_KEY');
    localStorage.removeItem('GROQ_API_KEY');
    localStorage.removeItem('EMERGENCY_NUMBER');
    setApiKey('');
    setOpenRouterKey('');
    setGroqApiKey('');
    setEmergencyNumber('');
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative overflow-hidden overflow-y-auto max-h-[90vh]">
        {/* Background Accent */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500 to-transparent"></div>

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white tracking-tight">Sistem Ayarları</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
          OpenRouter (Qwen) veya Gemini API anahtarınızı girebilirsiniz. Qwen2-VL öncelikli çalışacaktır.
        </p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[10px] font-mono font-bold text-zinc-500 mb-1 uppercase tracking-wider">
              OPENROUTER API KEY (QWEN)
            </label>
            <input
              type="password"
              value={openRouterKey}
              onChange={(e) => {
                setOpenRouterKey(e.target.value);
                setSaved(false);
              }}
              placeholder="sk-or-v1-..."
              className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors font-mono text-sm shadow-inner"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono font-bold text-zinc-500 mb-1 uppercase tracking-wider">
              GOOGLE GEMINI API KEY
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
              }}
              placeholder="AIzaSy..."
              className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors font-mono text-sm shadow-inner opacity-60"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono font-bold text-zinc-500 mb-1 uppercase tracking-wider">
              GROQ API KEY (LLAMA 4)
            </label>
            <input
              type="password"
              value={groqApiKey}
              onChange={(e) => {
                setGroqApiKey(e.target.value);
                setSaved(false);
              }}
              placeholder="gsk_..."
              className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors font-mono text-sm shadow-inner"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono font-bold text-zinc-500 mb-1 uppercase tracking-wider">
              ACİL DURUM NUMARASI
            </label>
            <input
              type="tel"
              value={emergencyNumber}
              onChange={(e) => {
                setEmergencyNumber(e.target.value);
                setSaved(false);
              }}
              placeholder="+905001234567"
              className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors font-mono text-sm shadow-inner"
            />
          </div>

          <button
            onClick={handleSave}
            className={`w-full py-3.5 rounded-xl font-bold text-sm tracking-wide uppercase transition-all shadow-lg ${saved
              ? 'bg-green-500 text-black shadow-green-900/20 scale-[0.98]'
              : 'bg-white text-black hover:bg-zinc-200 shadow-white/10'
              }`}
          >
            {saved ? 'KAYDEDİLDİ ✓' : 'KAYDET VE BAŞLAT'}
          </button>

          {(apiKey || openRouterKey || emergencyNumber) && (
            <button
              onClick={handleClear}
              className="text-xs text-red-500 hover:text-red-400 font-medium self-center mt-2"
            >
              Ayarları Temizle
            </button>
          )}

          <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-2">
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 text-xs text-yellow-500/80 hover:text-yellow-400 transition-colors"
            >
              <span className="group-hover:scale-110 transition-transform">🚀</span>
              <span className="underline decoration-yellow-500/30 underline-offset-4 group-hover:decoration-yellow-500">
                OpenRouter'dan Anahtar Al (Qwen)
              </span>
            </a>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 text-xs text-orange-500/80 hover:text-orange-400 transition-colors"
            >
              <span className="group-hover:scale-110 transition-transform">⚡</span>
              <span className="underline decoration-orange-500/30 underline-offset-4 group-hover:decoration-orange-400">
                Groq'dan Anahtar Al (Llama 4)
              </span>
            </a>
          </div>
        </div>
      </div>
    </div >
  );
};

export default SettingsModal;
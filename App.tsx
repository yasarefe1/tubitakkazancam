import React, { useState, useRef, useEffect, useCallback } from 'react';
import CameraLayer from './components/CameraLayer';
import OverlayLayer from './components/OverlayLayer';
import CockpitLayer from './components/CockpitLayer';
import BoundingBoxLayer from './components/BoundingBoxLayer';
import SettingsModal from './components/SettingsModal';
import { AppMode, CameraHandle, BoundingBox } from './types';
import { analyzeImage, generateSpeech } from './services/geminiService';

// --- Audio Helper Functions ---
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext
): Promise<AudioBuffer> {
  return await ctx.decodeAudioData(data.buffer);
}
// -----------------------------

const App: React.FC = () => {
  // Removed showIntro state
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [aiText, setAiText] = useState<string>("");
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  const cameraRef = useRef<CameraHandle>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Ref to track processing state inside intervals without stale closures
  const isProcessingRef = useRef<boolean>(false);
  const modeRef = useRef<AppMode>(AppMode.IDLE);
  const manualTorchOverrideRef = useRef<boolean>(false);

  // Sync refs with state
  useEffect(() => {
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isProcessing, mode]);

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const stopCurrentAudio = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // ignore
      }
      currentSourceRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const playSound = (type: 'click' | 'success' | 'error') => {
    if (isMuted) return;
    initAudio();
    if (!audioContextRef.current) return;

    const osc = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();

    osc.connect(gain);
    gain.connect(audioContextRef.current.destination);

    const now = audioContextRef.current.currentTime;

    if (type === 'click') {
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'success') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  };

  const speak = useCallback(async (text: string) => {
    if (isMuted || !text) return;
    initAudio();

    stopCurrentAudio();

    if (!audioContextRef.current) return;

    const cleanText = text.replace(/\*/g, '').trim();

    const base64Audio = await generateSpeech(cleanText);

    if (base64Audio) {
      try {
        const audioBytes = decodeBase64(base64Audio);
        const audioBuffer = await decodeAudioData(audioBytes, audioContextRef.current);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
        currentSourceRef.current = source;
      } catch (e) {
        console.error("Audio playback failed", e);
        fallbackSpeak(cleanText);
      }
    } else {
      fallbackSpeak(cleanText);
    }
  }, [isMuted]);

  const fallbackSpeak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  const performAnalysis = async (targetMode: AppMode) => {
    if (isProcessingRef.current) return;

    setIsProcessing(true);

    try {
      const base64Image = cameraRef.current?.takePhoto();

      if (base64Image) {
        const result = await analyzeImage(base64Image, targetMode);

        // Only update if mode hasn't changed
        if (modeRef.current === targetMode) {
          setAiText(result.text);
          setBoxes(result.boxes); // Update bounding boxes
          speak(result.text);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (modeRef.current === targetMode) {
        setIsProcessing(false);
      }
    }
  };

  // --- AUTOMATIC LOOP LOGIC ---
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    if (mode !== AppMode.IDLE) {
      // Clear previous boxes when starting new mode
      setBoxes([]);
      setAiText("Analiz ediliyor...");
      manualTorchOverrideRef.current = false;

      // 1. Run immediately
      performAnalysis(mode);

      // 2. Loop every 4 seconds
      intervalId = setInterval(() => {
        performAnalysis(mode);
      }, 4000);
    } else {
      setAiText("");
      setBoxes([]);
      stopCurrentAudio();
      setIsProcessing(false);
      if (isTorchOn) {
        toggleTorch(false);
      }
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [mode]);


  const handleModeSelect = (selectedMode: AppMode) => {
    if (selectedMode === mode) {
      setMode(AppMode.IDLE);
      playSound('click');
    } else {
      setMode(selectedMode);
      playSound('click');
      if (navigator.vibrate) navigator.vibrate(50);
    }
  };

  const toggleTorch = async (forceState?: boolean) => {
    const newState = forceState !== undefined ? forceState : !isTorchOn;

    if (forceState === undefined) {
      playSound('click');
      if (newState === false) {
        manualTorchOverrideRef.current = true;
      } else {
        manualTorchOverrideRef.current = false;
      }
    }

    setIsTorchOn(newState);
    if (cameraRef.current) {
      await cameraRef.current.toggleTorch(newState);
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      setTimeout(() => playSound('click'), 50);
    } else {
      playSound('click');
      stopCurrentAudio();
      setIsMuted(true);
    }
  };

  const handleBoxClick = async (box: BoundingBox) => {
    playSound('click');

    // Toggle Zoom Logic
    // If currently 1.0, zoom to 2.0. If > 1.2, reset to 1.0.
    const newZoom = zoomLevel > 1.2 ? 1.0 : 2.0;

    setZoomLevel(newZoom);
    // Clear boxes because the field of view has changed, so boxes are invalid
    setBoxes([]);

    if (cameraRef.current) {
      await cameraRef.current.setZoom(newZoom);
    }

    if (newZoom > 1.0) {
      speak(`${box.label} odaklanılıyor.`);
    } else {
      speak("Geniş açı.");
    }

    // Force analysis after a short delay for camera to settle
    setTimeout(() => {
      if (modeRef.current !== AppMode.IDLE) {
        performAnalysis(modeRef.current);
      }
    }, 800);
  };

  const handleBrightnessCheck = (brightness: number) => {
    if (brightness < 40 && !isTorchOn && !manualTorchOverrideRef.current && mode !== AppMode.IDLE) {
      toggleTorch(true);
      speak("Karanlık algılandı. Işık açılıyor.");
    }
  };

  // Run once on mount - No sound on startup
  useEffect(() => {
    setAiText("Sistem Hazır. Mod seçin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="relative w-full h-full" onClick={initAudio}>
      {/* Removed IntroLayer */}

      <CameraLayer
        ref={cameraRef}
        onBrightnessCheck={handleBrightnessCheck}
      />

      {/* Visual Overlays */}
      <BoundingBoxLayer
        boxes={boxes}
        onBoxClick={handleBoxClick}
      />
      <OverlayLayer />

      <CockpitLayer
        currentMode={mode}
        aiText={aiText}
        isProcessing={isProcessing}
        onModeSelect={handleModeSelect}
        isTorchOn={isTorchOn}
        onToggleTorch={() => toggleTorch()}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onOpenSettings={() => setShowSettings(true)}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </main>
  );
};

export default App;
import React, { useState, useRef, useEffect, useCallback } from 'react';
import CameraLayer from './components/CameraLayer';
import OverlayLayer from './components/OverlayLayer';
import CockpitLayer from './components/CockpitLayer';
import BoundingBoxLayer from './components/BoundingBoxLayer';
import SettingsModal from './components/SettingsModal';
import { AppMode, CameraHandle, BoundingBox } from './types';
// import { analyzeImage, generateSpeech } from './services/geminiService';
import { analyzeImageWithGroq } from './services/groqService';
// import { generateSpeech } from './services/geminiService'; // Ses için lazım olabilir - İPTAL

import { loadObjectDetectionModel, detectObjects, isModelLoaded } from './services/objectDetectionService';

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
  const [boxes, setBoxes] = useState<BoundingBox[]>([]); // Gemini kutuları
  const [detectedBoxes, setDetectedBoxes] = useState<BoundingBox[]>([]); // Gerçek zamanlı kutular
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isListening, setIsListening] = useState<boolean>(false); // Sesli komut durumu

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

  // Load Detection Model
  useEffect(() => {
    loadObjectDetectionModel();
  }, []);

  // Real-time Detection Loop
  useEffect(() => {
    let animationFrameId: number;
    let isLooping = true;

    const loop = async () => {
      if (!isLooping) return;

      // IDLE dahil her zaman çalışsın
      if (cameraRef.current && isModelLoaded()) {
        const video = cameraRef.current.getVideoElement();
        if (video && video.readyState === 4) {
          const predictions = await detectObjects(video);

          if (predictions.length > 0) {
            const newBoxes: BoundingBox[] = predictions.map(p => ({
              label: p.labelTr, // Sadece isim, yüzde yok!
              ymin: p.bbox.ymin,
              xmin: p.bbox.xmin,
              ymax: p.bbox.ymax,
              xmax: p.bbox.xmax
            }));
            setDetectedBoxes(newBoxes);
          } else {
            setDetectedBoxes([]);
          }
        }
      } else {
        setDetectedBoxes([]);
      }

      // Hız kontrolü: Her frame yerine biraz gecikmeli çağırabiliriz, ama requestAnimationFrame en akıcı olanı
      // İşlemciyi yormamak için basit bir kontrol eklenebilir ama modern cihazlar kaldırır.
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      isLooping = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [mode]);

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

  // --- GELIŞMIŞ TTS SİSTEMİ ---
  const turkishVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Sesleri yükle (Chrome'da async yükleniyor)
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();

      // Önce Microsoft Türkçe sesi ara (Daha doğal, Windows yerel)
      let bestVoice = voices.find(v =>
        v.lang.startsWith('tr') && v.name.includes('Microsoft')
      );

      // Yoksa Google Türkçe sesi ara
      if (!bestVoice) {
        bestVoice = voices.find(v =>
          v.lang.startsWith('tr') && v.name.toLowerCase().includes('google')
        );
      }

      // Google yoksa herhangi bir Türkçe ses
      if (!bestVoice) {
        bestVoice = voices.find(v => v.lang.startsWith('tr'));
      }

      // Türkçe de yoksa varsayılan
      if (!bestVoice && voices.length > 0) {
        bestVoice = voices[0];
      }

      if (bestVoice) {
        turkishVoiceRef.current = bestVoice;
        console.log(`[TTS] Seçilen ses: ${bestVoice.name} (${bestVoice.lang})`);
      }
    };

    // Hemen dene
    loadVoices();

    // Chrome için: sesler sonradan yüklenebilir
    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if ('onvoiceschanged' in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (isMuted || !text) return;

    // Önceki sesi durdur
    window.speechSynthesis.cancel();

    // Temiz text
    const cleanText = text
      .replace(/[*{}\[\]"]/g, '')
      .replace(/speech:|boxes:|label:/gi, '')
      .trim();

    if (!cleanText || cleanText.length < 3) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // En iyi sesi kullan
    if (turkishVoiceRef.current) {
      utterance.voice = turkishVoiceRef.current;
    }

    utterance.lang = 'tr-TR';
    utterance.rate = 0.9; // Biraz daha yavaş ve anlaşılır
    utterance.pitch = 0.9; // Biraz daha tok (robotikliği kırar)
    utterance.volume = 1.0;

    // Hangi sesin kullanıldığını logla (Kullanıcı görsün)
    if (utterance.voice) {
      console.log("Konuşan Ses:", utterance.voice.name);
      // Ekrana basmak için event fırlatılabilir veya basitçe konsolda kalsın
    }

    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  const performAnalysis = async (targetMode: AppMode) => {
    if (isProcessingRef.current) return;

    setIsProcessing(true);

    try {
      const base64Image = cameraRef.current?.takePhoto();

      if (base64Image) {
        // GROQ (LLAMA 3.2 VISION) - KULLANICI İSTEĞİ (SDK MODU)
        const result = await analyzeImageWithGroq(base64Image, targetMode);

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

  // --- OTOMATİK MOD: 20 saniyede bir analiz (dakikada 3 istek = kota güvenli) ---
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    if (mode !== AppMode.IDLE) {
      // Clear previous boxes when starting new mode
      setBoxes([]);
      setAiText("Analiz ediliyor...");
      manualTorchOverrideRef.current = false;

      // 1. Hemen bir analiz yap
      performAnalysis(mode);

      // 2. Sonra 7 saniyede bir tekrarla (Flash-8b sayesinde hızlı ve ucuz)
      intervalId = setInterval(() => {
        performAnalysis(mode);
      }, 7000);
    } else {
      setAiText("Mod seçin.");
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
    playSound('click');
    if (navigator.vibrate) navigator.vibrate(50);

    if (selectedMode === mode) {
      // Aynı moda tıklarsa: Modu kapat
      setMode(AppMode.IDLE);
    } else {
      // Farklı mod seçildi
      setMode(selectedMode);
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

    // Zoom mantığı kaldırıldı (Kullanıcı isteği)
    /*
    const newZoom = zoomLevel > 1.2 ? 1.0 : 2.0;
    setZoomLevel(newZoom);
    setBoxes([]);
    if (cameraRef.current) {
      await cameraRef.current.setZoom(newZoom);
    }
    */

    // Sadece nesnenin adını söyle
    speak(`${box.label}`);

    // Force analysis after a short delay for camera to settle
    setTimeout(() => {
      if (modeRef.current !== AppMode.IDLE) {
        performAnalysis(modeRef.current);
      }
    }, 800);
  };

  const handleBrightnessCheck = (brightness: number) => {
    // Flaş Histerezis Mantığı (Daha Hassas)
    // Açma Eşiği: 100 (Hafif loşsa bile aç)
    // Kapatma Eşiği: 180 (Bayağı aydınlıksa kapat)

    if (manualTorchOverrideRef.current) return;

    if (!isTorchOn && brightness < 100) {
      toggleTorch(true);
      speak("Karanlık, ışık açıldı.");
    } else if (isTorchOn && brightness > 180) {
      toggleTorch(false);
    }
  };

  // Run once on mount
  useEffect(() => {
    setAiText(""); // Kullanıcı isteği: Boş başlasın ("bişi deme")
  }, []);

  // Sesli Komut Mantığı
  const toggleListening = useCallback(() => {
    if (isListening) {
      if ((window as any).recognitionInstance) {
        (window as any).recognitionInstance.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speak("Sesli komut tarayıcınızda desteklenmiyor.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      playSound('click');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log("Sesli Komut:", transcript);

      if (transcript.includes("oku")) handleModeSelect(AppMode.READ);
      else if (transcript.includes("tara")) handleModeSelect(AppMode.SCAN);
      else if (transcript.includes("yol") || transcript.includes("navigasyon")) handleModeSelect(AppMode.NAVIGATE);
      else if (transcript.includes("acil")) handleModeSelect(AppMode.EMERGENCY);
      else if (transcript.includes("ışık") && transcript.includes("aç")) toggleTorch(true);
      else if (transcript.includes("ışık") && (transcript.includes("kapat") || transcript.includes("söndür"))) toggleTorch(false);
      else if (transcript.includes("dur") || transcript.includes("sus")) {
        setMode(AppMode.IDLE);
        stopCurrentAudio();
      }
      else {
        speak("Anlaşılmadı.");
      }
    };

    (window as any).recognitionInstance = recognition;
    recognition.start();

  }, [isListening, handleModeSelect, toggleTorch]);

  return (
    <main className="relative w-full h-full" onClick={initAudio}>
      {/* App Liveness Indicator */}
      <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full z-[9999] animate-pulse"></div>

      {/* Removed IntroLayer */}

      <CameraLayer
        ref={cameraRef}
        onBrightnessCheck={handleBrightnessCheck}
      />

      {/* Visual Overlays */}
      <BoundingBoxLayer
        boxes={[...boxes, ...detectedBoxes]}
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
        onSwitchCamera={() => cameraRef.current?.switchCamera()}
        isListening={isListening}
        onToggleListening={toggleListening}
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
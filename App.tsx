import React, { useState, useRef, useEffect, useCallback } from 'react';
import CameraLayer from './components/CameraLayer';
import OverlayLayer from './components/OverlayLayer';
import CockpitLayer from './components/CockpitLayer';
import BoundingBoxLayer from './components/BoundingBoxLayer';
import SettingsModal from './components/SettingsModal';
import { AppMode, CameraHandle, BoundingBox } from './types';
import { analyzeImage } from './services/geminiService';
import { analyzeImageWithQwen } from './services/openRouterService';
// import { analyzeImageWithGroq } from './services/groqService';

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
  return await ctx.decodeAudioData(data.buffer as ArrayBuffer);
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
              xmax: p.bbox.xmax,
              confidence: p.confidence // Güven skoru eklendi
            }));
            setDetectedBoxes(newBoxes);

            // TİTREŞİM GERİ BİLDİRİMİ: Nesne çok yakınsa titret
            const closestBox = newBoxes.reduce((closest, box) => {
              const boxSize = (box.ymax - box.ymin) * (box.xmax - box.xmin);
              const closestSize = (closest.ymax - closest.ymin) * (closest.xmax - closest.xmin);
              return boxSize > closestSize ? box : closest;
            });

            const boxSize = (closestBox.ymax - closestBox.ymin) * (closestBox.xmax - closestBox.xmin);

            // Büyük kutu = yakın nesne
            if (boxSize > 3000 && navigator.vibrate) {
              navigator.vibrate(100); // Kısa titreşim
            } else if (boxSize > 5000 && navigator.vibrate) {
              navigator.vibrate([100, 50, 100]); // Çift titreşim (çok yakın!)
            }
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

    // Önceki sesi SADECE yeni bir konuşma başlarken durdur
    // (Aynı metni tekrar okumayı önle)
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      // Kısa bir gecikme ekle ki yeni konuşma başlayabilsin
      setTimeout(() => startSpeech(text), 100);
    } else {
      startSpeech(text);
    }
  }, [isMuted]);

  const startSpeech = (text: string) => {
    // Temiz text - JSON formatını agresif temizle
    const cleanText = text
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .replace(/\{|\}|\[|\]|"|'/g, '')
      .replace(/speech:|boxes:|label:|text:/gi, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText || cleanText.length < 3) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // En iyi sesi kullan
    if (turkishVoiceRef.current) {
      utterance.voice = turkishVoiceRef.current;
    }

    utterance.lang = 'tr-TR';
    utterance.rate = 0.95; // Biraz yavaş ama anlaşılır
    utterance.pitch = 1.05; // Hafif yüksek ton (daha canlı)
    utterance.volume = 1.0;

    // Hangi sesin kullanıldığını logla (Kullanıcı görsün)
    if (utterance.voice) {
      console.log("Konuşan Ses:", utterance.voice.name);
      // Ekrana basmak için event fırlatılabilir veya basitçe konsolda kalsın
    }

    window.speechSynthesis.speak(utterance);
  };

  const performAnalysis = async (targetMode: AppMode, customQuery?: string) => {
    if (isProcessingRef.current) return;

    setIsProcessing(true);
    setAiText(customQuery ? "Soru analizi..." : "Analiz ediliyor...");

    try {
      const video = cameraRef.current?.getVideoElement();
      if (!video) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

        if (base64Image) {
          let result;
          const orKey = localStorage.getItem('OPENROUTER_API_KEY') || import.meta.env.VITE_OPENROUTER_API_KEY;

          if (orKey) {
            // QWEN VISION (OpenRouter)
            console.log("🔵 Qwen Analizi Başlıyor... Soru:", customQuery || "Yok");
            try {
              // Custom query varsa ilet
              result = await analyzeImageWithQwen(base64Image, targetMode, customQuery);
              console.log("✅ Qwen başarılı!");
            } catch (e: any) {
              try {
                result = await analyzeImageWithQwen(base64Image, targetMode);
                console.log("✅ Qwen başarılı!");
              } catch (e: any) {
                console.warn("❌ Qwen Hatası, Gemini'ye geçiliyor:", e.message);
                // Hata sebebini kullanıcıya söyleyelim ki bilsin
                if (e.message && (e.message.includes("401") || e.message.includes("402"))) {
                  speak("Open Router anahtarı hatalı, Gemini'ye geçiyorum.");
                } else {
                  // Diğer hataları logla ama kullanıcıyı boğma
                  console.log("Qwen başarısız oldu.");
                }
                console.log("🟢 Gemini'ye geçiliyor...");
                result = await analyzeImage(base64Image, targetMode);
              }
            } else {
              // GEMINI VISION (Sadece Gemini Key varsa veya varsayılan)
              console.log("🟢 Gemini kullanılıyor (OpenRouter key yok)...");
              result = await analyzeImage(base64Image, targetMode);
            }

            if (modeRef.current === targetMode && result) {
              setAiText(result.text);
              setBoxes(result.boxes);
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

          // 2. Sonra 12 saniyede bir tekrarla (Kota güvenli)
          intervalId = setInterval(() => {
            performAnalysis(mode);
          }, 12000);
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
          setMode(AppMode.IDLE);
        } else {
          setMode(selectedMode);

          // Acil Durum Özel Mantığı
          if (selectedMode === AppMode.EMERGENCY) {
            handleEmergencyAction();
          }
        }
      };

      const handleEmergencyAction = () => {
        speak("Acil durum modu aktif. Konumunuz alınıyor.");

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
              const emerNumber = localStorage.getItem('EMERGENCY_NUMBER') || "";

              if (emerNumber) {
                speak("Konumunuz belirlendi. WhatsApp ile göndermek için ekrandaki kırmızı butona tekrar basın veya bu mesajı bekleyin.");
                // WhatsApp linkini oluştur ve sakla (belki bir ref veya state ile)
                const waUrl = `https://wa.me/${emerNumber.replace(/\D/g, '')}?text=Acil%20durum!%20Konumum:%20${encodeURIComponent(mapUrl)}`;

                // Otomatik yönlendirme yerine kullanıcıya seçenek sunmak daha güvenli ama 
                // kör kullanıcı için doğrudan açmak daha pratik olabilir.
                setTimeout(() => {
                  window.open(waUrl, '_blank');
                }, 3000);
              } else {
                speak("Konumunuz bulundu fakat kayıtlı acil durum numarası yok. Lütfen ayarlardan numara ekleyin.");
              }
            },
            (error) => {
              console.error("Konum hatası:", error);
              speak("Konumunuz alınamadı. Lütfen konum iznini kontrol edin.");
            }
          );
        } else {
          speak("Cihazınız konum özelliğini desteklemiyor.");
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

          // MOD DEĞİŞTİRME
          if (transcript.includes("oku") || transcript.includes("okuma")) {
            handleModeSelect(AppMode.READ);
          }
          else if (transcript.includes("tara") || transcript.includes("tarama") || transcript.includes("çevre")) {
            handleModeSelect(AppMode.SCAN);
          }
          else if (transcript.includes("yol") || transcript.includes("navigasyon") || transcript.includes("git")) {
            handleModeSelect(AppMode.NAVIGATE);
          }
          else if (transcript.includes("acil") || transcript.includes("yardım")) {
            handleModeSelect(AppMode.EMERGENCY);
          }

          // ANLIK ANALİZ
          else if (transcript.includes("ne görüyorsun") || transcript.includes("ne var") || transcript.includes("anlat") || transcript.includes("söyle")) {
            if (modeRef.current !== AppMode.IDLE) {
              performAnalysis(modeRef.current);
              speak("Analiz ediyorum");
            } else {
              speak("Önce bir mod seç");
            }
          }

          // IŞIK KONTROLÜ
          else if (transcript.includes("ışık") && (transcript.includes("aç") || transcript.includes("yak"))) {
            toggleTorch(true);
            speak("Işık açıldı");
          }
          else if (transcript.includes("ışık") && (transcript.includes("kapat") || transcript.includes("söndür") || transcript.includes("kapa"))) {
            toggleTorch(false);
            speak("Işık kapatıldı");
          }

          // DURDURMA
          else if (transcript.includes("dur") || transcript.includes("sus") || transcript.includes("kapat") || transcript.includes("durdur")) {
            setMode(AppMode.IDLE);
            stopCurrentAudio();
            speak("Durdu");
          }

          // ANLASILMAYAN HER SEYI SORU OLARAK KABUL ET
          else {
            // Eğer komut değilse, bunu bir soru olarak algıla ve analiz et
            console.log("Soru algılandı:", transcript);
            if (modeRef.current !== AppMode.IDLE) {
              performAnalysis(modeRef.current, transcript);
              speak("Anlaşıldı, bakıyorum...");
            } else {
              speak("Önce bir mod seçmelisin.");
            }
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
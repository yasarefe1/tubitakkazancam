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

      // Önce Google Türkçe sesi ara (En doğal ve akıcı olan bu)
      let bestVoice = voices.find(v =>
        v.lang.startsWith('tr') && v.name.toLowerCase().includes('google')
      );

      // Yoksa Microsoft Türkçe (Windows)
      if (!bestVoice) {
        bestVoice = voices.find(v =>
          v.lang.startsWith('tr') && v.name.includes('Microsoft')
        );
      }

      // O da yoksa herhangi bir Türkçe ses
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

  const lastSpeakTimeRef = useRef<number>(0);

  const speak = useCallback((text: string) => {
    if (isMuted || !text) return;

    const now = Date.now();
    const isUrgent = text.toUpperCase().includes("DUR") || text.toUpperCase().includes("DİKKAT");
    const timeSinceLastSpeak = now - lastSpeakTimeRef.current;

    // ACİL DURUMSA: Hemen kes ve konuş (0ms)
    // NORMAL DURUMSA: En az 2.5 saniye bekle (Cümle bitsin)
    if (window.speechSynthesis.speaking) {
      if (isUrgent || timeSinceLastSpeak > 2500) {
        window.speechSynthesis.cancel();
        setTimeout(() => startSpeech(text), 10);
      } else {
        // Hali hazırda konuşuyor ve acil değil -> Şimdilik sus, sıradaki kareyi bekle.
        // Bu sayede "Masa va..." diye sözü kesilmez.
        return;
      }
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

    if (!cleanText || cleanText.length < 2) return; // 2 harf bile olsa oku

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // En iyi sesi kullan
    if (turkishVoiceRef.current) {
      utterance.voice = turkishVoiceRef.current;
    }

    utterance.lang = 'tr-TR';
    utterance.rate = 1.3; // DAHA DA SERİ (CANLI GİBİ)
    utterance.pitch = 1.0; // DOĞAL TON
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
        const base64Image = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];

        if (base64Image) {
          let result;
          const orKey = localStorage.getItem('OPENROUTER_API_KEY') || import.meta.env.VITE_OPENROUTER_API_KEY;

          // DEBUG: Hangi key kullanılıyor?
          console.log("🔑 OpenRouter Key:", orKey ? `${orKey.substring(0, 15)}...` : "YOK!");
          console.log("🔑 Env Key:", import.meta.env.VITE_OPENROUTER_API_KEY ? "VAR" : "YOK");

          if (orKey) {
            // QWEN VISION (OpenRouter)
            console.log("🔵 Qwen Analizi Başlıyor... Soru:", customQuery || "Yok");
            try {
              // Custom query varsa ilet
              result = await analyzeImageWithQwen(base64Image, targetMode, customQuery);
              if (result) {
                console.log("✅ Qwen başarılı!");
              } else {
                console.warn("⚠️ Qwen boş döndü.");
              }
            } catch (e: any) {
              console.warn("❌ Qwen Tamamen Başarısız:", e.message);
              // Gemini YOK. Hata varsa hata kalsın.
              setAiText("Bağlantı hatası: Modeller yanıt vermedi.");
            }
          } else {
            setAiText("API Anahtarı bulunamadı.");
          }

          if (modeRef.current === targetMode && result) {
            // DUPLIKASYON KONTROLÜ: Eğer metin %100 aynıysa tekrar konuşma (kullanıcıyı darlama)
            // Ama kutuları güncelle ki ekranda görünsün.
            setBoxes(result.boxes);

            if (result.text !== aiText) {
              setAiText(result.text);
              speak(result.text);
            }
          }
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

  // --- OTOMATİK MOD: SONSUZ DÖNGÜ (Max Hız) ---
  useEffect(() => {
    let isActive = true;

    const startLoop = async () => {
      if (mode === AppMode.IDLE || !isActive) return;

      // 1. Analizi yap
      await performAnalysis(mode);

      // 2. Biter bitmez (veya hata alsa bile) tekrarla
      // Ama biraz bekle (10ms) ki UI donmasın ama anlık olsun
      if (isActive && mode !== AppMode.IDLE) {
        setTimeout(startLoop, 10);
      }
    };

    if (mode !== AppMode.IDLE) {
      setBoxes([]);
      setAiText("Analiz ediliyor...");
      manualTorchOverrideRef.current = false;

      // Döngüyü başlat
      startLoop();
    }

    return () => {
      isActive = false; // Cleanup
      setAiText("Mod seçin.");
      setBoxes([]);
      stopCurrentAudio();
      setIsProcessing(false);
      if (isTorchOn) {
        toggleTorch(false);
      }
    };
  }, [mode]); // Sadece mod değişince tetiklenir


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

    if (!isTorchOn && brightness < 160) {
      toggleTorch(true);
      speak("Ortam karanlık, ışık açıldı.");
    } else if (isTorchOn && brightness > 220) {
      toggleTorch(false);
    }
  };

  // Run once on mount
  useEffect(() => {
    setAiText(""); // Kullanıcı isteği: Boş başlasın ("bişi deme")
  }, []);

  // Sesli Komut Mantığı - DOĞAL DİL DESTEKLİ
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
    recognition.maxAlternatives = 3; // Birden fazla alternatif al

    recognition.onstart = () => {
      setIsListening(true);
      playSound('click');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    // Kelime benzerliği kontrolü (fuzzy match)
    const fuzzyMatch = (text: string, patterns: string[]): boolean => {
      return patterns.some(pattern => {
        // Tam eşleşme
        if (text.includes(pattern)) return true;
        // Kelimeleri ayır ve en az 2 kelime eşleşsin
        const patternWords = pattern.split(' ');
        const textWords = text.split(' ');
        let matchCount = 0;
        for (const pw of patternWords) {
          if (textWords.some(tw => tw.includes(pw) || pw.includes(tw))) {
            matchCount++;
          }
        }
        return matchCount >= Math.min(2, patternWords.length);
      });
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase().trim();
      const confidence = event.results[0][0].confidence;
      console.log("🎤 Sesli Komut:", transcript, "Güven:", Math.round(confidence * 100) + "%");

      // DEBUG: Ne anladığını söyle (kısa)
      // speak(`Anladım: ${transcript.substring(0, 30)}`);

      // === DOĞAL DİL SORU KALIPLARI (GENİŞLETİLMİŞ) ===
      const navigationQuestions = [
        "nereye gideyim", "nereye gitsem", "nasıl gideyim", "nasıl gitsem",
        "yol göster", "yolu göster", "yol tarif et", "beni yönlendir",
        "hangi yöne", "hangi tarafa", "ne tarafa gideyim", "nereye gidiyorum",
        "sağa mı sola mı", "düz mü gideyim", "nasıl ilerleyeyim",
        "yol", "git", "gideyim", "tarif", "yön"
      ];

      const environmentQuestions = [
        "önümde ne var", "etrafımda ne var", "çevremde ne var", "burada ne var",
        "ne görüyorsun", "neler var", "ortamı anlat", "çevreyi anlat",
        "etrafı anlat", "bak bakalım", "bir bak", "kontrol et",
        "ne var", "görüyor", "bak", "anlat", "çevre", "etraf", "önüm"
      ];

      const dangerQuestions = [
        "tehlike var mı", "tehlikeli mi", "güvenli mi", "geçebilir miyim",
        "çarpabilir miyim", "engel var mı", "dikkat etmeli miyim",
        "tehlike", "güvenli", "engel", "dikkat"
      ];

      const objectQuestions = [
        "bu ne", "şu ne", "o ne", "bunlar ne", "ne tutuyor",
        "elimde ne var", "önümdeki ne", "yanımdaki ne",
        "nedir", "bu nedir"
      ];

      const readQuestions = [
        "ne yazıyor", "oku", "yazıyı oku", "burada ne yazıyor",
        "tabelada ne yazıyor", "etikette ne yazıyor",
        "yazı", "yaz", "okuyor"
      ];

      // PARA TANIMA KOMUTLARI
      const moneyQuestions = [
        "bu kaç para", "kaç para", "kaç lira", "elimde kaç lira",
        "bu kaç tl", "kaç tl", "para tanı", "parayı tanı",
        "bu ne kadar", "ne kadar para", "toplam kaç", "banknot",
        "para var mı", "kaç kuruş", "para", "lira", "tl"
      ];

      // EŞYA BULMA SORULARI (YENİ)
      const finderQuestions = [
        "anahtar nerede", "anahtarımı bul", "anahtar var mı", "anahtar",
        "cüzdan nerede", "cüzdanımı bul", "cüzdan var mı", "cüzdan",
        "telefon nerede", "telefonumu bul", "telefon var mı", "telefon",
        "kapı nerede", "kapıyı bul", "çıkış nerede", "çıkış"
      ];

      // === MOD DEĞİŞTİRME KOMUTLARI (ESNEKLEŞTİRİLMİŞ) ===
      const words = transcript.split(/\s+/); // Kelimelere ayır

      if (transcript.includes("okuma modu") || transcript === "oku" || transcript === "okuma" ||
        (words.length <= 2 && words.some(w => w.startsWith("oku")))) {
        handleModeSelect(AppMode.READ);
        speak("Okuma modu");
      }
      else if (transcript.includes("tarama modu") || transcript === "tara" || transcript === "tarama" ||
        (words.length <= 2 && words.some(w => w.startsWith("tara")))) {
        handleModeSelect(AppMode.SCAN);
        speak("Tarama modu");
      }
      else if (transcript.includes("yol modu") || transcript.includes("navigasyon") ||
        (words.length <= 2 && words.some(w => w === "yol" || w === "navigasyon"))) {
        handleModeSelect(AppMode.NAVIGATE);
        speak("Yol tarifi modu");
      }
      else if (transcript.includes("acil") || transcript.includes("yardım") || transcript.includes("imdat")) {
        handleModeSelect(AppMode.EMERGENCY);
        speak("Acil durum modu");
      }

      // === NAVİGASYON SORULARI - Otomatik YOL TARİFİ modu ===
      else if (navigationQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, navigationQuestions)) {
        console.log("🧭 Navigasyon sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.NAVIGATE);
        }
        speak("Yol tarifi veriyorum");
        setTimeout(() => performAnalysis(AppMode.NAVIGATE, transcript), 300);
      }

      // === TEHLİKE SORULARI ===
      else if (dangerQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, dangerQuestions)) {
        console.log("⚠️ Tehlike sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
        }
        speak("Kontrol ediyorum");
        setTimeout(() => performAnalysis(AppMode.SCAN, "Tehlike var mı? Güvenli mi?"), 300);
      }

      // === ÇEVRE SORULARI - Otomatik TARAMA modu ===
      else if (environmentQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, environmentQuestions)) {
        console.log("👁️ Çevre sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
        }
        speak("Bakıyorum");
        setTimeout(() => performAnalysis(AppMode.SCAN, transcript), 300);
      }

      // === NESNE SORULARI ===
      else if (objectQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, objectQuestions)) {
        console.log("🔍 Nesne sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
        }
        speak("Bakıyorum");
        setTimeout(() => performAnalysis(AppMode.SCAN, transcript), 300);
      }

      // === PARA TANIMA SORULARI ===
      else if (moneyQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, moneyQuestions)) {
        console.log("💰 Para tanıma sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
        }
        speak("Paraya bakıyorum");
        // Gelişmiş para tanıma promptu
        const moneyPrompt = `Görüntüdeki Türk Liralarını detaylı say.
        1. Her banknotu ve madeni parayı tespit et.
        2. Renkleri kullan: 200(Mor), 100(Mavi), 50(Turuncu), 20(Yeşil), 10(Kırmızı), 5(Kahve).
        3. Sonuç: "1 adet 50 TL, 2 adet 10 TL var. Toplam 70 TL." gibi söyle.
        4. Para yoksa "Para göremiyorum" de.`;
        setTimeout(() => performAnalysis(AppMode.SCAN, moneyPrompt), 300);
      }

      // === EŞYA BULMA SORULARI (YENİ) ===
      else if (finderQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, finderQuestions)) {
        console.log("🕵️ Eşya bulma sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
        }

        let targetObject = "nesneyi";
        if (transcript.includes("anahtar")) targetObject = "anahtarı";
        else if (transcript.includes("cüzdan")) targetObject = "cüzdanı";
        else if (transcript.includes("telefon")) targetObject = "telefonu";
        else if (transcript.includes("kapı") || transcript.includes("çıkış")) targetObject = "kapıyı";

        speak(`${targetObject} arıyorum`);
        const findPrompt = `Görüntüde ${targetObject} var mı? Varsa yerini (sağda, solda, masada) söyle. Yoksa 'Göremiyorum' de.`;
        setTimeout(() => performAnalysis(AppMode.SCAN, findPrompt), 300);
      }

      // === OKUMA SORULARI ===
      else if (readQuestions.some(q => transcript.includes(q)) || fuzzyMatch(transcript, readQuestions)) {
        console.log("📖 Okuma sorusu algılandı");
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.READ);
        }
        speak("Okuyorum");
        setTimeout(() => performAnalysis(AppMode.READ, transcript), 300);
      }

      // === IŞIK KONTROLÜ ===
      else if (transcript.includes("ışık") || transcript.includes("fener") || transcript.includes("flaş")) {
        if (transcript.includes("aç") || transcript.includes("yak")) {
          toggleTorch(true);
          speak("Işık açıldı");
        } else if (transcript.includes("kapat") || transcript.includes("söndür") || transcript.includes("kapa")) {
          toggleTorch(false);
          speak("Işık kapatıldı");
        } else {
          // Sadece "ışık" dediyse toggle yap
          toggleTorch(!isTorchOn);
          speak(isTorchOn ? "Işık kapatıldı" : "Işık açıldı");
        }
      }

      // === KAMERA DEĞİŞTİRME ===
      else if (transcript.includes("kamera") && (transcript.includes("değiştir") || transcript.includes("çevir") || transcript.includes("döndür"))) {
        cameraRef.current?.switchCamera();
        speak("Kamera değiştirildi");
      }

      // === DURDURMA / SUSTURMA ===
      else if (transcript === "dur" || transcript === "sus" || transcript === "kapat" || transcript.includes("durdur") || transcript.includes("sessiz")) {
        setMode(AppMode.IDLE);
        stopCurrentAudio();
        speak("Tamam, durdum");
      }

      // === TEKRAR / YENİLE ===
      else if (transcript.includes("tekrar") || transcript.includes("bir daha") || transcript === "yenile") {
        if (modeRef.current !== AppMode.IDLE) {
          speak("Tekrar bakıyorum");
          performAnalysis(modeRef.current);
        } else {
          speak("Önce bir mod seç veya soru sor");
        }
      }

      // === GENEL SORU - Mod seçili değilse TARAMA moduna geç ===
      else {
        console.log("❓ Genel soru algılandı:", transcript);

        // Mod seçili değilse otomatik TARAMA moduna geç
        if (modeRef.current === AppMode.IDLE) {
          setMode(AppMode.SCAN);
          speak("Bakıyorum");
        } else {
          speak("Anlaşıldı");
        }

        // Soruyu AI'ya gönder
        setTimeout(() => {
          const currentMode = modeRef.current !== AppMode.IDLE ? modeRef.current : AppMode.SCAN;
          performAnalysis(currentMode, transcript);
        }, 300);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Ses tanıma hatası:", event.error);
      if (event.error === 'no-speech') {
        speak("Ses duyamadım, tekrar dene");
      }
      setIsListening(false);
    };

    (window as any).recognitionInstance = recognition;
    recognition.start();

  }, [isListening, handleModeSelect, toggleTorch, isTorchOn]);

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
import { AppMode, AnalysisResult, BoundingBox } from "../types";

// API Key Önceliği: 1. LocalStorage (Settings’ten) 2. Vite Env 3. Hardcoded
const getApiKey = () => {
  const storedKey = localStorage.getItem('GEMINI_API_KEY');
  if (storedKey && storedKey.trim()) return storedKey.trim();
  return import.meta.env.VITE_GEMINI_API_KEY || "AIzaSyDGx-l4yAQUMapBLsCyauVOjtaNINbf54w";
};

// Rate limiting variables
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 saniye bekle

const waitForRateLimit = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
};

const getSystemInstruction = (mode: AppMode): string => {
  // GÜÇLENDİRİLMİŞ DOGAL DİL PROMPT (Gemini İçin)
  const base = `Sen çok gelişmiş, keskin gözlü bir "Üçüncü Göz" asistanısın.
GÖREV: Görüntüdeki HER ŞEYİ (sebzeler, eşyalar, insanlar, engeller) en ince detayına kadar gör.
KURALLAR: 
1. Türkçe konuş.
2. KISA VE DOĞAL CÜMLELER kur. (Robot gibi "Masa" deme. "Önünde masa var" veya "Masanın üzerinde anahtar var" de).
3. Asla "görüntüde" veya "kamera" deme.
4. Küçük nesneleri (havuç, anahtar, telefon) aslan kaçırma. Konumlarını (sağda/solda) belirt.

FORMAT: {"speech": "kısa doğal cevap", "boxes": []}`;

  if (mode === AppMode.SCAN) {
    return `${base}
MOD: TARAMA
GÖREV: Çevreyi tarayıp en önemli nesneleri ve konumlarını anlat.
ÖNCELİK: Tehlikeler > İnsanlar > Küçük Eşyalar (Meyve, Anahtar, Cüzdan).
ÖRNEK: "Sağ tarafında koltuk var. Masanın üzerinde havuç ve cüzdan duruyor."`;
  }

  if (mode === AppMode.READ) {
    return `${base}
MOD: OKUMA
GÖREV: Gördüğün tüm metinleri akıcı bir şekilde oku.`;
  }

  if (mode === AppMode.NAVIGATE) {
    return `${base}
MOD: YOL TARİFİ (SÜRÜCÜ MODU)
GÖREV: Kullanıcıyı yürüt. Gördüğün GERÇEK nesnelere göre komut ver. (Hayal kurma).
KOMUTLAR:
- YOL AÇIKSA: "Saat 12 yönü temiz, ilerle."
- ENGEL VARSA: "DUR! Önünde [NESNE] var. [YÖN] tarafından geç."
- HEDEF VARSA: "Saat [YÖN] yönünde kapı var."

ÖNEMLİ:
1. Sadece "Saat 12", "Saat 3", "Saat 9" gibi kesin yön ver.
2. Saçmalama. Görüntü net değilse "Önünü göremiyorum, dur" de.
3. Kısa ve net ol.`;
  }

  if (mode === AppMode.EMERGENCY) {
    return `${base}
MOD: ACİL DURUM
GÖREV: En hızlı çıkış yolunu bul ve panik yapmadan yönlendir.`;
  }

  return base;
};

export const analyzeImage = async (base64Image: string, mode: AppMode): Promise<AnalysisResult> => {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    await waitForRateLimit();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${getApiKey()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
              { text: getSystemInstruction(mode) + "\n\nBu görüntüyü analiz et ve kör kullanıcıyı YÖNET." }
            ]
          }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return { text: "Sistem yoğun, lütfen bekleyiniz.", boxes: [] };
      }
      return { text: "Bağlantı hatası: " + response.status, boxes: [] };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (text) {
      try {
        return JSON.parse(text) as AnalysisResult;
      } catch (e) {
        console.error("JSON Parse Error", e);
        return { text: text, boxes: [] }; // JSON bozuksa düz metin
      }
    }

    return { text: "Boş yanıt.", boxes: [] };
  } catch (error) {
    console.error("API Error", error);
    return { text: "Bağlantı sorunu.", boxes: [] };
  }
};

// App.tsx tarafındaki import hatasını çözmek için dummy function
export const generateSpeech = async (text: string): Promise<string> => {
  return ""; // Browser TTS kullanıldığı için burası boş dönebilir
};

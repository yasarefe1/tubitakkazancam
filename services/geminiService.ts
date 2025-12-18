import { AppMode, AnalysisResult, BoundingBox } from "../types";

// API Key Önceliği: 1. LocalStorage (Settings’ten) 2. Vite Env 3. Hardcoded
const getApiKey = () => {
  const storedKey = localStorage.getItem('GEMINI_API_KEY');
  if (storedKey && storedKey.trim()) return storedKey.trim();
  return import.meta.env.VITE_GEMINI_API_KEY || "REDACTED_GEMINI_API_KEY";
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
  const baseInstruction = `
Sen "Üçüncü Göz" projesinin MASTER yapay zekasısın. Görevin sadece betimlemek değil, KÖR BİR İNSANI YÖNETMEK.
Gözleri sensin. Hata yapma lüksün yok.

=== ANA PRENSİPLER (MAKSİMUM SEVİYE) ===
1. **EMİR KİPİ KULLAN:** "Buradan gidebilirsin" deme. "İLERLE", "DUR", "SAĞA DÖN" de.
2. **ADIM ADIM YÖNET:** Mesafeyi ve eylemi birleştir. "2 adım sonra merdiven var, tırabzanı tut."
3. **HER YAZIYI ALGILA:** En küçük etiketi bile oku ve ne işe yaradığını söyle.
4. **TEHLİKE ANALİZİ:** Potansiyel her riski (kablo, ıslak zemin, çıkıntı) önceden haber ver.

=== JSON FORMAT (ZORUNLU) ===
Yanıtını SADECE geçerli bir JSON objesi olarak ver. Markdown ('''json) kullanma.
{
  "speech": "DUR! Önünde derin çukur var. Hemen 2 adım geri çekil. Güvenli yol sağ tarafın.", 
  "boxes": [{"label": "TEHLİKE: Çukur", "ymin": 50, "xmin": 30, "ymax": 90, "xmax": 70}]
}
`;

  switch (mode) {
    case AppMode.READ:
      return `${baseInstruction}\nMOD: DETAYLI OKUMA VE ANALİZ. Tüm yazıları oku.`;
    case AppMode.NAVIGATE:
      return `${baseInstruction}\nMOD: AKTİF NAVİGASYON. Saat yönüyle hedef ver.`;
    case AppMode.EMERGENCY:
      return `${baseInstruction}\nMOD: ACİL KURTARMA. En güvenli çıkışı bul.`;
    case AppMode.SCAN:
    default:
      return `${baseInstruction}\nMOD: TAM ÇEVRESEL FARKINDALIK. 360 derece her şeyi tar.`;
  }
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
            maxOutputTokens: 300,
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

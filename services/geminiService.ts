import { GoogleGenAI, Modality, Type } from "@google/genai";
import { AppMode, AnalysisResult } from "../types";

// Helper to get the AI client dynamically
// This ensures we pick up the key from LocalStorage if user updates it
const getGenAI = (): GoogleGenAI | null => {
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  const hardcodedKey = 'AIzaSyAcBB5ZufftBAcsqJY1-zePudakfyvlq-0';
  const validKey = localKey || envKey || hardcodedKey;

  if (!validKey) return null;
  return new GoogleGenAI({ apiKey: validKey });
};

/**
 * Generates a prompt based on the selected mode.
 */
const getSystemInstruction = (mode: AppMode): string => {
  const baseInstruction = `
    Sen "Üçüncü Göz" adında, görme engelliler için geliştirilmiş gelişmiş bir yapay zeka asistanısın.
    Görevin: Görüntüyü analiz et, durumu sesli olarak özetle (speech) ve önemli nesnelerin koordinatlarını (boxes) çıkar.
    
    ÖNEMLİ KURALLAR:
    1. "speech" alanı: Doğal, insani ve yardımsever bir ton kullan. Asla "resimde şunu görüyorum" deme. Doğrudan "Önünde masa var" de.
    2. "boxes" alanı: Görüntüdeki EN BELİRGİN 1 ile 4 nesneyi tespit et ve "boxes" listesine ekle. Koordinatları 0 ile 100 arasında (yüzde) ver. (ymin, xmin, ymax, xmax).
    
    Nesne yoksa boş liste döndür.
  `;

  switch (mode) {
    case AppMode.READ:
      return `${baseInstruction}
      MOD: OKUMA.
      Odaklanman gereken: Metinler, tabelalar, kitaplar.
      Speech: Görüntüdeki yazıları oku.
      Boxes: Yazı içeren alanları (tabela, kağıt, ekran) çerçeve içine al. Etiket: "METİN".
      `;

    case AppMode.NAVIGATE:
      return `${baseInstruction}
      MOD: YOL TARİFİ / NAVİGASYON.
      Odaklanman gereken: Engeller, kapılar, yollar.
      Speech: Yön ver (Saat 12 yönünde kapı var).
      Boxes: Kapı, merdiven, engel, insan gibi yol üzerindeki şeyleri işaretle.
      `;

    case AppMode.EMERGENCY:
      return `${baseInstruction}
      MOD: ACİL DURUM.
      Odaklanman gereken: Tehlikeler.
      Speech: ÇOK KISA uyar.
      Boxes: Tehlikeli nesneleri veya çıkış kapılarını işaretle.
      `;

    case AppMode.SCAN:
    default:
      return `${baseInstruction}
      MOD: GENEL TARAMA.
      Odaklanman gereken: Çevredeki ana nesneler.
      Speech: Ortamı betimle.
      Boxes: Masa, sandalye, bilgisayar, bardak, insan, telefon gibi belirgin nesneleri işaretle.
      `;
  }
};

export const analyzeImage = async (base64Image: string, mode: AppMode): Promise<AnalysisResult> => {
  try {
    const ai = getGenAI();
    if (!ai) {
      return { text: "Lütfen ayarlardan API anahtarı girin.", boxes: [] };
    }

    if (!base64Image || base64Image.length < 100) {
      return { text: "Görüntü alınamadı.", boxes: [] };
    }

    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
          { text: "Analiz et ve nesneleri kutu içine al." },
        ],
      },
      config: {
        systemInstruction: getSystemInstruction(mode),
        maxOutputTokens: 500,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speech: { type: Type.STRING, description: "Sesli okunacak metin." },
            boxes: {
              type: Type.ARRAY,
              description: "Tespit edilen nesnelerin kutuları.",
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING, description: "Nesnenin adı (Türkçe)." },
                  ymin: { type: Type.NUMBER, description: "Üst kenar % (0-100)" },
                  xmin: { type: Type.NUMBER, description: "Sol kenar % (0-100)" },
                  ymax: { type: Type.NUMBER, description: "Alt kenar % (0-100)" },
                  xmax: { type: Type.NUMBER, description: "Sağ kenar % (0-100)" },
                },
                required: ["label", "ymin", "xmin", "ymax", "xmax"]
              }
            }
          },
          required: ["speech", "boxes"]
        }
      },
    });

    if (response.text) {
      try {
        const json = JSON.parse(response.text);
        return {
          text: json.speech || "Analiz tamamlandı.",
          boxes: json.boxes || []
        };
      } catch (e) {
        console.error("JSON Parse Error", e);
        const match = response.text.match(/```json\n([\s\S]*?)\n```/);
        if (match && match[1]) {
          try {
            const json = JSON.parse(match[1]);
            return { text: json.speech || "Tamam.", boxes: json.boxes || [] };
          } catch (e2) { }
        }
        return { text: response.text, boxes: [] };
      }
    }

    return { text: "Algılanamadı.", boxes: [] };
  } catch (error: any) {
    console.error("Gemini Error:", error);
    let errorMsg = "Bağlantı hatası.";

    const msg = error.message || "";
    if (msg.includes("API key") || msg.includes("403") || msg.includes("401")) {
      errorMsg = "API anahtarı geçersiz veya süresi dolmuş.";
    } else if (msg.includes("429") || msg.includes("quota")) {
      errorMsg = "Kota aşıldı. Lütfen yeni anahtar girin.";
    } else {
      errorMsg = "Servis hatası: " + msg.substring(0, 20);
    }

    return { text: errorMsg, boxes: [] };
  }
};

/**
 * Converts text to natural sounding speech using Gemini TTS.
 */
export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const ai = getGenAI();
    if (!ai) return null;

    const cleanText = text.replace(/[*_]/g, ' ').trim();
    if (!cleanText) return null;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return audioData || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};
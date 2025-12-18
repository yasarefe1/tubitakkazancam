import { AnalysisResult, AppMode } from '../types';
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Görme engelliler için optimize edilmiş Gemini Vision servisi.
 */
export const analyzeImageWithGemini = async (
    base64Image: string,
    mode: AppMode,
    customQuery?: string
): Promise<AnalysisResult> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('GEMINI_API_KEY');

    if (!apiKey) {
        throw new Error('Gemini API anahtarı bulunamadı.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const basePrompt = `Sen "Üçüncü Göz" AI asistanısın. Kamera görüntüsünü görme engelli kullanıcı için analiz ediyorsun. 

KRİTİK ANLATIM KURALLARI:
1. İLİŞKİSEL BETİMLEME: Nesnelerin birbirleriyle olan ilişkilerini söyle (Örn: "Masanın üzerinde monitör var").
2. SAAT TEKNİĞİ: Saat 12 TAM KARŞI, saat 3 SAĞ, saat 9 SOL'dur. Yönleri buna göre ver.
3. ADIM ODAKLI MESAFE: Metre yerine daha çok "Adım" kullan (Örn: "2 adım ileride").
4. KURALLI VE TAM CÜMLE: Anlatım akıcı ve kurallı olsun. Maksimum 15 kelime kullan.
5. ÖNCE GÜVENLİK: Tehlikeleri (DUR, DİKKAT) her zaman İLK KELİME olarak söyle.`;

    const modePrompts: Record<string, string> = {
        [AppMode.SCAN]: `MOD: TARAMA (SCAN). Çevredeki ana nesneleri ve birbirlerine göre konumlarını doğal bir dille anlat.`,
        [AppMode.READ]: `MOD: OKUMA. Sadece Görüntüdeki metinlere ve tabelalara odaklan. Yazıları gördüğün sırayla oku.`,
        [AppMode.NAVIGATE]: `MOD: YOL TARİFİ. AŞIRI KISA OL (2-3 kelime). Yürünebilir alanlara, eşiklere ve basamaklara odaklan. (Örn: "Düz git, eşik var").`,
        [AppMode.EMERGENCY]: `MOD: ACİL DURUM. Sadece hayati tehlikeleri bildir.`
    };

    const prompt = `${basePrompt}\n${modePrompts[mode] || modePrompts[AppMode.SCAN]}\n\nCEVABI SADECE ŞU JSON FORMATINDA VER: {"speech": "anlatım metni", "boxes": []}`;

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: "image/jpeg"
                }
            }
        ]);

        const response = await result.response;
        const text = response.text();

        // JSON temizleme (Markdown bloklarını temizle)
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error: any) {
        console.error("Gemini Hatası:", error);
        throw new Error(`Gemini Analiz Hatası: ${error.message}`);
    }
};

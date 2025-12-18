import { AppMode, AnalysisResult } from "../types";

// API Key Helper - 3 Key'i de alır
const getApiKeys = () => {
    return {
        key1: import.meta.env.VITE_OPENROUTER_API_KEY || localStorage.getItem('OPENROUTER_API_KEY') || "",
        key2: import.meta.env.VITE_OPENROUTER_API_KEY_2 || "",
        key3: import.meta.env.VITE_OPENROUTER_API_KEY_3 || ""
    };
};

const getSystemInstruction = (mode: AppMode, customQuery?: string): string => {
    // GÜÇLENDİRİLMİŞ DOGAL DİL PROMPT
    const base = `Sen çok gelişmiş, keskin gözlü bir "Üçüncü Göz" asistanısın.
GÖREV: Görüntüdeki HER ŞEYİ (sebzeler, eşyalar, insanlar, engeller) en ince detayına kadar gör.
KURALLAR: 
1. Türkçe konuş.
2. KISA VE DOĞAL CÜMLELER kur. (Robot gibi "Masa" deme. "Önünde masa var" veya "Masanın üzerinde anahtar var" de).
3. Asla "görüntüde" veya "kamera" deme.
4. Küçük nesneleri (havuç, anahtar, telefon) aslan kaçırma. Konumlarını (sağda/solda) belirt.

FORMAT: {"speech": "kısa doğal cevap", "boxes": []}`;

    if (customQuery) {
        return `${base}\nSORU: "${customQuery}"\nSoruya odaklan ve doğal cevap ver.`;
    }

    if (mode === AppMode.SCAN) {
        return `${base}
MOD: TARAMA (DETAYLI ANALİZ)
GÖREV: Çevreyi insan gibi anlat.
KURALLAR:
1. En fazla 2 cümle kur.
2. Bağlaç kullan ("ve", "ayrıca").
3. Hem ne olduğunu hem nerede olduğunu söyle.
ÖRNEK: "Tam önünde geniş bir masa var. Masanın üzerinde bardak ve anahtarlar duruyor."`;
    }

    if (mode === AppMode.READ) {
        return `${base}
MOD: OKUMA
GÖREV: Gördüğün tüm metinleri akıcı bir şekilde oku.`;
    }

    if (mode === AppMode.NAVIGATE) {
        return `${base}
MOD: YOL TARİFİ (RALLİ PİLOTU MODU)
GÖREV: Kullanıcı hareket halinde. ÇARPMAMASI İÇİN PREFKSİZ KONUŞ.
KURALLAR:
1. ASLA CÜMLE KURMA. Sadece [DURUM] -> [YÖN].
2. Çok hızlı ve kısa ol. "Masa var" deme. "ENGEL: MASA. SAĞA." de.
3. Yol açıksa sadece "TEMİZ. İLERLE." de.

FORMAT:
- ENGEL VARSA: "DUR! [NESNE]. [YÖN] YAP." (Örn: "DUR! DİREK. SOLA KAÇ.")
- TEMİZSE: "TEMİZ. DÜZ."`;
    }

    if (mode === AppMode.EMERGENCY) {
        return `${base}
MOD: ACİL DURUM
GÖREV: En hızlı çıkış yolunu bul ve panik yapmadan yönlendir.`;
    }

    return base;
};

const makeRequest = async (apiKey: string, model: string, systemPrompt: string, userMessage: string, imageUrl: string) => {
    const siteUrl = typeof window !== 'undefined' ? window.location.origin : "https://localhost:3000";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": siteUrl,
            "X-Title": "Third Eye App"
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: userMessage },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ]
                }
            ],
            max_tokens: 1000,
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${model} Hatası (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) throw new Error("Boş yanıt döndü");

    try {
        let cleanContent = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleanContent);
        if (parsed.speech) return { text: parsed.speech, boxes: parsed.boxes || [] };
        if (parsed.text) return { text: parsed.text, boxes: parsed.boxes || [] };
        return parsed;
    } catch (e) {
        console.warn("JSON parse hatası:", content);
        return { text: content, boxes: [] };
    }
};

export const analyzeImageWithQwen = async (base64Image: string, mode: AppMode, customQuery?: string): Promise<AnalysisResult> => {
    const keys = getApiKeys();

    let imageUrl = base64Image;
    if (!base64Image.startsWith("data:")) {
        imageUrl = `data:image/jpeg;base64,${base64Image}`;
    }

    const systemPrompt = getSystemInstruction(mode, customQuery);
    const userMessage = customQuery ? `Soru: ${customQuery}` : `Bu görüntüyü analiz et (Mod: ${mode})`;

    // 1. DENEME: QWEN 3 VL 32B (Key 1)
    if (keys.key1) {
        try {
            console.log("🔵 1. Deneme: Qwen3 VL 32B...");
            return await makeRequest(keys.key1, "qwen/qwen3-vl-32b-instruct", systemPrompt, userMessage, imageUrl);
        } catch (error: any) {
            console.warn("❌ Qwen3 başarısız:", error.message);
        }
    }

    // 2. DENEME: QWEN 2.5 VL 7B (Key 2)
    if (keys.key2) {
        try {
            console.log("🟡 2. Deneme: Qwen 2.5 VL...");
            return await makeRequest(keys.key2, "qwen/qwen-2.5-vl-7b-instruct", systemPrompt, userMessage, imageUrl);
        } catch (error: any) {
            console.warn("❌ Qwen 2.5 başarısız:", error.message);
        }
    }

    // 3. DENEME: LLAMA 3.2 VISION (Key 3)
    if (keys.key3) {
        try {
            console.log("🟣 3. Deneme: Llama 3.2 Vision...");
            // DeepSeek görsele bakamaz, Llama Vision bakar!
            return await makeRequest(keys.key3, "meta-llama/llama-3.2-11b-vision-instruct:free", systemPrompt, userMessage, imageUrl);
        } catch (error: any) {
            console.warn("❌ Llama Vision başarısız:", error.message);
        }
    }

    throw new Error("Tüm yapay zeka modelleri başarısız oldu. İnternet bağlantını kontrol et veya daha sonra tekrar dene.");
};

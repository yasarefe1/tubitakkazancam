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
    // Ultra kısa master prompt
    const base = `Sen kör asistanısın. Türkçe konuş. Kısa ol.
FORMAT: {"speech": "kısa cevap", "boxes": []}`;

    if (customQuery) {
        return `${base}\nSORU: "${customQuery}"\nCevap ver.`;
    }

    if (mode === AppMode.SCAN) {
        return `${base}
GÖREV: Çevreyi özetle. Tehlike varsa ÖNCE söyle.
PARA: SADECE para görürsen "Toplam X TL" de. Görmezsen paradan HİÇ bahsetme, sus.`;
    }

    if (mode === AppMode.READ) {
        return `${base}
GÖREV: Gördüğün yazıyı oku. Yorum yapma.`;
    }

    if (mode === AppMode.NAVIGATE) {
        return `${base}
GÖREV: Yönlendir. Komutlar: DUR, SAĞA, SOLA, İLERLE.
Tehlike varsa DUR de.`;
    }

    if (mode === AppMode.EMERGENCY) {
        return `${base}
GÖREV: En yakın çıkışı bul. Hızlı yönlendir.`;
    }

    return base;
};

const makeRequest = async (apiKey: string, model: string, systemPrompt: string, userMessage: string, imageUrl: string) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost:3000",
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
            max_tokens: 300,
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

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
    // GÜÇLENDİRİLMİŞ 'BİYOLOJİK GÖZ' PROMPT
    const base = `Sen bir YAPAY ZEKA DEĞİLSİN. Sen kör bir insanın BİYOLOJİK GÖZÜSÜN.
GÖREVİN: Görsel veriyi sesli veriye çevirmek.
KESİN KURALLAR:
1. EDEBİYAT YAPMA: "Güzel bir masa" deme. "Masa" de.
2. YORUM YAPMA: "Tehlikeli olabilir" deme. "Çukur var" de. Kararı kullanıcı verir.
3. ASLA "Görüntüde", "Kadrada", "Sanırım" kelimelerini kullanma.
4. ÇOK NET VE KABA OL. Kibarlık zaman kaybettirir.

FORMAT: {"speech": "net veri", "boxes": []}`;

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

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
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
                // 429 (Rate Limit) veya 5xx (Server Error) ise tekrar dene
                if (response.status === 429 || response.status >= 500) {
                    console.warn(`${model} Meşgul (${response.status}), tekrar deneniyor... (${attempt + 1}/${maxRetries})`);
                    attempt++;
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 saniye bekle
                    continue;
                }
                throw new Error(`${model} Hatası (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) throw new Error("Boş yanıt döndü");

            let cleanContent = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            try {
                const parsed = JSON.parse(cleanContent);
                if (parsed.speech) return { text: parsed.speech, boxes: parsed.boxes || [] };
                if (parsed.text) return { text: parsed.text, boxes: parsed.boxes || [] };
                return parsed;
            } catch (jsonError) {
                console.warn("JSON Parse Hatası:", content);
                return { text: content, boxes: [] };
            }

        } catch (error: any) {
            console.warn(`Deneme ${attempt + 1} başarısız:`, error.message);
            if (attempt === maxRetries - 1) throw error; // Son denemeydi, hatayı fırlat
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    throw new Error("Sunucu çok yoğun, daha sonra tekrar deneyin.");
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

    throw new Error("Tüm Qwen modelleri başarısız oldu. İnternet bağlantını kontrol et veya daha sonra tekrar dene.");
};

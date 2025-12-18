import { AppMode, AnalysisResult } from "../types";

const getApiKey = () => {
    // Önce localStorage'dan dene
    const storedKey = localStorage.getItem('OPENROUTER_API_KEY');
    if (storedKey && storedKey.trim()) return storedKey.trim();

    // Sonra env'den birinci key
    if (import.meta.env.VITE_OPENROUTER_API_KEY) return import.meta.env.VITE_OPENROUTER_API_KEY;

    // Son olarak ikinci key (yedek)
    if (import.meta.env.VITE_OPENROUTER_API_KEY_2) return import.meta.env.VITE_OPENROUTER_API_KEY_2;

    return "";
};

const getSystemInstruction = (mode: AppMode, customQuery?: string): string => {
    // Eğer kullanıcı özel bir soru sorduysa, sadece ona odaklan
    if (customQuery) {
        return `Sen görme engelli bir asistanısın. Kullanıcı sana şu soruyu sordu: "${customQuery}"
        
KURALLAR:
1. SADECE TÜRKÇE cevap ver.
2. Kısa ve net ol (1-2 cümle).
3. Sadece sorulan soruya cevap ver.
4. Gördüğün gerçeği konuş, uydurma.

YANIT FORMATI:
{"speech": "Sorunun cevabı", "boxes": []}`;
    }

    // KULLANICI KURALLARI - DEĞİŞTİRİLEMEZ
    const strictRules = `
1. Çok kısa konuş (Maksimum 1-2 cümle).
2. ASLA "Resimde", "Görüntüde" gibi kelimeler kullanma.
3. Gördüğün GERÇEK nesneleri anlat. Örnekleri tekrar etme.
4. SADECE TÜRKÇE KONUŞ.
    `;

    if (mode === "TARAMA") {
        return `Sen gerçek bir "Kör Asistanı"sın.
${strictRules}

GÖREV: Çevreyi tarayıp en önemli bilgiyi ver.
- Hayati tehlikeleri (Çukur, Araba, Direk) önce söyle.
- Nesnelerin konumunu (Sağ, Sol, Ön) ve mesafesini (Yakın, Uzak) belirt.

YANIT FORMATI:
{"speech": "Kurala uygun kısa cevap", "boxes": []}`;
    }

    if (mode === "OKUMA") {
        return `Sen bir okuma asistanısın.
${strictRules}
GÖREV: Gördüğün yazıyı direkt oku.
- UZUN YAZILARI da oku.
- Kitap, belge, tabela ne varsa hepsini oku.
- Yorum yapma, sadece yazanı oku.

YANIT FORMATI:
{"speech": "Okunan metin", "boxes": []}`;
    }

    if (mode === "YOL TARİFİ") {
        return `Sen bir yol tarifi asistanısın.
${strictRules}
GÖREV: Sadece yürüme yolunu ve engelleri söyle.
- "Düz git", "Sola dön", "Dur" gibi komutlar ver.

YANIT FORMATI:
{"speech": "Yönlendirme", "boxes": []}`;
    }

    return `Sen bir asistanısın.
${strictRules}
Mod: ${mode}

YANIT FORMATI:
{"speech": "Cevap", "boxes": []}`;
};

export const analyzeImageWithQwen = async (base64Image: string, mode: AppMode, customQuery?: string): Promise<AnalysisResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("OpenRouter API anahtarı bulunamadı (Qwen)");
    }

    try {
        let imageUrl = base64Image;
        if (!base64Image.startsWith("data:")) {
            imageUrl = `data:image/jpeg;base64,${base64Image}`;
        }

        const systemPrompt = getSystemInstruction(mode, customQuery);

        // Kullanıcı sorusu veya mod açıklaması
        const userMessage = customQuery ? `Soru: ${customQuery}` : `Bu görüntüyü analiz et (Mod: ${mode})`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://localhost:3000", // Optional
                "X-Title": "Third Eye App"
            },
            body: JSON.stringify({
                model: "qwen/qwen-2.5-vl-7b-instruct",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: userMessage
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageUrl
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 300, // Daha uzun cevaplar için artırıldı
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter Hatası (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (content) {
            try {
                // Markdown code block'ları temizle
                let cleanContent = content
                    .replace(/```json\s*/gi, '')
                    .replace(/```\s*/g, '')
                    .trim();

                const parsed = JSON.parse(cleanContent);

                // Eğer "speech" field'ı varsa SADECE onu döndür
                if (parsed.speech) {
                    return { text: parsed.speech, boxes: parsed.boxes || [] };
                }

                // Eğer direkt "text" field'ı varsa onu kullan
                if (parsed.text) {
                    return { text: parsed.text, boxes: parsed.boxes || [] };
                }

                return parsed as AnalysisResult;
            } catch (e) {
                console.warn("JSON parse hatası, düz metin olarak kullanılıyor:", content);
                // JSON parse edilemezse, içeriği olduğu gibi döndür
                return { text: content, boxes: [] };
            }
        }

        return { text: "Yapay zeka yanıt vermedi.", boxes: [] };

    } catch (error: any) {
        console.error("QWEN ANALİZ HATASI DETAYLI:", error);
        // Hatanın sebebini net görelim
        if (error.message.includes("401")) {
            console.error("Qwen: API Anahtarı Hatalı/Geçersiz!");
        }
        throw error;
    }
};

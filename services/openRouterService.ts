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

const getSystemInstruction = (mode: AppMode): string => {
    // KULLANICI KURALLARI - DEĞİŞTİRİLEMEZ
    const strictRules = `
1. Çok kısa konuş (Maksimum 1-2 cümle).
2. ASLA "Resimde", "Görüntüde", "Kamera açısında" gibi kelimeler kullanma. Direkt konuya gir.
3. Önce hayati tehlikeleri (Çukur, Araba, Direk, Basamak) söyle.
4. Konum belirterek konuş (Sağında masa var, önün boş, saat 12 yönünde ağaç var gibi).
5. Mesafeyi tahmin et (çok yakın, yakın, uzak).
6. SADECE TÜRKÇE KONUŞ.
    `;

    if (mode === "TARAMA") {
        return `Sen gerçek bir "Kör Asistanı"sın. Gördüklerini değil, kullanıcının bilmesi gerekenleri anlat.
${strictRules}

GÖREV: Çevreyi tarayıp en önemli bilgiyi ver.
- Örnek Format: "Dikkat, önünde alçak sehpa var, çok yakın. Sol tarafın açık."
- Örnek Format: "Koridor boyunca önün boş, ilerleyebilirsin."
- Örnek Format: "Sağında masa, solunda duvar var. Önün açık."

YANIT FORMATI:
{"speech": "Kurala uygun kısa cevap", "boxes": []}`;
    }

    if (mode === "OKUMA") {
        return `Sen bir okuma asistanısın.
${strictRules}
GÖREV: Gördüğün yazıyı direkt oku. Yorum yapma.
- Eğer yazı yoksa "Yazı yok" de.
- Örnek: "Tabelada 'Çıkış' yazıyor."
- Örnek: "İlaç kutusu: Parol."

YANIT FORMATI:
{"speech": "Okunan metin", "boxes": []}`;
    }

    if (mode === "YOL TARİFİ") {
        return `Sen bir yol tarifi asistanısın.
${strictRules}
GÖREV: Sadece yürüme yolunu ve engelleri söyle.
- Örnek: "Düz git, önün açık."
- Örnek: "Dur! Önünde merdiven var."

YANIT FORMATI:
{"speech": "Yönlendirme", "boxes": []}`;
    }

    return `Sen bir asistanısın.
${strictRules}
Mod: ${mode}

YANIT FORMATI:
{"speech": "Cevap", "boxes": []}`;
};

export const analyzeImageWithQwen = async (base64Image: string, mode: AppMode): Promise<AnalysisResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("OpenRouter API anahtarı girilmemiş.");
    }

    try {
        let imageUrl = base64Image;
        if (!base64Image.startsWith("data:")) {
            imageUrl = `data:image/jpeg;base64,${base64Image}`;
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://tubitak-vision.vercel.app", // Optional
                "X-Title": "Üçüncü Göz"
            },
            body: JSON.stringify({
                model: "qwen/qwen-2.5-vl-7b-instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: getSystemInstruction(mode) },
                            { type: "image_url", image_url: { url: imageUrl } }
                        ]
                    }
                ],
                response_format: { type: "json_object" },
                temperature: 0.1,
                max_tokens: 500
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

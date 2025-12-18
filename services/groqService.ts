import { AnalysisResult, AppMode } from '../types';

/**
 * Görme engelliler için optimize edilmiş Groq Vision servisi (Llama 4).
 */
export const analyzeImageWithGroq = async (
    base64Image: string,
    mode: AppMode,
    customQuery?: string
): Promise<AnalysisResult> => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY || localStorage.getItem('GROQ_API_KEY');

    if (!apiKey) {
        throw new Error('Groq API anahtarı bulunamadı.');
    }

    const getSystemPrompt = (m: AppMode): string => {
        const base = `Sen "Üçüncü Göz" AI asistanısın. Köre rehbersin.
KURALLAR:
1. İLİŞKİSEL ANLATIM: "Masada monitör, önünde klavye var" gibi nesne ilişkilerini kur.
2. SAAT TEKNİĞİ: Saat 12 karşı, 3 sağ, 9 sol. Yönleri buna göre ver.
3. ADIM ODAKLI MESAFE: Metre yerine "X adım ileride" gibi ifadeler kullan.
4. KURALLI DİL: Akıcı ve tam cümleler kur (Max 15-20 kelime).
5. ÖNCE GÜVENLİK: Dur, dikkat, engel gibi uyarıları ilk kelimede ver.`;

        const modes: Record<string, string> = {
            [AppMode.SCAN]: "MOD: TARAMA. Çevredeki nesneleri ve konumlarını doğal bir dille anlat.",
            [AppMode.READ]: "MOD: OKUMA. Sadece metinleri ve tabelaları oku. Çevreyi anlatma.",
            [AppMode.NAVIGATE]: "MOD: YOL TARİFİ. AŞIRI KISA OL (2-3 kelime). Eylem odaklı ol (Örn: 'Düz git, eşik var').",
            [AppMode.EMERGENCY]: "MOD: ACİL DURUM. Sadece tehlikeleri bildir."
        };

        return `${base}\n${modes[m] || modes[AppMode.SCAN]}\n\nJSON FORMATINDA CEVAP VER: {"speech": "anlatım", "boxes": []}. SADECE JSON DÖNDÜR.`;
    };

    const models = [
        'llama-3.2-90b-vision-preview', // Hala aktif olma ihtimali yüksek
        'llama-3.2-11b-vision-preview'
    ];

    let lastError = null;

    for (const modelId of models) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: customQuery || getSystemPrompt(mode) },
                                {
                                    type: "image_url",
                                    image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                                }
                            ]
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 512,
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const msg = err.error?.message || `Hata: ${response.status}`;

                if (response.status === 401 || msg.includes("API key")) {
                    throw new Error("Groq API Anahtarı Geçersiz.");
                }

                lastError = msg;
                continue;
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            return JSON.parse(content);

        } catch (error: any) {
            console.error(`Groq ${modelId} Hatası:`, error.message);
            lastError = error.message;
        }
    }

    throw new Error(lastError || "Groq modelleri yanıt vermedi.");
};

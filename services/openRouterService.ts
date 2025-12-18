import { AnalysisResult, AppMode } from '../types';

/**
 * Görme engelliler için optimize edilmiş, mekansal ve mod duyarlı sistem promptu oluşturur.
 */
const getSystemPrompt = (mode: AppMode): string => {
    const basePrompt = `Sen "Üçüncü Göz" AI asistanısın. Kamera görüntüsünü görme engelli kullanıcı için analiz ediyorsun. 

KRİTİK ANLATIM KURALLARI:
1. İLİŞKİSEL BETİMLEME: Nesnelerin birbirleriyle olan ilişkilerini söyle (Örn: "Masanın üzerinde monitör var").
2. SAAT TEKNİĞİ: Saat 12 TAM KARŞI, saat 3 SAĞ, saat 9 SOL'dur. Yönleri buna göre ver.
3. ADIM ODAKLI MESAFE: Metre yerine daha çok "Adım" kullan (Örn: "2 adım ileride").
4. KURALLI VE TAM CÜMLE: Anlatım akıcı ve kurallı olsun. Maksimum 15 kelime kullan.
5. ÖNCE GÜVENLİK: Tehlikeleri (DUR, DİKKAT) her zaman İLK KELİME olarak söyle.`;

    const modePrompts: Record<string, string> = {
        [AppMode.SCAN]: `MOD: TARAMA (SCAN). Çevredeki ana nesneleri ve birbirlerine göre konumlarını doğal bir dille anlat.`,
        [AppMode.READ]: `MOD: OKUMA. Görüntüdeki sadece metinlere odaklan ve onları sırayla oku. Yazı yoksa belirt.`,
        [AppMode.NAVIGATE]: `MOD: YOL TARİFİ. AŞIRI KISA OL (2-3 kelime). Sadece eylem odaklı emirler ver. (Örn: "Düz ilerle", "Hafif sağa", "Dur, engel var"). Cümle kurma, sadece talimat ver.`,
        [AppMode.EMERGENCY]: `MOD: ACİL DURUM. Sadece hayati tehlikeleri bildir. Tehlike yoksa "Güvenli" de.`
    };

    return `${basePrompt}\n${modePrompts[mode] || modePrompts[AppMode.SCAN]}
    
JSON FORMATINDA CEVAP VER:
{
  "speech": "Anlatım metni buraya",
  "boxes": [{"label": "nesne adı", "ymin": 0, "xmin": 0, "ymax": 100, "xmax": 100}]
}
KRİTİK: Sadece JSON döndür.`;
};

/**
 * OpenRouter üzerinden görüntüyü analiz eder.
 */
export const analyzeImageWithQwen = async (
    base64Image: string,
    mode: AppMode,
    customQuery?: string
): Promise<AnalysisResult> => {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || localStorage.getItem('OPENROUTER_API_KEY');

    if (!apiKey) {
        throw new Error('OpenRouter API anahtarı bulunamadı.');
    }

    const systemPrompt = getSystemPrompt(mode);

    // Kullanmak istediğimiz modeller (Öncelik sırasına göre)
    const models = [
        'qwen/qwen-2.5-vl-72b-instruct',
        'qwen/qwen3-vl-32b-instruct',
        'qwen/qwen-2.5-vl-7b-instruct:free'
    ];

    let lastError = null;

    for (const modelId of models) {
        try {
            console.log(`🚀 OpenRouter denemesi: ${modelId}`);

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`, // Trim ekleyerek boşluk hatalarını önle
                    'Content-Type': 'application/json',
                    'HTTP-Referer': window.location.origin, // Dinamik referer
                    'X-Title': 'Üçüncü Göz (Tübitak)'
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: customQuery || systemPrompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }],
                    temperature: 0.1,
                    max_tokens: 800
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const status = response.status;
                const msg = errorData.error?.message || '';

                console.warn(`⚠️ ${modelId} başarısız (${status}): ${msg}`);

                if (status === 402 || status === 400 || msg.includes("credits") || msg.includes("not found") || msg.includes("endpoint")) {
                    lastError = msg || `Hata: ${status}`;
                    continue;
                }

                throw new Error(msg || `API Hatası: ${status}`);
            }

            const data = await response.json();
            console.log(`📥 ${modelId} yanıtı alındı.`);

            const content = data.choices?.[0]?.message?.content;
            if (!content) continue;

            let parsedContent;
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : content;
                parsedContent = JSON.parse(jsonStr);
            } catch (e) {
                parsedContent = {
                    speech: content.replace(/\{|\}|\[|\]|"|'/g, ''),
                    boxes: []
                };
            }

            return {
                text: parsedContent.speech || parsedContent.text || content,
                boxes: parsedContent.boxes || []
            };

        } catch (error: any) {
            console.error(`🔴 ${modelId} hatası:`, error.message);
            lastError = error.message;
            if (error.message.includes("fetch")) throw error;
        }
    }

    throw new Error(lastError || "Tüm modeller denendi ama yanıt alınamadı.");
};

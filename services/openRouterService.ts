import { AnalysisResult, AppMode } from '../types';

/**
 * Görme engelliler için optimize edilmiş, mekansal ve mod duyarlı sistem promptu oluşturur.
 */
const getSystemPrompt = (mode: AppMode): string => {
    const basePrompt = `Sen "Üçüncü Göz" AI asistanısın. Görme engelli kullanıcıya dünyayı anlatıyorsun.
HİYERARŞİ VE KURALLAR (ÖNEMLİ):
1. Önce Basitlik: Nesnelerin adını doğrudan söyle (örn: "Sandalye", "Masa"). 
2. Önce Güvenlik: Kullanıcının önündeki engelleri (basamak, sehpa, kablo) "Dikkat et" uyarısıyla en başta söyle.
3. Mekansal Bilgi: Saat yönü tekniğini kullan (örn: "Saat 2 yönünde sandalye var, dikkat et").
4. Mesafe: Yakınlığı belirt (Dibinde, 1 metre, 3 metre).
5. Netlik: "Görüyorum" gibi gereksiz kelimeleri at. Doğrudan "Sandalyeye dikkat et" veya "Önün boş" de.`;

    const modePrompts: Record<string, string> = {
        [AppMode.SCAN]: `MOD: TARAMA. Çevrede ne olduğunu genel olarak betimle. Önemli nesneleri ve konumlarını söyle.`,
        [AppMode.READ]: `MOD: OKUMA. Görüntüdeki metinlere odaklan. Tabela, belge veya ekranlardaki yazıları oku. Eğer metin yoksa belirt.`,
        [AppMode.NAVIGATE]: `MOD: YOL TARİFİ. Yürünebilir alanlara, kapılara ve engellere odaklan. Sol-sağ yönlendirmeleri yap.`,
        [AppMode.EMERGENCY]: `MOD: ACİL DURUM. Sadece en kritik güvenlik risklerini hemen söyle. Tehlike yoksa güvenli olduğunu belirt.`
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
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://tubitak-third-eye.vercel.app',
                    'X-Title': 'Üçüncü Göz'
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

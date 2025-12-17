import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Health Check
    if (req.method === 'GET') {
        const hasKey = !!process.env.OPENROUTER_API_KEY;
        return res.status(200).json({
            status: "Sistem Ayakta",
            apiKeyConfigured: hasKey,
            environment: process.env.NODE_ENV,
            provider: "OpenRouter"
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            console.error("HATA: OpenRouter API Key bulunamadı!");
            return res.status(500).json({
                error: "API Anahtarı Bulunamadı",
                details: "Vercel'de OPENROUTER_API_KEY değişkeni tanımlı mı?"
            });
        }

        if (!req.body) {
            return res.status(400).json({ error: "İstek gövdesi boş" });
        }

        let { image, mode } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'Resim verisi eksik.' });
        }

        // --- GÖRÜNTÜ TEMİZLEME ---
        let base64Data = image;
        let mimeType = "image/jpeg";
        if (image.startsWith("data:")) {
            const parts = image.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        }

        // Boşlukları ve yeni satırları temizle
        base64Data = base64Data.replace(/[\n\r\s]/g, "");

        // Tekrar birleştir
        const cleanImageUrl = `data:${mimeType};base64,${base64Data}`;

        console.log(`OpenRouter Analiz Başlıyor. Mod: ${mode || 'SCAN'}, Boyut: ${Math.round(cleanImageUrl.length / 1024)} KB`);

        // OpenRouter API Call
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tubitak19.vercel.app',
                'X-Title': 'Üçüncü Göz'
            },
            body: JSON.stringify({
                model: 'qwen/qwen-2.5-vl-7b-instruct:free',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Sen kör bir kullanıcıya yardım eden görme asistanı "Üçüncü Göz"sün. 

GÖREV: Görüntüyü analiz et ve kör kullanıcıya DETAYLI yönlendirme yap.

ÖNEMLİ KURALLAR:
1. MESAFE TAHMİNİ YAP: "1 metre önünde", "2.5 metre sağında", "yaklaşık 5 adım ileride" gibi
2. YÖN BELİRT: "sağdan", "soldan", "tam karşında", "sağ çaprazında" gibi
3. ENGEL TÜRÜNÜ AÇIKLA: "duvar", "masa", "merdiven", "çukur", "kaldırım", "araba" vs.
4. TEHLİKE SEVİYESİ: Acil tehlikeler için "DİKKAT!" ile başla
5. YÜRÜME TALİMATI VER: "sağa dön ve düz git", "sola doğru 2 adım at" gibi

ÖRNEK CEVAPLAR:
- "DİKKAT! 1.5 metre önünde duvar var. Sağa dön ve düz devam et."
- "2 metre sağında masa var. Soldan dolaşabilirsin."
- "Yaklaşık 3 adım ileride merdiven başlıyor. Yavaşla ve korkuluğu tut."
- "Tam önünde açık alan var, güvenle ilerleyebilirsin."

Mod: ${mode || 'SCAN'}

JSON FORMATINDA CEVAP VER:
{
  "speech": "DETAYLI TALİMAT BURAYA (mesafe + yön + engel + ne yapmalı)",
  "boxes": []
}`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: cleanImageUrl
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1,
                max_tokens: 800
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenRouter API Error:", errorText);
            throw new Error(`OpenRouter API Error ${response.status}: ${errorText}`);
        }

        const completion = await response.json();
        const content = completion.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("OpenRouter API'den boş içerik geldi.");
        }

        console.log("OpenRouter Response:", content.substring(0, 100));

        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('SERVER FATAL ERROR:', error);

        return res.status(error.status || 500).json({
            error: error.message || 'Bilinmeyen sunucu hatası',
            details: error.toString()
        });
    }
}

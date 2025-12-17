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
        const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY; // GEMINI_API_KEY öncelikli

        if (!apiKey) {
            console.error("HATA: API Key bulunamadı!");
            return res.status(500).json({ error: "API Anahtarı Bulunamadı" });
        }

        if (!req.body || !req.body.image) {
            return res.status(400).json({ error: 'Resim verisi eksik.' });
        }

        const { image, mode } = req.body;
        let base64Data = image;
        if (image.startsWith("data:")) {
            base64Data = image.split(",")[1];
        }

        // Temizle
        base64Data = base64Data.replace(/[\n\r\s]/g, "");

        console.log(`Gemini Analiz Başlıyor. Mod: ${mode || 'SCAN'}`);

        // Google Gemini API Call (Direct)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: base64Data } },
                        {
                            text: `Sen "Üçüncü Göz" projesinin kör kullanıcı asistanısın. 
GÖREV: Görüntüyü analiz et ve kör kullanıcıyı YÖNET. 

KURALLAR:
1. MESAFE VE YÖN VER: "2 metre önünde çukur var, sağdan ilerle" gibi.
2. ADIM ADIM TALİMAT: "3 adım sonra merdiven var, sola yanaş" gibi.
3. TEHLİKE ANALİZİ: Potansiyel her riski (duvar, araç, basamak) bildir.
4. EMİR KİPİ: "DUR", "İLERLE", "SAĞA DÖN" gibi net konuş.

JSON FORMATINDA CEVAP VER:
{
  "speech": "Anlaşılır, detaylı ve yönlendirici sesli komut",
  "boxes": []
}

Mod: ${mode || 'SCAN'}`
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 800,
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error:", errorText);

            let userMsg = "Analiz Hatası.";
            if (response.status === 429) userMsg = "Günlük sınır doldu. Lütfen biraz bekleyin.";

            return res.status(response.status).json({ content: JSON.stringify({ speech: userMsg, boxes: [] }) });
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) {
            return res.status(200).json({ content: JSON.stringify({ speech: "Üzgünüm, şu an göremiyorum.", boxes: [] }) });
        }

        console.log("Gemini Response:", content.substring(0, 100));
        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('SERVER FATAL ERROR:', error);
        return res.status(500).json({ error: error.message || 'Sunucu hatası' });
    }
}

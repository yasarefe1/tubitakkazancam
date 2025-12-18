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
        // Öncelikli olarak GEMINI_API_KEY'e bak, yoksa OPENROUTER_API_KEY'e bak
        const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;

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

        // --- HİBRİT MANTIK: Key tipine göre provider seç ---
        const isGoogleKey = apiKey.startsWith("AIza");

        const systemPrompt = `Sen "Üçüncü Göz" AI asistanısın. Köre rehbersin.
KURALLAR:
1. İLİŞKİSEL ANLATIM: "Masada monitör, önünde klavye var" gibi nesne ilişkilerini kur.
2. KURALLI DİL: Devrik cümle kurma, akıcı ol (Max 15-20 kelime).
3. ÖNCE GÜVENLİK: Dur, dikkat gibi hayati uyarıları ilk cümlede ver.
JSON: {"speech": "saat 12 yönünde bir masa, üzerinde ise monitör bulunuyor", "boxes": []}`;

        let fetchUrl = "";
        let fetchOptions: any = {};

        if (isGoogleKey) {
            // DOĞRUDAN GOOGLE GEMINI
            console.log("Mod: Doğrudan Google Gemini API");
            fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Data } }, { text: systemPrompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: "application/json" }
                })
            };
        } else {
            // OPENROUTER ÜZERİNDEN QWEN VL - Vision Language Model
            console.log("🚀 Vercel Backend: OpenRouter Qwen3 VL analizi başlıyor...");
            fetchUrl = 'https://openrouter.ai/api/v1/chat/completions';
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://tubitak-third-eye.vercel.app',
                    'X-Title': 'Üçüncü Göz (Vercel)'
                },
                body: JSON.stringify({
                    model: 'qwen/qwen-2.5-vl-7b-instruct:free',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: systemPrompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
                        ]
                    }],
                    temperature: 0.1,
                    max_tokens: 800
                })
            };
        }

        const response = await fetch(fetchUrl, fetchOptions);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Vercel Backend API Hatası:", response.status, errorText);

            let userMsg = "Analiz Hatası.";
            if (response.status === 429) userMsg = "Günlük sınır doldu veya kota aşıldı.";
            if (response.status === 401 || response.status === 403) userMsg = "API Anahtarı geçersiz.";

            return res.status(response.status).json({ content: JSON.stringify({ speech: userMsg, boxes: [] }) });
        }

        const data = await response.json();
        console.log("📥 Vercel Backend: Yanıt alındı.");

        let content = "";
        if (isGoogleKey) {
            content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
            content = data.choices?.[0]?.message?.content;
        }

        if (!content) {
            return res.status(200).json({ content: JSON.stringify({ speech: "Üzgünüm, şu an görüntüyü işleyemiyorum.", boxes: [] }) });
        }

        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('SERVER FATAL ERROR:', error);
        return res.status(500).json({ error: error.message || 'Sunucu hatası' });
    }
}

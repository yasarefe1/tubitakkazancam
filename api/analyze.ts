import { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

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

    // Health Check (DEBUG için)
    if (req.method === 'GET') {
        const hasKey = !!(process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY);
        return res.status(200).json({
            status: "Sistem Ayakta",
            apiKeyConfigured: hasKey,
            environment: process.env.NODE_ENV
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const apiKey = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY;

        if (!apiKey) {
            console.error("HATA: API Key bulunamadı!");
            return res.status(500).json({
                error: "API Anahtarı Bulunamadı",
                details: "Vercel'de VITE_GROQ_API_KEY değişkeni tanımlı mı?"
            });
        }

        const groq = new Groq({ apiKey });

        if (!req.body) {
            return res.status(400).json({ error: "İstek gövdesi boş" });
        }

        let { image, mode } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'Resim verisi eksik.' });
        }

        // --- GÖRÜNTÜ TEMİZLEME (ULTIMATE) ---
        // 1. Varsa header'ı ayır
        let base64Data = image;
        let mimeType = "image/jpeg";
        if (image.startsWith("data:")) {
            const parts = image.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        }

        // 2. Boşlukları ve yeni satırları KESİN temizle
        base64Data = base64Data.replace(/[\n\r\s]/g, "");

        // 3. Tekrar birleştir
        const cleanImageUrl = `data:${mimeType};base64,${base64Data}`;

        console.log(`Analiz Başlıyor. Mod: ${mode || 'SCAN'}, Temizlenmiş Boyut: ${Math.round(cleanImageUrl.length / 1024)} KB`);

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: `Sen kör bir kullanıcıya yardım eden asistan "Üçüncü Göz"sün. Mod: ${mode || 'SCAN'}. JSON FORMATINDA KISA CEVAP VER: { "speech": "...", "boxes": [] }` },
                        {
                            type: "image_url",
                            image_url: {
                                url: cleanImageUrl
                            }
                        }
                    ],
                },
            ],
            // 11b flakier olabilir, 90b daha sağlam
            model: "llama-3.2-90b-vision-preview",
            temperature: 0.1,
            max_tokens: 350,
            stream: false,
        });

        const content = completion.choices[0]?.message?.content;

        if (!content) {
            throw new Error("Groq API'den boş içerik geldi.");
        }

        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('SERVER FATAL ERROR:', error);

        return res.status(error.status || 500).json({
            error: error.message || 'Bilinmeyen sunucu hatası',
            details: error.response?.data || error.stack
        });
    }
}

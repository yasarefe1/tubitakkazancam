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
                details: "Vercel'de VITE_GROQ_API_KEY değişkeni tanımlı mı? Lütfen Ayarlar -> Environment Variables kısmını kontrol et."
            });
        }

        const groq = new Groq({ apiKey });

        // Body parsing kontrolü
        if (!req.body) {
            return res.status(400).json({ error: "İstek gövdesi boş (Body is empty)" });
        }

        const { image, mode } = req.body;

        if (!image) {
            console.error("HATA: Resim verisi yok.");
            return res.status(400).json({ error: 'Resim verisi (image field) eksik.' });
        }

        console.log(`İstek alındı. Mod: ${mode}, Resim: ${image.substring(0, 30)}...`);

        const systemPrompt = `Sen kör bir kullanıcıya yardım eden asistan "Üçüncü Göz"sün.
Görevin: Gördüğün sahneyi ve nesneleri analiz edip JSON formatında yanıtlamak.
Mod: ${mode || 'SCAN'}
Yanıt Formatı (KESİN): { "speech": "Kısa sesli uyarı", "boxes": [{"label": "Nesne", "ymin": 0, "xmin": 0, "ymax": 0, "xmax": 0}] }`;

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: systemPrompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: image
                            }
                        }
                    ],
                },
            ],
            model: "llama-3.2-11b-vision-preview",
            temperature: 0.1,
            max_tokens: 350,
            stream: false,
        });

        const content = completion.choices[0]?.message?.content;

        if (!content) {
            console.error("Groq-SDK HATA: Boş yanıt");
            throw new Error("Groq sunucusu boş bir cevap döndürdü.");
        }

        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('SERVER ERROR:', error);

        const statusCode = error.status || 500;
        const errorMessage = error.message || 'Bilinmeyen sunucu hatası';

        return res.status(statusCode).json({
            error: errorMessage,
            code: error.code || 'API_ERROR',
            type: error.constructor.name
        });
    }
}

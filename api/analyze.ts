import { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

const groq = new Groq({
    apiKey: process.env.VITE_GROQ_API_KEY, // Vercel Environment Variables'dan okuyacak
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS Headers (Tarayıcıdan gelen isteği kabul etmesi için)
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { image, mode } = req.body || {};

        if (!process.env.VITE_GROQ_API_KEY) {
            console.error("Vercel'de VITE_GROQ_API_KEY tanımlanmamış!");
            return res.status(500).json({ error: "Sunucu Yapılandırma Hatası: API Key Eksik. Lütfen Vercel Dashboard'dan VITE_GROQ_API_KEY ekleyin." });
        }

        if (!image) {
            console.error("İstek gövdesinde resim bulunamadı.");
            return res.status(400).json({ error: 'Resim verisi eksik.' });
        }

        const systemPrompt = `Sen kör bir kullanıcıya yardım eden asistan "Üçüncü Göz"sün.
Görevin: Gördüğün sahneyi ve nesneleri analiz edip JSON formatında yanıtlamak.
Mod: ${mode || 'SCAN'}
Yanıt Formatı (KESİN): { "speech": "Kısa sesli uyarı", "boxes": [{"label": "Nesne", "ymin": 0, "xmin": 0, "ymax": 0, "xmax": 0}] }`;

        console.log(`Analiz başlatılıyor: Mod=${mode}, Resim boyutu=${Math.round(image.length / 1024)} KB`);

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
            throw new Error("Groq API boş yanıt döndürdü.");
        }

        return res.status(200).json({ content });

    } catch (error: any) {
        console.error('Groq API Error:', error);
        const statusCode = error.status || 500;
        const errorMessage = error.message || 'Bilinmeyen sunucu hatası';

        return res.status(statusCode).json({
            error: errorMessage,
            details: error.response?.data || null
        });
    }
}

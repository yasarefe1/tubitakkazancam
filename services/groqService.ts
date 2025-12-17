import { AppMode, AnalysisResult } from "../types";

export const analyzeImageWithGroq = async (base64Image: string, mode: AppMode): Promise<AnalysisResult> => {
    try {
        // Base64 Format Kontrolü
        let imageUrl = base64Image;
        if (!base64Image.startsWith("data:")) {
            imageUrl = `data:image/jpeg;base64,${base64Image}`;
        }

        // Local API'ye istek at (Vercel Function)
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: imageUrl,
                mode: mode
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Sunucu Hatası (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const content = data.content;

        if (content) {
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                return JSON.parse(jsonMatch ? jsonMatch[0] : content) as AnalysisResult;
            } catch (e) {
                return { text: content, boxes: [] };
            }
        }

        return { text: "Boş yanıt.", boxes: [] };

    } catch (error: any) {
        console.error("API Error:", error);
        return { text: `Bağlantı Hatası: ${error.message}`, boxes: [] };
    }
};

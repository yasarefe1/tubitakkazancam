import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

// COCO-SSD model referansı
let model: cocoSsd.ObjectDetection | null = null;
let isLoading = false;

// Türkçe nesne isimleri
const turkishLabels: Record<string, string> = {
    'person': 'İnsan',
    'bicycle': 'Bisiklet',
    'car': 'Araba',
    'motorcycle': 'Motosiklet',
    'airplane': 'Uçak',
    'bus': 'Otobüs',
    'train': 'Tren',
    'truck': 'Kamyon',
    'boat': 'Tekne',
    'traffic light': 'Trafik ışığı',
    'fire hydrant': 'Yangın musluğu',
    'stop sign': 'Dur işareti',
    'parking meter': 'Parkmetre',
    'bench': 'Bank',
    'bird': 'Kuş',
    'cat': 'Kedi',
    'dog': 'Köpek',
    'horse': 'At',
    'sheep': 'Koyun',
    'cow': 'İnek',
    'elephant': 'Fil',
    'bear': 'Ayı',
    'zebra': 'Zebra',
    'giraffe': 'Zürafa',
    'backpack': 'Sırt çantası',
    'umbrella': 'Şemsiye',
    'handbag': 'El çantası',
    'tie': 'Kravat',
    'suitcase': 'Bavul',
    'frisbee': 'Frizbi',
    'skis': 'Kayak',
    'snowboard': 'Snowboard',
    'sports ball': 'Top',
    'kite': 'Uçurtma',
    'baseball bat': 'Beyzbol sopası',
    'baseball glove': 'Beyzbol eldiveni',
    'skateboard': 'Kaykay',
    'surfboard': 'Sörf tahtası',
    'tennis racket': 'Tenis raketi',
    'bottle': 'Şişe',
    'wine glass': 'Kadeh',
    'cup': 'Bardak',
    'fork': 'Çatal',
    'knife': 'Bıçak',
    'spoon': 'Kaşık',
    'bowl': 'Kase',
    'banana': 'Muz',
    'apple': 'Elma',
    'sandwich': 'Sandviç',
    'orange': 'Portakal',
    'broccoli': 'Brokoli',
    'carrot': 'Havuç',
    'hot dog': 'Sosisli',
    'pizza': 'Pizza',
    'donut': 'Donut',
    'cake': 'Pasta',
    'chair': 'Sandalye',
    'couch': 'Kanepe',
    'potted plant': 'Saksı bitkisi',
    'bed': 'Yatak',
    'dining table': 'Yemek masası',
    'toilet': 'Tuvalet',
    'tv': 'Televizyon',
    'laptop': 'Laptop',
    'mouse': 'Fare',
    'remote': 'Kumanda',
    'keyboard': 'Klavye',
    'cell phone': 'Telefon',
    'microwave': 'Mikrodalga',
    'oven': 'Fırın',
    'toaster': 'Tost makinesi',
    'sink': 'Lavabo',
    'refrigerator': 'Buzdolabı',
    'book': 'Kitap',
    'clock': 'Saat',
    'vase': 'Vazo',
    'scissors': 'Makas',
    'teddy bear': 'Oyuncak ayı',
    'hair drier': 'Saç kurutma',
    'toothbrush': 'Diş fırçası',
};

export interface DetectedObject {
    label: string;
    labelTr: string;
    confidence: number;
    bbox: {
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
    };
}

/**
 * COCO-SSD modelini yükle
 */
export const loadObjectDetectionModel = async (): Promise<boolean> => {
    if (model) return true;
    if (isLoading) return false;

    isLoading = true;
    console.log('[ObjectDetection] Model yükleniyor...');

    try {
        model = await cocoSsd.load({
            base: 'lite_mobilenet_v2' // Hızlı ve hafif model
        });
        console.log('[ObjectDetection] Model yüklendi!');
        return true;
    } catch (error) {
        console.error('[ObjectDetection] Model yüklenemedi:', error);
        return false;
    } finally {
        isLoading = false;
    }
};

/**
 * Video elementinden nesne tespiti yap
 */
export const detectObjects = async (
    videoElement: HTMLVideoElement
): Promise<DetectedObject[]> => {
    if (!model) {
        console.warn('[ObjectDetection] Model henüz yüklenmedi');
        return [];
    }

    try {
        const predictions = await model.detect(videoElement);

        return predictions
            .filter(pred => turkishLabels[pred.class]) // Sadece Türkçe karşılığı olanları al
            .map((pred) => {
                const [x, y, width, height] = pred.bbox;
                const videoWidth = videoElement.videoWidth;
                const videoHeight = videoElement.videoHeight;

                // Koordinatları normalize et (0-100 arası yüzdelik)
                // Video zaten tam ekran olduğu için doğrudan video boyutlarına bölüyoruz
                // ancak CSS'de object-fit: cover olduğu için hizalama kayabilir.
                // En sağlıklısı:
                const xmin = (x / videoWidth) * 100;
                const ymin = (y / videoHeight) * 100;
                const xmax = ((x + width) / videoWidth) * 100;
                const ymax = ((y + height) / videoHeight) * 100;

                return {
                    label: pred.class,
                    labelTr: turkishLabels[pred.class],
                    confidence: pred.score,
                    bbox: {
                        xmin,
                        ymin,
                        xmax,
                        ymax
                    }
                };
            });
    } catch (error) {
        console.error('[ObjectDetection] Tespit hatası:', error);
        return [];
    }
};

/**
 * Model yüklü mü kontrol et
 */
export const isModelLoaded = (): boolean => {
    return model !== null;
};

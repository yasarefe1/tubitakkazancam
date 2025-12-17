import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { CameraHandle } from '../types';

interface CameraLayerProps {
  onBrightnessCheck?: (brightness: number) => void;
}

const CameraLayer = forwardRef<CameraHandle, CameraLayerProps>((props, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    takePhoto: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      // MODE 1: SIMULATION
      if (isSimulated) {
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#eab308';
        ctx.font = '30px sans-serif';
        ctx.fillText('SIMULATION MODE', 50, 240);

        return canvas.toDataURL('image/jpeg', 0.8);
      }

      // MODE 2: REAL CAMERA
      const video = videoRef.current;
      if (!video || video.readyState !== 4) return null;

      const MAX_WIDTH = 640; // 800'den 640'a düşürüldü (400 Hatası için)
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);

      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const context = canvas.getContext('2d');
      if (!context) return null;

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/jpeg', 0.5); // Kalite 0.6 -> 0.5
    },
    toggleTorch: async (on: boolean) => {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) {
          try {
            // Check if torch is supported
            const capabilities = track.getCapabilities() as any;
            if (capabilities.torch) {
              await track.applyConstraints({
                advanced: [{ torch: on } as any]
              });
            }
          } catch (e) {
            console.warn("Torch control failed", e);
          }
        }
      }
    },
    setZoom: async (level: number) => {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) {
          try {
            const capabilities = track.getCapabilities() as any;
            if (capabilities.zoom) {
              const min = capabilities.zoom.min || 1;
              const max = capabilities.zoom.max || 1;
              const target = Math.max(min, Math.min(level, max));
              await track.applyConstraints({ advanced: [{ zoom: target } as any] });
            }
          } catch (e) {
            console.warn("Zoom control failed", e);
          }
        }
      }
    },
    switchCamera: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length < 2) return;

        const currentTrack = streamRef.current?.getVideoTracks()[0];
        const currentId = currentTrack?.getSettings().deviceId;
        const currentIndex = videoDevices.findIndex(d => d.deviceId === currentId);
        const nextIndex = (currentIndex + 1) % videoDevices.length;
        const nextDevice = videoDevices[nextIndex];

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }

        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: nextDevice.deviceId } },
          audio: false
        });

        streamRef.current = newStream;
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          await videoRef.current.play();

          const track = newStream.getVideoTracks()[0];
          const settings = track.getSettings();
          setIsMirrored(settings.facingMode === 'user');
        }
      } catch (e) {
        console.error("Switch failed", e);
      }
    }
  }));

  const [isMirrored, setIsMirrored] = useState<boolean>(false);

  // Fix for runtime crash: Restore these as dummies or helpers
  const debugLog: string[] = [];
  const addLog = (msg: string) => console.log("[Camera] " + msg);



  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      // 1. Check for Secure Context first
      if (!window.isSecureContext) {
        addLog("HATA: Güvenli Bağlantı (HTTPS) Yok");
        setIsSimulated(true);
        // We will show a custom message for this in the render part
        return;
      }

      addLog("Başlatılıyor...");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addLog("HATA: MediaDevices API Desteklenmiyor");
        if (isMounted) setIsSimulated(true);
        return;
      }

      try {
        // 1. Try HD Environment
        try {
          addLog("HD Kamera (Environment) deneniyor...");
          streamRef.current = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
              // zoom: true // Kullanıcı odaklanma istemiyor
            },
            audio: false
          });
          addLog("HD Kamera açıldı!");
        } catch (hdError) {
          console.warn("HD failed", hdError);
          addLog("HD başarısız. SD deneniyor...");

          // 2. Try SD Environment
          try {
            streamRef.current = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
              audio: false
            });
            addLog("SD Kamera açıldı!");
          } catch (sdError) {
            console.warn("SD failed", sdError);
            addLog("SD başarısız. GENEL mod deneniyor...");

            // 3. Try Generic Video (Any camera)
            try {
              streamRef.current = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
              });
              addLog("GENEL Kamera açıldı!");
            } catch (genError) {
              console.error("All camera attempts failed", genError);
              throw genError; // Propagate to main catch
            }
          }
        }

        if (isMounted && videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.setAttribute("playsinline", "true");
          addLog("Video oynatılıyor...");
          await videoRef.current.play();
          addLog("Video başladı!");
        }
      } catch (err: any) {
        const errorMessage = err.message || err.toString();
        addLog("KRİTİK HATA: " + errorMessage);
        console.error("Critical Camera Failure:", err);

        if (errorMessage.includes("Permission") || errorMessage.includes("NotAllowed") || err.name === "NotAllowedError") {
          setIsSimulated(true);
          addLog("ÇÖZÜM: Android Ayarları -> Gizlilik -> Kamera İzni");
        } else {
          if (isMounted) setIsSimulated(true);
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        // Turn off torch/zoom before stopping if possible
        if (track) {
          try { track.applyConstraints({ advanced: [{ torch: false, zoom: 1 } as any] }).catch(() => { }); } catch (e) { }
          track.stop();
        }
      }
    };
  }, []);

  // Brightness Detection Loop
  useEffect(() => {
    const interval = setInterval(() => {
      if (isSimulated || !videoRef.current || !canvasRef.current || !props.onBrightnessCheck) return;

      const video = videoRef.current;
      if (video.readyState !== 4) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // Sample a small version for performance
      canvas.width = 100;
      canvas.height = 100;
      ctx.drawImage(video, 0, 0, 100, 100);

      const frame = ctx.getImageData(0, 0, 100, 100);
      const data = frame.data;
      let totalBrightness = 0;

      for (let i = 0; i < data.length; i += 4) {
        // Luminance formula
        totalBrightness += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }

      const averageBrightness = totalBrightness / (data.length / 4);
      props.onBrightnessCheck(averageBrightness);

    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [isSimulated, props.onBrightnessCheck]);

  return (
    <div className="absolute top-0 left-0 w-full h-full z-0 overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {isSimulated ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 px-6 text-center z-50">
          <div className="text-6xl mb-4 animate-bounce">🔐</div>

          {!window.isSecureContext ? (
            <>
              <p className="text-red-400 font-bold text-xl mb-2">GÜVENLİ BAĞLANTI (HTTPS) GEREKLİ</p>
              <p className="text-zinc-400 text-sm mb-6 max-w-xs leading-relaxed">
                Kamera sadece <strong>HTTPS</strong> veya <strong>localhost</strong> üzerinden çalışır.<br /><br />
                Eğer telefondan test ediyorsan, bilgisayarın IP adresi yerine güvenli bir tünel (ngrok vs.) kullanman gerekebilir.
              </p>
            </>
          ) : (
            <>
              <p className="text-white font-bold text-xl mb-2">KAMERA İZNİ GEREKİYOR KANKA</p>
              <p className="text-zinc-400 text-sm mb-6 max-w-xs leading-relaxed">
                Sana etrafı anlatabilmem için gözlerine (kamerana) ihtiyacım var.<br /><br />
                Tarayıcı ayarlarından <strong>izin ver</strong> ve sayfayı yenile.
              </p>
              <button
                onClick={() => {
                  setIsSimulated(false);
                  window.location.reload();
                }}
                className="px-8 py-4 bg-blue-600 active:bg-blue-700 text-white rounded-full font-bold shadow-lg shadow-blue-900/20 active:scale-95 transition-all"
              >
                İzin İste / Yenile
              </button>
            </>
          )}
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: 'none' }}
        />
      )}
    </div>
  );
});

CameraLayer.displayName = 'CameraLayer';

export default CameraLayer;
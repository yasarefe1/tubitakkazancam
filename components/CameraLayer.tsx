import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { CameraHandle } from '../types';

const CameraLayer = forwardRef<CameraHandle>((props, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);

  useImperativeHandle(ref, () => ({
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

      const MAX_WIDTH = 800;
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);

      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const context = canvas.getContext('2d');
      if (!context) return null;

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/jpeg', 0.6);
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
            // Check if zoom is supported
            if (capabilities.zoom) {
              const min = capabilities.zoom.min || 1;
              const max = capabilities.zoom.max || 1;
              // Clamp the requested level
              const target = Math.max(min, Math.min(level, max));

              await track.applyConstraints({
                advanced: [{ zoom: target } as any]
              });
            }
          } catch (e) {
            console.warn("Zoom control failed", e);
          }
        }
      }
    }
  }));

  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("Camera API not supported");
        if (isMounted) setIsSimulated(true);
        return;
      }

      try {
        const hdConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            zoom: true // Request zoom capability
          },
          audio: false
        };

        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia(hdConstraints);
        } catch (hdError) {
          console.warn("HD Camera failed, trying SD...", hdError);
          const sdConstraints = {
            video: { facingMode: 'environment' },
            audio: false
          };
          streamRef.current = await navigator.mediaDevices.getUserMedia(sdConstraints);
        }

        if (isMounted && videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
        }
      } catch (err) {
        console.error("Critical Camera Failure:", err);
        if (isMounted) setIsSimulated(true);
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

  return (
    <div className="absolute top-0 left-0 w-full h-full z-0 overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />
      {isSimulated ? (
        <div className="w-full h-full flex flex-col items-center justify-center opacity-40 select-none bg-zinc-900">
          <div className="text-6xl mb-4">📷</div>
          <p className="text-white font-bold text-lg">KAMERA ERİŞİMİ YOK</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
      )}
    </div>
  );
});

CameraLayer.displayName = 'CameraLayer';

export default CameraLayer;
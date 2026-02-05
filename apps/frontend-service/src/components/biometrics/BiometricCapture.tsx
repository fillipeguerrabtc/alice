/**
 * BiometricCapture - Captura de imagem via webcam
 *
 * Fluxo CPU-only, sem liveness (Regra 6 CLAUDE.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type BiometricCaptureProps = {
  onCapture: (imageBase64: string) => void;
  onError?: (message: string) => void;
  autoStart?: boolean;
};

export function BiometricCapture({ onCapture, onError, autoStart = false }: BiometricCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const stopStream = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!isMountedRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (isMountedRef.current) {
        setIsStreaming(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao acessar a câmera';
      onErrorRef.current?.(message);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (autoStart) {
      startStream();
    }
    return () => {
      isMountedRef.current = false;
      stopStream();
    };
  }, [autoStart, startStream, stopStream]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      onError?.('Câmera não está pronta.');
      return;
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onError?.('Falha ao capturar imagem.');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    onCapture(dataUrl);
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex justify-center">
        <div className="w-full max-w-2xl aspect-video overflow-hidden rounded-md bg-black">
          <video ref={videoRef} className="h-full w-full object-contain" />
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={startStream} disabled={isStreaming}>
          Ativar câmera
        </Button>
        <Button variant="default" onClick={handleCapture} disabled={!isStreaming}>
          Capturar
        </Button>
        <Button variant="ghost" onClick={stopStream} disabled={!isStreaming}>
          Parar
        </Button>
      </div>
    </Card>
  );
}

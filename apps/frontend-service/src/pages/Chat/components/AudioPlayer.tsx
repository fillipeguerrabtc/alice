/**
 * AudioPlayer - Player de áudio inline para mensagens
 * 
 * Com controles de play/pause, volume e barra de progresso.
 * 
 * @module Chat/components/AudioPlayer
 */

import { useState, useRef, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaAttachment, formatDuration } from './types';

interface AudioPlayerProps {
  media: MediaAttachment;
}

export function AudioPlayer({ media }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(media.duration || 0);
  const [isMuted, setIsMuted] = useState(false);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audioRef.current.currentTime = percentage * duration;
  }, [duration]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  if (media.status === 'uploading' || media.status === 'processing') {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium truncate">{media.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {media.status === 'uploading' ? `Enviando... ${media.progress || 0}%` : 'Processando...'}
          </p>
        </div>
      </div>
    );
  }

  if (media.status === 'error') {
    return (
      <div className="flex items-center gap-3 p-3 bg-destructive/10 rounded-lg">
        <X className="h-5 w-5 text-destructive" />
        <p className="text-sm text-destructive">Erro ao carregar áudio</p>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 p-3 bg-muted rounded-lg max-w-[300px]" data-testid={`audio-player-${media.id}`}>
      <audio
        ref={audioRef}
        src={media.url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />
      
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={togglePlay}
          data-testid={`button-audio-play-${media.id}`}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        
        <div 
          className="flex-1 h-2 bg-background rounded-full cursor-pointer relative"
          onClick={handleSeek}
          data-testid={`audio-progress-${media.id}`}
        >
          <div 
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={toggleMute}
          data-testid={`button-audio-mute-${media.id}`}
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{formatDuration(currentTime)}</span>
        <span className="truncate mx-2 flex-1 text-center">{media.fileName}</span>
        <span>{formatDuration(duration)}</span>
      </div>

      {media.transcription && (
        <div className="mt-2 p-2 bg-background rounded text-xs text-muted-foreground">
          <p className="font-medium mb-1">Transcrição:</p>
          <p className="italic">{media.transcription}</p>
        </div>
      )}
    </div>
  );
}

/**
 * VideoPlayer - Player de vídeo inline para mensagens
 * 
 * Com controles nativos e opção de fullscreen.
 * 
 * @module Chat/components/VideoPlayer
 */

import { useState, useRef, useCallback } from 'react';
import { Play, Maximize2, Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MediaAttachment, formatDuration } from './types';

interface VideoPlayerProps {
  media: MediaAttachment;
}

export function VideoPlayer({ media }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  if (media.status === 'uploading' || media.status === 'processing') {
    return (
      <div className="flex items-center justify-center bg-muted rounded-lg p-4 min-h-[150px] max-w-[300px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">
            {media.status === 'uploading' ? `Enviando... ${media.progress || 0}%` : 'Processando vídeo...'}
          </p>
        </div>
      </div>
    );
  }

  if (media.status === 'error') {
    return (
      <div className="flex items-center justify-center bg-destructive/10 rounded-lg p-4 min-h-[100px]">
        <div className="text-center">
          <X className="h-6 w-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">Erro ao carregar vídeo</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div 
        className="relative group max-w-[300px] rounded-lg overflow-hidden"
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        data-testid={`video-player-${media.id}`}
      >
        <video
          ref={videoRef}
          src={media.url}
          poster={media.thumbnailUrl}
          className="w-full rounded-lg"
          onClick={togglePlay}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          preload="metadata"
        />
        
        {!isPlaying && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
            onClick={togglePlay}
          >
            <div className="h-12 w-12 rounded-full bg-primary/90 flex items-center justify-center">
              <Play className="h-6 w-6 text-primary-foreground ml-1" />
            </div>
          </div>
        )}
        
        <div 
          className={cn(
            "absolute bottom-2 right-2 flex gap-1 transition-opacity",
            showControls ? "opacity-100" : "opacity-0"
          )}
          style={{ visibility: showControls ? 'visible' : 'hidden' }}
        >
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowFullscreen(true)}
            data-testid={`button-video-fullscreen-${media.id}`}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              const link = document.createElement('a');
              link.href = media.url;
              link.download = media.fileName;
              link.click();
            }}
            data-testid={`button-video-download-${media.id}`}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
        
        {media.duration && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 text-xs bg-black/70 text-white rounded">
            {formatDuration(media.duration)}
          </div>
        )}
      </div>

      <Dialog open={showFullscreen} onOpenChange={setShowFullscreen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Vídeo</DialogTitle>
            <DialogDescription className="text-sm truncate">{media.fileName}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <video
              src={media.url}
              controls
              autoPlay
              className="max-h-[70vh] rounded-lg"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement('a');
                link.href = media.url;
                link.download = media.fileName;
                link.click();
              }}
              data-testid="button-download-fullscreen"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * InlineMediaAttachment - Renderiza mídia inline nas mensagens
 * 
 * @module Chat/components/InlineMediaAttachment
 */

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { MediaAttachment } from './types';
import { AudioPlayer } from './AudioPlayer';
// REMOVIDO 23/12/2025: VideoPlayer desabilitado (muito pesado para GPU)

interface InlineMediaAttachmentProps {
  media: MediaAttachment;
}

export function InlineMediaAttachment({ media }: InlineMediaAttachmentProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // REMOVIDO 23/12/2025: Bloco de vídeo removido (muito pesado para GPU)

  const canRenderImage = media.type === 'image' && Boolean(media.url || media.thumbnailUrl);

  useEffect(() => {
    if (media.type !== 'image') {
      setImageUrl(null);
      return;
    }
    setImageLoaded(false);
    setImageUrl(media.thumbnailUrl || media.url || null);
  }, [media.thumbnailUrl, media.type, media.url]);

  if (media.type === 'audio') {
    return <AudioPlayer media={media} />;
  }

  if (!canRenderImage && (media.status === 'uploading' || media.status === 'processing')) {
    return (
      <Skeleton className="w-full aspect-square max-w-[200px] rounded-lg" />
    );
  }

  if (media.status === 'error') {
    return (
      <div className="flex items-center justify-center bg-destructive/10 rounded-lg p-4 min-h-[80px]">
        <X className="h-5 w-5 text-destructive" />
      </div>
    );
  }

  return (
    <>
      <div className="relative group">
        {!imageLoaded && (
          <Skeleton className="w-full aspect-square max-w-[200px] rounded-lg" />
        )}
        <img
          src={imageUrl || undefined}
          alt={media.fileName}
          className={cn(
            "rounded-lg max-w-[200px] w-full object-cover cursor-pointer",
            !imageLoaded && "hidden"
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            if (imageUrl && media.url && imageUrl !== media.url) {
              setImageUrl(media.url);
            }
          }}
          onClick={() => setShowFullscreen(true)}
          data-testid={`image-attachment-${media.id}`}
        />
        
        <div 
          className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ visibility: 'hidden' }}
          onMouseEnter={(e) => { e.currentTarget.style.visibility = 'visible'; }}
          onMouseLeave={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        >
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              const link = document.createElement('a');
              link.href = media.url || imageUrl || '';
              link.download = media.fileName;
              link.click();
            }}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Dialog open={showFullscreen} onOpenChange={setShowFullscreen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Imagem</DialogTitle>
            <DialogDescription className="text-sm truncate">{media.fileName}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <img
              src={imageUrl || media.url || ''}
              alt={media.fileName}
              className="max-h-[70vh] rounded-lg object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

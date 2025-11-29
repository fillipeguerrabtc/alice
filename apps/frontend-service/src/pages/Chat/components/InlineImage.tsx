/**
 * InlineImage - Renderiza imagens geradas inline nas mensagens
 * 
 * Com sistema de rating para aprovação de training.
 * 
 * @module Chat/components/InlineImage
 */

import { useState } from 'react';
import { Loader2, X, Download, Star, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { GeneratedImageData } from './types';

interface InlineImageProps {
  image: GeneratedImageData;
  onRate?: (score: number) => void;
}

export function InlineImage({ image, onRate }: InlineImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);

  const imageSource = image.imageUrl || image.imagePath;

  if (image.status === 'pending' || image.status === 'processing') {
    return (
      <div className="flex items-center justify-center bg-muted rounded-lg p-4 min-h-[200px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">
            {image.status === 'pending' ? 'Aguardando processamento...' : 'Gerando imagem...'}
          </p>
        </div>
      </div>
    );
  }

  if (image.status === 'failed' || !imageSource) {
    return (
      <div className="flex items-center justify-center bg-destructive/10 rounded-lg p-4 min-h-[100px]">
        <div className="text-center">
          <X className="h-6 w-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">Falha ao gerar imagem</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative group">
        {!imageLoaded && (
          <Skeleton className="w-full aspect-square max-w-[300px] rounded-lg" />
        )}
        <img
          src={imageSource}
          alt={image.prompt}
          className={cn(
            "rounded-lg max-w-[300px] w-full object-cover cursor-pointer transition-transform",
            !imageLoaded && "hidden"
          )}
          onLoad={() => setImageLoaded(true)}
          onClick={() => setShowFullscreen(true)}
          data-testid={`image-generated-${image.id}`}
        />
        
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              const link = document.createElement('a');
              link.href = imageSource;
              link.download = `alice-${image.id}.png`;
              link.click();
            }}
            data-testid={`button-download-image-${image.id}`}
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowFullscreen(true)}
            data-testid={`button-fullscreen-image-${image.id}`}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>

        {onRate && (
          <div 
            className="absolute top-2 right-2 flex gap-0.5 p-1 bg-black/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseLeave={() => setHoveredStar(0)}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className="p-0.5"
                onMouseEnter={() => setHoveredStar(star)}
                onClick={() => onRate(star)}
                data-testid={`button-rate-${star}-${image.id}`}
              >
                <Star
                  className={cn(
                    "h-4 w-4 transition-colors",
                    (hoveredStar >= star || (image.feedbackScore && image.feedbackScore >= star))
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-white/70"
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showFullscreen} onOpenChange={setShowFullscreen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Imagem Gerada</DialogTitle>
            <DialogDescription className="text-sm truncate">{image.prompt}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <img
              src={imageSource}
              alt={image.prompt}
              className="max-h-[70vh] rounded-lg object-contain"
            />
          </div>
          <DialogFooter className="flex-row gap-2 flex-wrap">
            {onRate && (
              <div className="flex gap-1 mr-auto">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    className="p-1"
                    onClick={() => onRate(star)}
                  >
                    <Star
                      className={cn(
                        "h-5 w-5 transition-colors",
                        image.feedbackScore && image.feedbackScore >= star
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-muted-foreground"
                      )}
                    />
                  </button>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement('a');
                link.href = imageSource;
                link.download = `alice-${image.id}.png`;
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

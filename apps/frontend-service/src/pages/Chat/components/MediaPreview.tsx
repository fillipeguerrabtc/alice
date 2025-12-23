/**
 * MediaPreview - Preview compacto de mídia na área de input
 * 
 * @module Chat/components/MediaPreview
 */

import { Music, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaAttachment, formatFileSize } from './types';

interface MediaPreviewProps {
  media: MediaAttachment;
  onRemove: () => void;
}

export function MediaPreview({ media, onRemove }: MediaPreviewProps) {
  return (
    <div className="relative group">
      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg max-w-[200px]">
        {media.type === 'image' && (
          <div className="h-10 w-10 rounded bg-background flex items-center justify-center overflow-hidden shrink-0">
            <img src={media.url} alt={media.fileName} className="h-full w-full object-cover" />
          </div>
        )}
        {media.type === 'audio' && (
          <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <Music className="h-5 w-5 text-primary" />
          </div>
        )}
        {/* REMOVIDO 23/12/2025: Suporte a vídeo desabilitado (muito pesado para GPU) */}
        
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{media.fileName}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(media.fileSize)}</p>
        </div>
      </div>
      
      <Button
        variant="destructive"
        size="icon"
        className="absolute -top-2 -right-2 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        data-testid={`button-remove-media-${media.id}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

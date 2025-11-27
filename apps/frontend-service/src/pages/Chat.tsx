/**
 * Chat - Alice Enterprise Platform
 * 
 * Interface de chat moderna com streaming de tokens via WebSocket/SSE.
 * Design 2025 com animações Framer Motion e suporte multimodal.
 * Integração com RAG para contexto de documentos.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Plus, 
  MessageSquare,
  Sparkles,
  FileText,
  Paperclip,
  Copy,
  Check,
  Settings,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  Star,
  Music,
  Video,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface GeneratedImageData {
  id: string;
  prompt: string;
  imageUrl?: string;
  imagePath?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  width?: number;
  height?: number;
  feedbackScore?: number;
}

// Tipos de mídia suportados para upload
type MediaType = 'image' | 'audio' | 'video';

interface MediaAttachment {
  id: string;
  type: MediaType;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number; // Para áudio/vídeo em segundos
  width?: number;    // Para imagens/vídeo
  height?: number;   // Para imagens/vídeo
  thumbnailUrl?: string; // Para vídeo
  transcription?: string; // Para áudio (transcrição do Whisper)
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress?: number; // 0-100 para upload
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  tokensUsados?: number;
  tipo?: 'text' | 'image' | 'audio' | 'video' | 'mixed';
  anexos?: unknown[];
  generatedImage?: GeneratedImageData;
  mediaAttachments?: MediaAttachment[]; // Anexos de mídia do usuário
}

// Limites de arquivo (em bytes)
const FILE_LIMITS = {
  image: 10 * 1024 * 1024,  // 10MB
  audio: 25 * 1024 * 1024,  // 25MB
  video: 100 * 1024 * 1024, // 100MB
};

// Tipos MIME suportados
const ACCEPTED_TYPES: Record<MediaType, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
};

// Helper para determinar tipo de mídia pelo MIME type
function getMediaType(mimeType: string): MediaType | null {
  if (ACCEPTED_TYPES.image.includes(mimeType)) return 'image';
  if (ACCEPTED_TYPES.audio.includes(mimeType)) return 'audio';
  if (ACCEPTED_TYPES.video.includes(mimeType)) return 'video';
  return null;
}

// Helper para formatar tamanho de arquivo
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper para formatar duração
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface Conversation {
  id: string;
  titulo: string;
  criadoEm: string;
  atualizadoEm: string;
}

interface ConversationsResponse {
  conversations: Conversation[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const messageVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10, scale: 0.95 },
};

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
};

function InlineImage({ image, onRate }: { image: GeneratedImageData; onRate?: (score: number) => void }) {
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
        </div>

        {onRate && (
          <div className="flex items-center gap-0.5 mt-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => onRate(star)}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                className="p-0.5 transition-colors"
                data-testid={`button-rate-image-${image.id}-${star}`}
              >
                <Star
                  className={cn(
                    "h-4 w-4 transition-colors",
                    (hoveredStar >= star || (image.feedbackScore && image.feedbackScore >= star))
                      ? "text-yellow-500 fill-yellow-500"
                      : "text-muted-foreground"
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
          <DialogFooter>
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

/**
 * AudioPlayer - Player de áudio inline para mensagens
 * Com controles de play/pause, volume e barra de progresso
 */
function AudioPlayer({ media }: { media: MediaAttachment }) {
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

/**
 * VideoPlayer - Player de vídeo inline para mensagens
 * Com controles nativos e opção de fullscreen
 */
function VideoPlayer({ media }: { media: MediaAttachment }) {
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
        
        {/* Overlay de play central */}
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
        
        {/* Controles visíveis no hover */}
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
      </div>

      {/* Dialog fullscreen */}
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
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * MediaPreview - Preview de mídia antes de enviar
 * Mostra thumbnail/info e permite remover
 */
function MediaPreview({ 
  media, 
  onRemove 
}: { 
  media: MediaAttachment; 
  onRemove: () => void;
}) {
  return (
    <div className="relative group inline-block" data-testid={`media-preview-${media.id}`}>
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
        {media.type === 'video' && (
          <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <Video className="h-5 w-5 text-primary" />
          </div>
        )}
        
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

/**
 * InlineMediaAttachment - Renderiza mídia inline nas mensagens
 */
function InlineMediaAttachment({ media }: { media: MediaAttachment }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);

  if (media.type === 'audio') {
    return <AudioPlayer media={media} />;
  }

  if (media.type === 'video') {
    return <VideoPlayer media={media} />;
  }

  // Tipo image
  if (media.status === 'uploading' || media.status === 'processing') {
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
          src={media.url}
          alt={media.fileName}
          className={cn(
            "rounded-lg max-w-[200px] w-full object-cover cursor-pointer",
            !imageLoaded && "hidden"
          )}
          onLoad={() => setImageLoaded(true)}
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
              link.href = media.url;
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
              src={media.url}
              alt={media.fileName}
              className="max-h-[70vh] rounded-lg object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  onRateImage,
}: { 
  message: Message; 
  isStreaming: boolean;
  isLast: boolean;
  onRateImage?: (imageId: string, score: number) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const isUser = message.role === 'user';

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        'flex gap-3 group',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
      )}
      
      <div className={cn(
        'flex flex-col max-w-[80%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        <Card
          className={cn(
            'p-3 shadow-sm transition-all',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted rounded-bl-sm'
          )}
          data-testid={`message-${message.role}-${message.id}`}
        >
          {/* Anexos de mídia do usuário */}
          {message.mediaAttachments && message.mediaAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.mediaAttachments.map((media) => (
                <InlineMediaAttachment key={media.id} media={media} />
              ))}
            </div>
          )}

          {message.content && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
              {isStreaming && isLast && message.role === 'assistant' && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
              )}
            </div>
          )}
          
          {/* Imagens geradas pela IA */}
          {message.generatedImage && (
            <div className={cn(message.content && "mt-3")}>
              <InlineImage 
                image={message.generatedImage} 
                onRate={onRateImage ? (score) => onRateImage(message.generatedImage!.id, score) : undefined}
              />
            </div>
          )}
        </Card>
        
        <div className={cn(
          'flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity',
          isUser ? 'flex-row-reverse' : ''
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {copied ? 'Copiado!' : 'Copiar'}
            </TooltipContent>
          </Tooltip>
          
          {message.tokensUsados && (
            <span className="text-xs text-muted-foreground">
              {message.tokensUsados} tokens
            </span>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </motion.div>
  );
}

function ConversationItem({ 
  conversation, 
  isActive, 
  onClick 
}: { 
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      variants={messageVariants}
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors hover-elevate',
        isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted'
      )}
    >
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{conversation.titulo}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {new Date(conversation.criadoEm).toLocaleDateString('pt-BR')}
      </p>
    </motion.button>
  );
}

function WelcomeScreen() {
  const { t } = useTranslation();
  
  const suggestions = [
    { icon: Sparkles, text: 'Explique um conceito complexo de forma simples' },
    { icon: FileText, text: 'Ajude-me a escrever um documento' },
    { icon: Settings, text: 'Como configurar a plataforma Alice?' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center p-6"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 100 }}
        className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground mb-6 shadow-lg"
      >
        <Bot className="h-10 w-10" />
      </motion.div>
      
      <h2 className="text-2xl font-bold mb-2">
        {t('chat.welcome') || 'Alice IA Enterprise'}
      </h2>
      <p className="text-muted-foreground max-w-md mb-8">
        {t('chat.welcomeMessage') || 'Olá! Sou a Alice, sua assistente de IA enterprise com Llama 4 Maverick. Como posso ajudar você hoje?'}
      </p>

      <div className="grid gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 hover-elevate text-left transition-colors"
          >
            <div className="p-2 rounded-md bg-primary/10">
              <suggestion.icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm">{suggestion.text}</span>
          </motion.button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-8">
        <Badge variant="outline" className="text-xs">
          Llama 4 Maverick
        </Badge>
        <Badge variant="outline" className="text-xs">
          400B parâmetros
        </Badge>
        <Badge variant="outline" className="text-xs">
          RAG integrado
        </Badge>
      </div>
    </motion.div>
  );
}

export default function Chat() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handler para seleção de arquivo
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const mediaType = getMediaType(file.type);
      
      if (!mediaType) {
        console.warn('Tipo de arquivo não suportado:', file.type);
        continue;
      }

      const limit = FILE_LIMITS[mediaType];
      if (file.size > limit) {
        console.warn(`Arquivo muito grande: ${formatFileSize(file.size)} > ${formatFileSize(limit)}`);
        continue;
      }

      // Criar preview local imediato
      const objectUrl = URL.createObjectURL(file);
      const mediaId = crypto.randomUUID();

      const newMedia: MediaAttachment = {
        id: mediaId,
        type: mediaType,
        url: objectUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: 'ready', // Preview local pronto
      };

      // Extrair duração para áudio/vídeo
      if (mediaType === 'audio' || mediaType === 'video') {
        const mediaElement = document.createElement(mediaType);
        mediaElement.src = objectUrl;
        mediaElement.onloadedmetadata = () => {
          setPendingMedia(prev => 
            prev.map(m => m.id === mediaId ? { ...m, duration: mediaElement.duration } : m)
          );
        };
      }

      // Extrair dimensões para imagem
      if (mediaType === 'image') {
        const img = new Image();
        img.src = objectUrl;
        img.onload = () => {
          setPendingMedia(prev => 
            prev.map(m => m.id === mediaId ? { ...m, width: img.width, height: img.height } : m)
          );
        };
      }

      setPendingMedia(prev => [...prev, newMedia]);
    }

    // Limpar input para permitir re-seleção do mesmo arquivo
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Remover mídia pendente
  const removePendingMedia = useCallback((mediaId: string) => {
    setPendingMedia(prev => {
      const media = prev.find(m => m.id === mediaId);
      if (media) {
        URL.revokeObjectURL(media.url);
      }
      return prev.filter(m => m.id !== mediaId);
    });
  }, []);

  // Limpar todas as mídias pendentes ao enviar
  const clearPendingMedia = useCallback(() => {
    pendingMedia.forEach(m => URL.revokeObjectURL(m.url));
    setPendingMedia([]);
  }, [pendingMedia]);

  const { data: conversationsData, isLoading: conversationsLoading } = useQuery<ConversationsResponse>({
    queryKey: ['/api/chat/conversations'],
    staleTime: 1000 * 60,
  });

  const { data: conversationMessages } = useQuery<{ messages: Message[] }>({
    queryKey: ['/api/chat/conversations', conversationId, 'messages'],
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (conversationMessages?.messages) {
      setMessages(conversationMessages.messages);
    }
  }, [conversationMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: async ({ content, mediaAttachments }: { content: string; mediaAttachments?: MediaAttachment[] }) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        tipo: mediaAttachments && mediaAttachments.length > 0 ? 'mixed' : 'text',
        mediaAttachments,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const res = await apiRequest('POST', '/api/chat/stream', {
        conversationId,
        messages: [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.content = fullContent;
                  }
                  return newMessages;
                });
              }
            } catch {
              // Ignorar erros de parse
            }
          }
        }
      }

      setIsStreaming(false);
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      return fullContent;
    },
    onError: () => {
      setIsStreaming(false);
    },
  });

  const rateImage = useMutation({
    mutationFn: async ({ imageId, score }: { imageId: string; score: number }) => {
      await apiRequest('POST', `/api/chat/images/${imageId}/rate`, { score });
    },
    onSuccess: (_, { imageId, score }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.generatedImage?.id === imageId) {
            return {
              ...msg,
              generatedImage: { ...msg.generatedImage, feedbackScore: score },
            };
          }
          return msg;
        })
      );
    },
  });

  const handleRateImage = useCallback((imageId: string, score: number) => {
    rateImage.mutate({ imageId, score });
  }, [rateImage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Permitir envio com apenas mídia (sem texto)
    if ((!input.trim() && pendingMedia.length === 0) || isStreaming) return;

    sendMessage.mutate({ 
      content: input.trim(), 
      mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined 
    });
    setInput('');
    clearPendingMedia();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    navigate('/chat');
  };

  const conversations = conversationsData?.conversations || [];

  return (
    <div className="flex h-full">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            variants={sidebarVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="w-64 border-r bg-muted/30 flex flex-col"
          >
            <div className="p-3 border-b">
              <Button 
                onClick={handleNewChat}
                className="w-full justify-start gap-2"
                data-testid="button-new-chat"
              >
                <Plus className="h-4 w-4" />
                Nova Conversa
              </Button>
            </div>
            
            <ScrollArea className="flex-1 p-2">
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-1"
              >
                {conversationsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))
                ) : conversations.length > 0 ? (
                  conversations.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === conversationId}
                      onClick={() => navigate(`/chat/${conv.id}`)}
                    />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma conversa</p>
                  </div>
                )}
              </motion.div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-2 p-3 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-testid="button-toggle-sidebar"
            >
              {sidebarOpen ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <h1 className="text-lg font-semibold truncate" data-testid="text-chat-title">
              {conversationId ? 'Conversa' : 'Nova Conversa'}
            </h1>
          </div>
          
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="hidden sm:flex gap-1">
              <Sparkles className="h-3 w-3" />
              Llama 4
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              <WelcomeScreen />
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-4 max-w-4xl mx-auto"
              >
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming}
                    isLast={index === messages.length - 1}
                    onRateImage={handleRateImage}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </ScrollArea>

        <motion.form 
          onSubmit={handleSubmit} 
          className="p-4 border-t bg-background/95 backdrop-blur"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Input file hidden */}
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio, ...ACCEPTED_TYPES.video].join(',')}
            multiple
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />

          {/* Preview de mídia pendente */}
          {pendingMedia.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 max-w-4xl mx-auto">
              {pendingMedia.map((media) => (
                <MediaPreview 
                  key={media.id} 
                  media={media} 
                  onRemove={() => removePendingMedia(media.id)} 
                />
              ))}
            </div>
          )}

          <div className="flex gap-2 max-w-4xl mx-auto">
            <div className="flex-1 flex items-end gap-2 p-2 rounded-lg border bg-background shadow-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={isStreaming}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Anexar arquivo (imagem, áudio, vídeo)</TooltipContent>
              </Tooltip>
              
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={pendingMedia.length > 0 ? 'Adicione uma mensagem (opcional)...' : (t('chat.placeholder') || 'Digite sua mensagem...')}
                className="flex-1 min-h-[36px] max-h-[200px] resize-none bg-transparent text-sm focus-visible:outline-none"
                disabled={isStreaming}
                data-testid="input-chat-message"
              />
              
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={(!input.trim() && pendingMedia.length === 0) || isStreaming}
                data-testid="button-send-message"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          
          <p className="text-xs text-center text-muted-foreground mt-2">
            Alice pode cometer erros. Verifique informações importantes.
          </p>
        </motion.form>
      </div>
    </div>
  );
}

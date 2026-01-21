/**
 * Chat - Alice Enterprise Platform
 * 
 * Interface de chat moderna com streaming de tokens via WebSocket/SSE.
 * Design 2025 com animações Framer Motion e suporte multimodal.
 * Integração com RAG para contexto de documentos.
 * 
 * MOBILE-FIRST 12/01/2026:
 * - Experiência de APP nativa em dispositivos móveis
 * - Sidebar como drawer offcanvas em mobile
 * - Input fixo com safe area para notch
 * - Full-screen chat experience
 * - Gestos e transições nativas
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * @author Fillipe Guerra
 * @version 2.0.0
 * @date 12 de Janeiro de 2026
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  Plus, 
  MessageSquare,
  Trash2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Menu,
  FileCheck,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';

/**
 * Hook para detectar viewport mobile
 * Breakpoint: 768px (md do Tailwind)
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}

import {
  Message,
  MediaAttachment,
  Conversation,
  ConversationsResponse,
  FILE_LIMITS,
  ACCEPTED_TYPES,
  getMediaType,
  formatFileSize,
} from './components/types';

interface Namespace {
  id: string;
  nome: string;
  slug: string;
}

type ApprovalPolicy = 'always_confirm' | 'confirm_risky' | 'never_confirm';
import { MessageBubble } from './components/MessageBubble';
import { ConversationItem } from './components/ConversationItem';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ChatInput } from './components/ChatInput';

type StreamMediaAttachmentPayload = {
  id: string;
  filename: string;
  mimeType: string;
  file?: string;
  uploadId?: string;
  fileUrl?: string;
  size?: number;
};

type ServerMessage = Partial<Message> & {
  conteudo?: string | null;
  criadoEm?: string | null;
  isFromUser?: boolean | null;
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao converter arquivo em base64'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

async function mediaAttachmentToBase64(media: MediaAttachment): Promise<string> {
  if (media.file) {
    return fileToBase64(media.file);
  }
  if (media.url) {
    const response = await fetch(media.url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Falha ao baixar arquivo de mídia');
    }
    const blob = await response.blob();
    const file = new File([blob], media.fileName, { type: media.mimeType });
    return fileToBase64(file);
  }
  throw new Error('Arquivo de mídia indisponível para upload');
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
} as const;

/**
 * Componente da lista de conversas - EXTRAÍDO para evitar anti-pattern
 * 
 * CORREÇÃO 12/01/2026: Componente definido FORA do Chat para evitar
 * re-criação a cada re-render. Isso previne:
 * - Reset de animações Framer Motion
 * - Perda de scroll position
 * - Perda de estado interno
 * 
 * @see https://react.dev/learn/your-first-component#defining-a-component
 */
interface ConversationsListProps {
  conversations: Conversation[];
  conversationId?: string;
  isLoading: boolean;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelectionMode: () => void;
  onToggleSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
  onCloseSidebar?: () => void;
}

function ConversationsList({
  conversations,
  conversationId,
  isLoading,
  onNewChat,
  onSelectConversation,
  onLoadMore,
  hasMore,
  isLoadingMore,
  isSelectionMode,
  selectedIds,
  onToggleSelectionMode,
  onToggleSelectConversation,
  onDeleteConversation,
  onDeleteSelected,
  onDeleteAll,
  onCloseSidebar,
}: ConversationsListProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="p-3 border-b space-y-2">
        {onCloseSidebar && (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={onCloseSidebar}
              aria-label={t('common.close')}
              data-testid="button-close-conversations"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
        <Button 
          onClick={onNewChat}
          className="w-full justify-start gap-2"
          data-testid="button-new-chat"
        >
          <Plus className="h-4 w-4" />
          Nova Conversa
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant={isSelectionMode ? 'secondary' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={onToggleSelectionMode}
            data-testid="button-toggle-selection"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            {isSelectionMode ? 'Cancelar seleção' : 'Selecionar'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={onDeleteAll}
            data-testid="button-delete-all"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Excluir tudo
          </Button>
        </div>
        {isSelectionMode && (
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedIds.size === 0}
            onClick={onDeleteSelected}
            data-testid="button-delete-selected"
          >
            Excluir selecionadas ({selectedIds.size})
          </Button>
        )}
      </div>
      
      <ScrollArea className="flex-1 p-2">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-1"
        >
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          ) : conversations.length > 0 ? (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === conversationId}
                isSelectionMode={isSelectionMode}
                isSelected={selectedIds.has(conv.id)}
                onClick={() => onSelectConversation(conv.id)}
                onToggleSelect={() => onToggleSelectConversation(conv.id)}
                onDelete={() => onDeleteConversation(conv.id)}
              />
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma conversa</p>
            </div>
          )}
          {hasMore && (
            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                data-testid="button-load-more-conversations"
              >
                {isLoadingMore ? 'Carregando...' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </motion.div>
      </ScrollArea>
    </>
  );
}

export default function Chat() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const appVersion = __APP_VERSION__;
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamSteps, setStreamSteps] = useState<string[]>([]);
  // Desktop: sidebar aberta por padrão | Mobile: fechada por padrão
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  // Estado separado para drawer mobile
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const [trainingNamespaceId, setTrainingNamespaceId] = useState<string>('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingStarting, setIsRecordingStarting] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);
  const recordingUnmountedRef = useRef(false);
  const recordingSendModeRef = useRef<'review' | 'direct'>('review');
  const pendingMediaRef = useRef<MediaAttachment[]>([]);
  const inputRef = useRef('');
  const recordingStartingRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const pendingSendRef = useRef<{ content: string; mediaAttachments?: MediaAttachment[] } | null>(null);
  const lastMessagesSyncRef = useRef(0);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const resolveScrollViewport = useCallback(() => {
    const root = scrollAreaRef.current;
    if (!root) return null;
    return root.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
  }, []);

  const updateAutoScroll = useCallback(() => {
    const viewport = scrollViewportRef.current ?? resolveScrollViewport();
    if (!viewport) return;
    scrollViewportRef.current = viewport;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    autoScrollRef.current = distanceFromBottom <= 80;
  }, [resolveScrollViewport]);

  // Fechar drawer mobile ao mudar de conversa
  useEffect(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
    }
  }, [conversationId, isMobile]);

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    lastMessagesSyncRef.current = 0;
    autoScrollRef.current = true;
  }, [conversationId]);

  useEffect(() => {
    const viewport = resolveScrollViewport();
    if (!viewport) return;
    scrollViewportRef.current = viewport;
    updateAutoScroll();

    const handleScroll = () => updateAutoScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [resolveScrollViewport, updateAutoScroll]);

  const setRecordingStartingState = useCallback((value: boolean) => {
    recordingStartingRef.current = value;
    setIsRecordingStarting(value);
  }, []);

  useEffect(() => {
    return () => {
      recordingUnmountedRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        recordingCancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      }
    };
  }, []);

  const processSelectedFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;

    for (const file of files) {
      const mediaType = getMediaType(file.type);
      
      if (!mediaType) {
        frontendLogger.warn('Upload rejeitado: tipo não suportado', { 
          fileName: file.name, 
          mimeType: file.type 
        });
        toast({
          title: t('chat.upload.unsupportedType'),
          description: t('chat.upload.unsupportedTypeDesc', { type: file.type }),
          variant: 'destructive',
        });
        continue;
      }

      // BUG FIX 23/12/2025: Verificação defensiva garante que limit não seja undefined
      // Type narrowing após validação garante que mediaType é MediaType
      const limit = FILE_LIMITS[mediaType];
      if (!limit) {
        frontendLogger.error('Limite não definido para tipo de mídia', { 
          fileName: file.name, 
          mediaType 
        });
        toast({
          title: t('chat.upload.unsupportedType'),
          description: `Tipo de mídia não suportado: ${mediaType}`,
          variant: 'destructive',
        });
        continue;
      }
      if (file.size > limit) {
        frontendLogger.warn('Upload rejeitado: arquivo muito grande', { 
          fileName: file.name, 
          fileSize: file.size, 
          limit 
        });
        toast({
          title: t('chat.upload.fileTooLarge'),
          description: t('chat.upload.fileTooLargeDesc', { 
            size: formatFileSize(file.size), 
            limit: formatFileSize(limit) 
          }),
          variant: 'destructive',
        });
        continue;
      }

      const objectUrl = URL.createObjectURL(file);
      const mediaId = crypto.randomUUID();

      const newMedia: MediaAttachment = {
        id: mediaId,
        type: mediaType,
        url: objectUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: 'ready',
        file,
      };

      // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
      if (mediaType === 'audio') {
        const mediaElement = document.createElement('audio');
        mediaElement.src = objectUrl;
        mediaElement.onloadedmetadata = () => {
          setPendingMedia(prev => 
            prev.map(m => m.id === mediaId ? { ...m, duration: mediaElement.duration } : m)
          );
        };
      }

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
  }, [t, toast]);

  const handleFileSelect = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;
    await processSelectedFiles(files);
  }, [processSelectedFiles]);

  const resolveRecordingMimeType = useCallback(() => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
    ];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
  }, []);

  const resolveRecordingExtension = useCallback((mimeType: string) => {
    const normalized = mimeType.split(';')[0].toLowerCase();
    switch (normalized) {
      case 'audio/ogg':
        return 'ogg';
      case 'audio/wav':
        return 'wav';
      case 'audio/mpeg':
        return 'mp3';
      case 'audio/mp4':
        return 'm4a';
      default:
        return 'webm';
    }
  }, []);

  const pollMediaTranscription = useCallback(async (uploadId: string, attemptsLeft = 30) => {
    if (recordingUnmountedRef.current) {
      return;
    }
    if (!pendingMediaRef.current.some((media) => media.uploadId === uploadId)) {
      return;
    }
    try {
      const res = await apiRequest('GET', `/api/media/${uploadId}`);
      if (!res.ok) {
        throw new Error('Falha ao buscar status do áudio');
      }
      const data = await res.json() as {
        processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
        transcription?: string | null;
        fileUrl?: string | null;
      };
      const status = data.processingStatus ?? 'processing';

      if (!pendingMediaRef.current.some((media) => media.uploadId === uploadId)) {
        return;
      }
      setPendingMedia((prev) => prev.map((media) => {
        if (media.uploadId !== uploadId) return media;
        const resolvedStatus: MediaAttachment['status'] =
          status === 'completed'
            ? 'ready'
            : status === 'failed'
              ? 'error'
              : 'processing';
        return {
          ...media,
          status: resolvedStatus,
          transcription: data.transcription ?? media.transcription,
          url: data.fileUrl ?? media.url,
        };
      }));

      if (status === 'completed') {
        if (!pendingMediaRef.current.some((media) => media.uploadId === uploadId)) {
          return;
        }
        const transcriptionText = data.transcription?.trim();
        if (transcriptionText) {
          setInput((prev) => {
            const base = prev.trim();
            return base.length > 0 ? `${base}\n${transcriptionText}` : transcriptionText;
          });
        }
        return;
      }

      if (status === 'failed') {
        if (!pendingMediaRef.current.some((media) => media.uploadId === uploadId)) {
          return;
        }
        toast({
          title: t('chat.recordingTranscriptionFailed'),
          description: t('chat.recordingTranscriptionFailedDesc'),
          variant: 'destructive',
        });
        return;
      }
    } catch (error) {
      frontendLogger.error('Falha ao consultar transcrição do áudio', { error, uploadId });
    }

    if (
      attemptsLeft > 0
      && !recordingUnmountedRef.current
      && pendingMediaRef.current.some((media) => media.uploadId === uploadId)
    ) {
      setTimeout(() => {
        void pollMediaTranscription(uploadId, attemptsLeft - 1);
      }, 2000);
    }
  }, [t, toast]);

  const uploadAudioForReview = useCallback(async (file: File) => {
    const base64 = await fileToBase64(file);
    const resolvedMimeType = file.type || resolveRecordingMimeType() || 'audio/webm';
    const response = await apiRequest('POST', '/api/media/upload/json', {
      file: base64,
      filename: file.name,
      mimeType: resolvedMimeType,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Falha ao enviar áudio para transcrição');
    }

    const result = await response.json() as {
      uploadId: string;
      fileUrl: string;
      processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
    };

    const mediaId = crypto.randomUUID();
    setPendingMedia((prev) => [
      ...prev,
      {
        id: mediaId,
        type: 'audio',
        url: result.fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: result.processingStatus === 'completed' ? 'ready' : 'processing',
        uploadId: result.uploadId,
      },
    ]);

    void pollMediaTranscription(result.uploadId);
  }, [pollMediaTranscription, resolveRecordingMimeType]);

  const revokeMediaUrl = useCallback((media?: MediaAttachment) => {
    if (!media?.url) return;
    if (media.url.startsWith('blob:')) {
      URL.revokeObjectURL(media.url);
    }
  }, []);

  const removePendingMedia = useCallback((mediaId: string) => {
    setPendingMedia(prev => {
      const media = prev.find(m => m.id === mediaId);
      if (media) {
        revokeMediaUrl(media);
        if (media.uploadId) {
          apiRequest('DELETE', `/api/media/uploads/${media.uploadId}`).catch((error) => {
            frontendLogger.warn('Falha ao remover upload de mídia', { error, uploadId: media.uploadId });
          });
        }
      }
      return prev.filter(m => m.id !== mediaId);
    });
  }, []);

  const clearPendingMedia = useCallback((options?: { revokeBlobUrls?: boolean }) => {
    if (options?.revokeBlobUrls !== false) {
      pendingMedia.forEach((media) => revokeMediaUrl(media));
    }
    setPendingMedia([]);
  }, [pendingMedia, revokeMediaUrl]);

  const fetchConversations = useCallback(async ({ pageParam }: { pageParam?: { updatedAt: string; id: string } }) => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (pageParam?.updatedAt && pageParam?.id) {
      params.set('cursorUpdatedAt', pageParam.updatedAt);
      params.set('cursorId', pageParam.id);
    }
    const res = await apiRequest('GET', `/api/chat/conversations?${params.toString()}`);
    return res.json() as Promise<ConversationsResponse>;
  }, []);

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['/api/chat/conversations'],
    queryFn: fetchConversations,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 60,
  });

  const fetchConversationMessages = useCallback(async () => {
    if (!conversationId) {
      throw new Error('ConversationId ausente para carregamento de mensagens');
    }
    const res = await apiRequest('GET', `/api/chat/conversations/${conversationId}/messages`);
    return res.json() as Promise<{ messages: Message[] }>;
  }, [conversationId]);

  const {
    data: conversationMessages,
    dataUpdatedAt: conversationMessagesUpdatedAt,
    isFetching: isFetchingConversationMessages,
  } = useQuery<{ messages: Message[] }>({
    queryKey: ['/api/chat/conversations', conversationId, 'messages'],
    queryFn: fetchConversationMessages,
    enabled: !!conversationId,
  });

  const { data: approvalPolicyData } = useQuery<{ approvalPolicy: ApprovalPolicy; allowWebSearchWithoutApproval: boolean }>({
    queryKey: ['/api/chat/conversations', conversationId, 'approval-policy'],
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('ConversationId ausente');
      }
      const res = await apiRequest('GET', `/api/chat/conversations/${conversationId}/approval-policy`);
      return res.json() as Promise<{ approvalPolicy: ApprovalPolicy; allowWebSearchWithoutApproval: boolean }>;
    },
    enabled: !!conversationId,
  });
  const { data: versionData } = useQuery<{ version: string | null }>({
    queryKey: ['/api/chat/version'],
    staleTime: 1000 * 60 * 5,
  });
  const resolvedVersion = versionData?.version || appVersion;
  const modelBadgeLabel = resolvedVersion ? `Alice ${resolvedVersion} 7B` : 'Alice 7B';
  const approvalPolicy: ApprovalPolicy = approvalPolicyData?.approvalPolicy ?? 'confirm_risky';
  const approvalPolicyOptions = [
    { value: 'always_confirm', label: t('chat.approvalPolicy.alwaysConfirm') },
    { value: 'confirm_risky', label: t('chat.approvalPolicy.confirmRisky') },
    { value: 'never_confirm', label: t('chat.approvalPolicy.neverConfirm') },
  ] as const;

  const { data: namespaces } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/chat/conversations', { titulo: 'Nova Conversa' });
      return res.json() as Promise<{ conversation: Conversation }>;
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
    },
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/chat/conversations/${id}`);
    },
    onSuccess: (_, id) => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      if (conversationId === id) {
        setMessages([]);
        navigate('/chat');
      }
    },
  });

  const updateApprovalPolicy = useMutation({
    mutationFn: async (policy: ApprovalPolicy) => {
      if (!conversationId) {
        throw new Error('ConversationId ausente para atualização de política');
      }
      await apiRequest('PATCH', `/api/chat/conversations/${conversationId}/approval-policy`, {
        approvalPolicy: policy,
      });
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations', conversationId, 'approval-policy'] });
      toast({ title: t('chat.approvalPolicy.updated') });
    },
    onError: () => {
      toast({ title: t('chat.approvalPolicy.error'), variant: 'destructive' });
    },
  });

  const deleteConversationsBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest('POST', '/api/chat/conversations/bulk-delete', { ids });
    },
    onSuccess: (_, ids) => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      if (conversationId && ids.includes(conversationId)) {
        setMessages([]);
        navigate('/chat');
      }
    },
  });

  const deleteAllConversations = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/chat/conversations/delete-all');
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      setMessages([]);
      navigate('/chat');
    },
  });

  const mapAnexosToMediaAttachments = useCallback((anexos: Message['anexos']): MediaAttachment[] => {
    if (!anexos || anexos.length === 0) return [];
    return anexos.map((anexo) => ({
      id: anexo.id,
      type: anexo.type,
      url: anexo.url || '',
      fileName: anexo.filename,
      fileSize: anexo.size ?? 0,
      mimeType: anexo.mimeType,
      status: anexo.url ? 'ready' : 'processing',
      thumbnailUrl: anexo.thumbnailUrl,
      transcription: anexo.transcription,
      uploadId: anexo.uploadId,
      visionDescription: anexo.visionDescription,
      visionModel: anexo.visionModel,
    }));
  }, []);

  const normalizeServerMessage = useCallback((message: ServerMessage): Message => {
    const role = message.role ?? (message.isFromUser ? 'user' : 'assistant');
    const content = message.content ?? message.conteudo ?? '';
    const createdAt = message.createdAt ?? message.criadoEm ?? new Date().toISOString();
    const mediaAttachments = message.mediaAttachments && message.mediaAttachments.length > 0
      ? message.mediaAttachments
      : message.anexos && message.anexos.length > 0
        ? mapAnexosToMediaAttachments(message.anexos)
        : undefined;

    return {
      ...message,
      role,
      content,
      createdAt,
      mediaAttachments,
    } as Message;
  }, [mapAnexosToMediaAttachments]);

  useEffect(() => {
    if (isStreaming || isFetchingConversationMessages) return;
    if (!conversationMessages?.messages) return;
    if (conversationMessagesUpdatedAt <= lastMessagesSyncRef.current) return;

    setMessages(conversationMessages.messages.map((message) => normalizeServerMessage(message)));
    lastMessagesSyncRef.current = conversationMessagesUpdatedAt;
  }, [
    conversationMessages,
    conversationMessagesUpdatedAt,
    normalizeServerMessage,
    isFetchingConversationMessages,
    isStreaming,
  ]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, isStreaming]);

  const STREAM_NO_CHUNK_TIMEOUT_MS = 60000;
  const resolveStreamStatus = useCallback((stage?: string) => {
    switch (stage) {
      case 'routing':
        return t('chat.streaming.status.routing');
      case 'history':
        return t('chat.streaming.status.history');
      case 'prompt':
        return t('chat.streaming.status.prompt');
      case 'finalizing':
        return t('chat.streaming.status.finalizing');
      case 'rag_internal':
        return t('chat.streaming.status.ragInternal');
      case 'rag_web':
        return t('chat.streaming.status.ragWeb');
      case 'greeting':
        return t('chat.streaming.status.greeting');
      case 'reuse':
        return t('chat.streaming.status.reuse');
      case 'media':
        return t('chat.streaming.status.media');
      case 'llm':
        return t('chat.streaming.status.llm');
      case 'writing':
        return t('chat.streaming.status.writing');
      case 'preparing':
      default:
        return t('chat.streaming.status.preparing');
    }
  }, [t]);
  const pushStreamStep = useCallback((label: string) => {
    setStreamSteps((prev) => {
      if (prev.length === 0) return [label];
      const last = prev[prev.length - 1];
      if (last === label) return prev;
      return [...prev, label];
    });
  }, []);
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
      const preparingLabel = resolveStreamStatus('preparing');
      setStreamStatus(preparingLabel);
      setStreamSteps([preparingLabel]);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const created = await createConversation.mutateAsync();
        activeConversationId = created.conversation.id;
        navigate(`/chat/${activeConversationId}`);
      }

      stopRequestedRef.current = false;
      const controller = new AbortController();
      streamControllerRef.current = controller;
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const resetTimeout = () => {
        if (streamTimeoutId) clearTimeout(streamTimeoutId);
        streamTimeoutId = setTimeout(() => {
          controller.abort();
        }, STREAM_NO_CHUNK_TIMEOUT_MS);
      };
      const clearTimeoutSafe = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
          streamTimeoutId = null;
        }
      };

      const mediaPayload: StreamMediaAttachmentPayload[] | undefined = mediaAttachments?.length
        ? await Promise.all(
          mediaAttachments.map(async (media) => {
            if (media.uploadId) {
              return {
                id: media.id,
                filename: media.fileName,
                mimeType: media.mimeType,
                uploadId: media.uploadId,
                fileUrl: media.url,
                size: media.fileSize,
              };
            }
            return {
              id: media.id,
              filename: media.fileName,
              mimeType: media.mimeType,
              file: await mediaAttachmentToBase64(media),
            };
          })
        )
        : undefined;

      const payload = {
        conversationId: activeConversationId,
        ...(content.trim().length > 0 ? { message: content } : {}),
        ...(mediaPayload && mediaPayload.length > 0 ? { mediaAttachments: mediaPayload } : {}),
      };

      const res = await apiRequest('POST', '/api/chat/stream', payload, { signal: controller.signal });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      resetTimeout();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'conversation' && parsed.conversationId && !conversationId) {
                  navigate(`/chat/${parsed.conversationId}`);
                  queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
                  resetTimeout();
                }

                if (parsed.type === 'status') {
                  const label = resolveStreamStatus(parsed.stage);
                  setStreamStatus(label);
                  pushStreamStep(label);
                  resetTimeout();
                }

                if (parsed.type === 'sources') {
                  resetTimeout();
                }

                if (parsed.type === 'message_saved') {
                  resetTimeout();
                }

                if (parsed.type === 'generated_image') {
                  const serverMessage = (parsed.message && typeof parsed.message === 'object' ? parsed.message : {}) as {
                    id?: string;
                    conteudo?: string | null;
                    criadoEm?: string | null;
                    generatedImage?: Message['generatedImage'];
                  };
                  const normalizedMessage: Message = {
                    id: serverMessage.id || crypto.randomUUID(),
                    role: 'assistant',
                    content: serverMessage.conteudo || 'Imagem gerada com sucesso via OpenAI.',
                    createdAt: serverMessage.criadoEm || new Date().toISOString(),
                    generatedImage: serverMessage.generatedImage ?? parsed.generatedImage,
                  };
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], ...normalizedMessage };
                    } else {
                      newMessages.push(normalizedMessage);
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.type === 'media_uploaded' && Array.isArray(parsed.attachments)) {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastUserIndex = [...newMessages].reverse().findIndex((msg) => msg.role === 'user');
                    if (lastUserIndex >= 0) {
                      const targetIndex = newMessages.length - 1 - lastUserIndex;
                      const target = newMessages[targetIndex];
                      if (target?.mediaAttachments) {
                        const updated: MediaAttachment[] = target.mediaAttachments.map((media) => {
                          const serverAttachment = parsed.attachments.find((att: { id: string }) => att.id === media.id) as
                            | {
                                id: string;
                                url?: string;
                                thumbnailUrl?: string;
                                processingStatus?: string;
                                uploadId?: string;
                                transcription?: string;
                                visionDescription?: string;
                                visionModel?: string;
                              }
                            | undefined;
                          if (!serverAttachment) return media;
                          if (media.url && media.url.startsWith('blob:') && serverAttachment.url && serverAttachment.url !== media.url) {
                            URL.revokeObjectURL(media.url);
                          }
                          const resolvedStatus: MediaAttachment['status'] =
                            serverAttachment.processingStatus === 'completed'
                              ? 'ready'
                              : serverAttachment.processingStatus === 'failed' || serverAttachment.processingStatus === 'error'
                                ? 'error'
                                : serverAttachment.processingStatus === 'uploading'
                                  ? 'uploading'
                                  : 'processing';
                          return {
                            ...media,
                            url: serverAttachment.url ?? media.url,
                            thumbnailUrl: serverAttachment.thumbnailUrl ?? media.thumbnailUrl,
                            status: resolvedStatus,
                            uploadId: serverAttachment.uploadId ?? media.uploadId,
                            transcription: serverAttachment.transcription ?? media.transcription,
                            visionDescription: serverAttachment.visionDescription ?? media.visionDescription,
                            visionModel: serverAttachment.visionModel ?? media.visionModel,
                          };
                        });
                        newMessages[targetIndex] = { ...target, mediaAttachments: updated };
                      }
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.error) {
                  const errorMessage = typeof parsed.error === 'string' ? parsed.error : t('chat.streaming.error');
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = {
                        ...newMessages[lastIdx],
                        content: errorMessage,
                      };
                    } else {
                      newMessages.push({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: errorMessage,
                        createdAt: new Date().toISOString(),
                      });
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.content) {
                  fullContent += parsed.content;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], content: fullContent };
                    }
                    return newMessages;
                  });
                  setStreamStatus(resolveStreamStatus('writing'));
                  pushStreamStep(resolveStreamStatus('writing'));
                  resetTimeout();
                }
              } catch {
                // Ignorar erros de parse
              }
            }
          }
        }
      } finally {
        clearTimeoutSafe();
        streamControllerRef.current = null;
      }

      setIsStreaming(false);
      setStreamStatus(null);
      setStreamSteps([]);
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      return fullContent;
    },
    onError: (error) => {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort && stopRequestedRef.current) {
        stopRequestedRef.current = false;
        setIsStreaming(false);
        setStreamStatus(null);
        setStreamSteps([]);
        return;
      }
      const errorMessage = isAbort ? t('chat.streaming.timeout') : t('chat.streaming.error');
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
          newMessages[lastIdx] = { ...newMessages[lastIdx], content: errorMessage };
        } else {
          newMessages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: errorMessage,
            createdAt: new Date().toISOString(),
          });
        }
        return newMessages;
      });
      setIsStreaming(false);
      setStreamStatus(null);
      setStreamSteps([]);
    },
  });

  useEffect(() => {
    if (isStreaming || !pendingSendRef.current) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    sendMessage.mutate(pending);
  }, [isStreaming, sendMessage]);

  const sendRecordingDirect = useCallback((file: File) => {
    const mediaId = crypto.randomUUID();
    const objectUrl = URL.createObjectURL(file);
    const resolvedMimeType = file.type || resolveRecordingMimeType() || 'audio/webm';
    const attachment: MediaAttachment = {
      id: mediaId,
      type: 'audio',
      url: objectUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: resolvedMimeType,
      status: 'ready',
      file,
    };

    const currentPending = pendingMediaRef.current;
    const combined = currentPending.length > 0 ? [...currentPending, attachment] : [attachment];
    sendMessage.mutate({
      content: inputRef.current.trim(),
      mediaAttachments: combined,
    });
    setInput('');
    clearPendingMedia({ revokeBlobUrls: false });
  }, [clearPendingMedia, resolveRecordingMimeType, sendMessage]);

  const finalizeRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const stream = recordingStreamRef.current;
    const cancelled = recordingCancelledRef.current;
    const unmounted = recordingUnmountedRef.current;
    recordingCancelledRef.current = false;

    const mimeType = recorder?.mimeType || 'audio/webm';
    const chunks = recordingChunksRef.current;
    recordingChunksRef.current = [];

    stream?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;

    if (!unmounted) {
      setIsRecording(false);
    }

    if (cancelled || unmounted || chunks.length === 0) {
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      return;
    }

    const extension = resolveRecordingExtension(mimeType);
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `gravacao-${safeTimestamp}.${extension}`;
    const file = new File([blob], fileName, { type: mimeType });

    if (recordingSendModeRef.current === 'direct') {
      sendRecordingDirect(file);
    } else {
      try {
        await uploadAudioForReview(file);
      } catch (error) {
        frontendLogger.error('Falha ao preparar áudio para revisão', { error });
        toast({
          title: t('chat.recordingUploadFailed'),
          description: t('chat.recordingUploadFailedDesc'),
          variant: 'destructive',
        });
      }
    }

    recordingSendModeRef.current = 'review';
  }, [resolveRecordingExtension, sendRecordingDirect, t, toast, uploadAudioForReview]);

  const handleStartRecording = useCallback(async () => {
    if (isStreaming || isRecording || recordingStartingRef.current) {
      return;
    }
    setRecordingStartingState(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingStartingState(false);
      toast({
        title: t('chat.recordingUnsupported'),
        description: t('chat.recordingUnsupportedDesc'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingUnmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingStartingState(false);
        return;
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      const mimeType = resolveRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        frontendLogger.error('Falha ao gravar áudio', { error: event });
        setRecordingStartingState(false);
        recordingCancelledRef.current = true;
        recorder.stop();
      };

      recorder.onstop = () => {
        void finalizeRecording();
      };

      recorder.start();
      setIsRecording(true);
      setRecordingStartingState(false);
    } catch (error) {
      frontendLogger.error('Permissão negada ou erro ao iniciar gravação', { error });
      setRecordingStartingState(false);
      toast({
        title: t('chat.recordingPermissionDenied'),
        description: t('chat.recordingPermissionDeniedDesc'),
        variant: 'destructive',
      });
    }
  }, [finalizeRecording, isRecording, isStreaming, resolveRecordingMimeType, setRecordingStartingState, t, toast]);

  const handleStopRecordingReview = useCallback(() => {
    if (!isRecording) return;
    recordingSendModeRef.current = 'review';
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else if (!recordingUnmountedRef.current) {
      setIsRecording(false);
    }
  }, [isRecording]);

  const handleSendRecordingNow = useCallback(() => {
    if (!isRecording || isStreaming) return;
    recordingSendModeRef.current = 'direct';
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else if (!recordingUnmountedRef.current) {
      setIsRecording(false);
    }
  }, [isRecording, isStreaming]);

  const sendConversationToTraining = useMutation({
    mutationFn: async () => {
      if (!conversationId) {
        throw new Error('Conversa não identificada');
      }
      if (!trainingNamespaceId) {
        throw new Error('Namespace obrigatório');
      }
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/training/collect`, {
        namespaceId: trainingNamespaceId,
      });
      return res.json() as Promise<{ success: boolean; messages: number }>;
    },
    onSuccess: () => {
      setShowTrainingDialog(false);
      toast({ title: t('chat.training.sent') });
    },
    onError: () => {
      toast({ title: t('chat.training.error'), variant: 'destructive' });
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

  // GAP CRÍTICO #1: Handler para feedback de mensagens de texto
  // Alice MULTIMODAL: coleta feedback de texto, imagens, áudio, vídeo
  const rateMessage = useMutation({
    mutationFn: async ({ messageId, isPositive }: { messageId: string; isPositive: boolean }) => {
      // Converter ThumbsUp/ThumbsDown para rating (5 para positivo, 1 para negativo)
      const rating = isPositive ? 5 : 1;
      await apiRequest('POST', `/api/chat/messages/${messageId}/rate`, { 
        rating,
        isPositive,
      });
    },
    onSuccess: (_, { messageId, isPositive }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              metadata: {
                ...msg.metadata,
                rating: isPositive ? 5 : 1,
                feedback: isPositive ? 'positive' : 'negative',
              },
            };
          }
          return msg;
        })
      );
    },
  });

  const handleFeedback = useCallback((messageId: string, isPositive: boolean) => {
    rateMessage.mutate({ messageId, isPositive });
  }, [rateMessage]);

  // Handler para regenerar última resposta do assistente
  // Remove a última mensagem do assistente e reenvia a última mensagem do usuário
  const handleRegenerate = useCallback(() => {
    if (isStreaming || messages.length === 0) return;

    // Encontrar última mensagem do usuário (iterar de trás para frente)
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) return;

    // Remover todas as mensagens após a última mensagem do usuário (incluindo resposta do assistente)
    const messagesUpToUser = messages.slice(0, lastUserMessageIndex + 1);
    setMessages(messagesUpToUser);

    // Reenviar última mensagem do usuário
    const lastUserMessage = messages[lastUserMessageIndex];
    if (lastUserMessage) {
      sendMessage.mutate({
        content: lastUserMessage.content || '',
        mediaAttachments: lastUserMessage.mediaAttachments,
      });
    }
  }, [messages, isStreaming, sendMessage]);

  const handleStopStreaming = useCallback(() => {
    if (!streamControllerRef.current) return;
    stopRequestedRef.current = true;
    streamControllerRef.current.abort('user_stop');
  }, []);

  const handleSend = useCallback(() => {
    if ((!input.trim() && pendingMedia.length === 0) || isRecording) return;

    autoScrollRef.current = true;

    if (isStreaming) {
      pendingSendRef.current = {
        content: input.trim(),
        mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined,
      };
      handleStopStreaming();
      setInput('');
      clearPendingMedia({ revokeBlobUrls: false });
      return;
    }

    sendMessage.mutate({ 
      content: input.trim(), 
      mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined 
    });
    setInput('');
    clearPendingMedia({ revokeBlobUrls: false });
  }, [clearPendingMedia, handleStopStreaming, input, isRecording, isStreaming, pendingMedia, sendMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const conversations = conversationsData?.pages.flatMap((page) => page.conversations) || [];

  // Handler para nova conversa com fechamento de drawer mobile
  const handleNewChatWithClose = useCallback(() => {
    setMessages([]);
    navigate('/chat');
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile]);

  // Handler para selecionar conversa (fecha drawer mobile se aberto)
  const handleSelectConversation = useCallback((id: string) => {
    navigate(`/chat/${id}`);
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile]);

  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => !prev);
    setSelectedConversationIds(new Set());
  }, []);

  const handleToggleSelectConversation = useCallback((id: string) => {
    setSelectedConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleConfirmDeleteSelected = useCallback(() => {
    if (selectedConversationIds.size === 0) return;
    deleteConversationsBulk.mutate(Array.from(selectedConversationIds));
    setSelectedConversationIds(new Set());
    setIsSelectionMode(false);
    setDeleteSelectedOpen(false);
  }, [deleteConversationsBulk, selectedConversationIds]);

  const handleConfirmDeleteAll = useCallback(() => {
    deleteAllConversations.mutate();
    setSelectedConversationIds(new Set());
    setIsSelectionMode(false);
    setDeleteAllOpen(false);
  }, [deleteAllConversations]);

  const handleCloseConversationsSidebar = useCallback(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
    } else {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  return (
    <div className="flex h-full">
      {/* MOBILE: Drawer offcanvas para lista de conversas */}
      {isMobile && (
        <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
          <SheetContent side="left" className="w-[300px] p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Conversas</SheetTitle>
            </VisuallyHidden.Root>
            <div className="flex flex-col h-full bg-muted/30">
              <ConversationsList
                conversations={conversations}
                conversationId={conversationId}
                isLoading={conversationsLoading}
                onNewChat={handleNewChatWithClose}
                onSelectConversation={handleSelectConversation}
                onLoadMore={() => fetchNextPage()}
                hasMore={Boolean(hasNextPage)}
                isLoadingMore={isFetchingNextPage}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedConversationIds}
                onToggleSelectionMode={handleToggleSelectionMode}
                onToggleSelectConversation={handleToggleSelectConversation}
                onDeleteConversation={(id) => setDeleteTargetId(id)}
                onDeleteSelected={() => setDeleteSelectedOpen(true)}
                onDeleteAll={() => setDeleteAllOpen(true)}
                onCloseSidebar={handleCloseConversationsSidebar}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* DESKTOP: Sidebar fixa */}
      {!isMobile && (
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              variants={sidebarVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-64 border-r bg-muted/30 flex flex-col"
            >
              <ConversationsList
                conversations={conversations}
                conversationId={conversationId}
                isLoading={conversationsLoading}
                onNewChat={handleNewChatWithClose}
                onSelectConversation={handleSelectConversation}
                onLoadMore={() => fetchNextPage()}
                hasMore={Boolean(hasNextPage)}
                isLoadingMore={isFetchingNextPage}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedConversationIds}
                onToggleSelectionMode={handleToggleSelectionMode}
                onToggleSelectConversation={handleToggleSelectConversation}
                onDeleteConversation={(id) => setDeleteTargetId(id)}
                onDeleteSelected={() => setDeleteSelectedOpen(true)}
                onDeleteAll={() => setDeleteAllOpen(true)}
                onCloseSidebar={handleCloseConversationsSidebar}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header responsivo */}
        <div className="flex items-center justify-between gap-2 p-2 md:p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-top">
          <div className="flex items-center gap-2">
            {/* MOBILE: Botão de menu hamburger */}
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileDrawerOpen(true)}
                className="h-9 w-9"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : (
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
            )}
            <h1 className="text-base md:text-lg font-semibold truncate" data-testid="text-chat-title">
              {conversationId ? 'Conversa' : 'Nova Conversa'}
            </h1>
          </div>
          
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="hidden md:flex gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              {modelBadgeLabel}
            </Badge>
            {conversationId && (
              <div className="hidden md:flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">
                  {t('chat.approvalPolicy.label')}
                </Label>
                <Select
                  value={approvalPolicy}
                  onValueChange={(value) => updateApprovalPolicy.mutate(value as ApprovalPolicy)}
                >
                  <SelectTrigger className="h-8 w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {approvalPolicyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {conversationId && (
              <Button
                variant="outline"
                size="sm"
                className="hidden md:flex"
                onClick={() => setShowTrainingDialog(true)}
                data-testid="button-send-to-training"
              >
                <FileCheck className="h-4 w-4 mr-2" />
                {t('chat.training.send')}
              </Button>
            )}
            {/* Mobile: Badge compacto */}
            {isMobile && (
              <>
                <Badge variant="secondary" className="h-6 px-2 text-[10px] gap-1">
                  <Sparkles className="h-3 w-3" />
                  {modelBadgeLabel}
                </Badge>
                {conversationId && (
                  <Select
                    value={approvalPolicy}
                    onValueChange={(value) => updateApprovalPolicy.mutate(value as ApprovalPolicy)}
                  >
                    <SelectTrigger className="h-6 w-[120px] text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {approvalPolicyOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {conversationId && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowTrainingDialog(true)}
                    data-testid="button-send-to-training-mobile"
                  >
                    <FileCheck className="h-3 w-3" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Área de mensagens - responsiva */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 p-2 md:p-4">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              <WelcomeScreen />
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-3 md:space-y-4 max-w-4xl mx-auto"
              >
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming}
                    isLast={index === messages.length - 1}
                    streamStatus={isStreaming && index === messages.length - 1 ? streamStatus : null}
                    streamSteps={isStreaming && index === messages.length - 1 ? streamSteps : null}
                    onRateImage={handleRateImage}
                    onFeedback={handleFeedback}
                    onRegenerate={handleRegenerate}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Input de chat - otimizado para mobile com safe area */}
        <motion.form 
          onSubmit={handleSubmit} 
          className="p-2 md:p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-bottom"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onFilesSelected={handleFileSelect}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecordingReview}
            onSendRecording={handleSendRecordingNow}
            onStopStreaming={handleStopStreaming}
            onRemoveMedia={removePendingMedia}
            pendingMedia={pendingMedia}
            isStreaming={isStreaming}
            isRecording={isRecording}
            isRecordingDisabled={isStreaming || isRecording || isRecordingStarting}
            isMobile={isMobile}
            acceptedTypes={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio].join(',')}
          />
        </motion.form>

        <Dialog open={showTrainingDialog} onOpenChange={setShowTrainingDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('chat.training.title')}</DialogTitle>
              <DialogDescription>{t('chat.training.desc')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>{t('chat.training.namespace')}</Label>
                <Select value={trainingNamespaceId} onValueChange={setTrainingNamespaceId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('chat.training.selectNamespace')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(namespaces || []).map((namespace) => (
                      <SelectItem key={namespace.id} value={namespace.id}>
                        {namespace.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>{t('chat.training.noticeTitle')}</AlertTitle>
                <AlertDescription>{t('chat.training.noticeDesc')}</AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowTrainingDialog(false)}>
                {t('chat.training.cancel')}
              </Button>
              <Button
                onClick={() => sendConversationToTraining.mutate()}
                disabled={!trainingNamespaceId || sendConversationToTraining.isPending}
              >
                {sendConversationToTraining.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('chat.training.sending')}
                  </>
                ) : (
                  <>
                    <FileCheck className="h-4 w-4 mr-2" />
                    {t('chat.training.confirm')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={Boolean(deleteTargetId)} onOpenChange={(open) => setDeleteTargetId(open ? deleteTargetId : null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove a conversa e todas as mensagens associadas. Deseja continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteTargetId) {
                    deleteConversation.mutate(deleteTargetId);
                  }
                  setDeleteTargetId(null);
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={deleteSelectedOpen} onOpenChange={setDeleteSelectedOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir conversas selecionadas</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove {selectedConversationIds.size} conversas e todas as mensagens associadas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDeleteSelected}>
                Excluir selecionadas
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir todas as conversas</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove todas as conversas e mensagens associadas. Esta operação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDeleteAll}>
                Excluir tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

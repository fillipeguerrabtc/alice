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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
  MoreHorizontal,
  Info,
  Send,
  AlertTriangle,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';
import { MultiSelectDropdown } from '@/components/trading';

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

/**
 * Normaliza a rota do pathname removendo IDs dinâmicos (UUIDs, slugs numéricos, etc.)
 * para que o contexto enviado ao backend seja estável e sem dados de usuário.
 * Exemplos: /chat/uuid-aqui => /chat, /conversations/123 => /chat, /trading/XBTUSDTM => /trading
 */
const ROUTE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_NUMERIC_ID_PATTERN = /^\d+$/;
const ROUTE_HEX_HASH_PATTERN = /^[0-9a-f]{24,}$/i;

function normalizeRouteForContext(pathname: string): string {
  if (!pathname) return '/chat';
  const base = pathname.split('?')[0].split('#')[0];
  // Mapear prefixos de conversa para /chat
  if (/^\/chat(\/|$)/.test(base) || /^\/conversations(\/|$)/.test(base)) return '/chat';
  if (/^\/trading(\/|$)/.test(base)) return '/trading';
  if (/^\/demo-trading(\/|$)/.test(base)) return '/demo-trading';
  // Caso genérico: remover segmentos que pareçam IDs (UUIDs, números puros, hashes hex longas)
  const segments = base.split('/').filter(Boolean);
  const filtered = segments.filter(
    (seg) => !ROUTE_UUID_PATTERN.test(seg) &&
             !ROUTE_NUMERIC_ID_PATTERN.test(seg) &&
             !ROUTE_HEX_HASH_PATTERN.test(seg)
  );
  return filtered.length > 0 ? `/${filtered.join('/')}` : '/chat';
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
  AgentEvent,
} from './components/types';

type AgentSummary = {
  id: string;
  nome: string;
  slug?: string | null;
  status?: string | null;
};

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
import { useAuth } from '@/hooks/use-auth';

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

type AssistantSettingsPreview = {
  settings?: {
    typingSpeedMs?: number | null;
  } | null;
  defaults: {
    typingSpeedMs: number;
  };
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

const OPENAI_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
]);

type RecordingPreparationErrorCode = 'conversion' | 'size';

class RecordingPreparationError extends Error {
  public readonly code: RecordingPreparationErrorCode;

  constructor(code: RecordingPreparationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function getRecordingExtensionFromMime(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
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
}

function shouldConvertRecordingToWav(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.length > 0 && !OPENAI_SUPPORTED_AUDIO_MIME_TYPES.has(normalized);
}

function encodeWavFromAudioBuffer(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;
  const wavBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(wavBuffer);

  let offset = 0;
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, totalLength - 8, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataLength, true);
  offset += 4;

  const channels = Array.from({ length: numChannels }, (_, index) => buffer.getChannelData(index));
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return wavBuffer;
}

async function convertRecordingToWav(blob: Blob): Promise<Blob> {
  const AudioContextRef = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextRef) {
    throw new RecordingPreparationError('conversion', 'AudioContext não disponível para conversão');
  }

  const audioContext = new AudioContextRef();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const wavBuffer = encodeWavFromAudioBuffer(decoded);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch {
    throw new RecordingPreparationError('conversion', 'Falha ao converter áudio para WAV');
  } finally {
    await audioContext.close().catch(() => null);
  }
}

async function prepareRecordingFile(
  blob: Blob,
  mimeType: string,
  timestamp: string,
  maxSizeBytes: number
): Promise<File> {
  if (!shouldConvertRecordingToWav(mimeType)) {
    const extension = getRecordingExtensionFromMime(mimeType);
    const fileName = `gravacao-${timestamp}.${extension}`;
    return new File([blob], fileName, { type: mimeType });
  }

  const wavBlob = await convertRecordingToWav(blob);
  if (wavBlob.size > maxSizeBytes) {
    throw new RecordingPreparationError(
      'size',
      'Arquivo de áudio excede o limite após conversão para WAV'
    );
  }

  const fileName = `gravacao-${timestamp}.wav`;
  return new File([wavBlob], fileName, { type: 'audio/wav' });
}

async function mediaAttachmentToBase64(media: MediaAttachment): Promise<string> {
  if (media.file) {
    return fileToBase64(media.file);
  }
  if (media.uploadId) {
    const uploadResponse = await apiRequest('GET', `/api/media/uploads/${media.uploadId}`);
    if (!uploadResponse.ok) {
      throw new Error('Falha ao obter informações do upload de mídia');
    }
    const data = await uploadResponse.json() as { upload?: { fileUrl?: string | null } };
    const resolvedUrl = data.upload?.fileUrl;
    if (resolvedUrl) {
      const fileResponse = await fetch(resolvedUrl, { credentials: 'include' });
      if (!fileResponse.ok) {
        throw new Error('Falha ao baixar arquivo de mídia');
      }
      const blob = await fileResponse.blob();
      const file = new File([blob], media.fileName, { type: media.mimeType });
      return fileToBase64(file);
    }
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
  filterLabel?: string;
  onClearFilter?: () => void;
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
  filterLabel,
  onClearFilter,
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
        {filterLabel && onClearFilter && (
          <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
            <span className="text-muted-foreground">
              {t('chat.filters.activeLabel')}: {filterLabel}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilter}
              data-testid="button-clear-conversation-filter"
            >
              {t('chat.filters.clear')}
            </Button>
          </div>
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
  const { user: currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [location, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const appVersion = __APP_VERSION__;
  const showLoginBanner = !authLoading && !isAuthenticated;
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AgentEvent[]>([]);
  const [focusNonce, setFocusNonce] = useState(0);
  // Desktop: sidebar aberta por padrão | Mobile: fechada por padrão
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  // Estado separado para drawer mobile
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const [trainingDialogMode, setTrainingDialogMode] = useState<'conversation' | 'messages' | null>(null);
  const [trainingNamespaceId, setTrainingNamespaceId] = useState<string>('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingStarting, setIsRecordingStarting] = useState(false);
  const [isTranscribingRecording, setIsTranscribingRecording] = useState(false);
  const [lastResponseUsedFallback, setLastResponseUsedFallback] = useState(false);
  const lastSelectedMessageIndex = useRef<number | null>(null);

  const conversationFilter = useMemo(() => {
    const search = location.includes('?') ? location.split('?')[1] ?? '' : '';
    const params = new URLSearchParams(search);
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    return {
      from,
      to,
      isActive: Boolean(from || to),
    };
  }, [location]);

  const conversationFilterLabel = useMemo(() => {
    if (!conversationFilter.isActive) {
      return undefined;
    }
    if (conversationFilter.from && conversationFilter.to) {
      return t('chat.filters.dateRange', {
        from: conversationFilter.from,
        to: conversationFilter.to,
      });
    }
    if (conversationFilter.from) {
      return t('chat.filters.fromOnly', { from: conversationFilter.from });
    }
    return t('chat.filters.toOnly', { to: conversationFilter.to });
  }, [conversationFilter, t]);

  const clearConversationFilter = useCallback(() => {
    navigate('/chat');
  }, [navigate]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
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
    setSelectedMessageIds(new Set());
    setMessageSelectionMode(false);
    lastSelectedMessageIndex.current = null;
  }, [conversationId]);

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

  const waitForRecordingTranscription = useCallback(async (uploadId: string, attemptsLeft = 30) => {
    for (let attempt = 0; attempt < attemptsLeft; attempt += 1) {
      if (recordingUnmountedRef.current) {
        throw new Error('Transcrição cancelada');
      }
      const res = await apiRequest('GET', `/api/media/${uploadId}`);
      if (!res.ok) {
        throw new Error('Falha ao buscar status do áudio');
      }
      const data = await res.json() as {
        processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
        transcription?: string | null;
      };
      const status = data.processingStatus ?? 'processing';
      const transcriptionText = data.transcription?.trim() ?? '';
      const hasErrorMarker = transcriptionText.startsWith('[Transcrição não disponível');

      if (status === 'completed') {
        if (transcriptionText && !hasErrorMarker) {
          return transcriptionText;
        }
        if (hasErrorMarker) {
          throw new Error('Falha ao transcrever o áudio');
        }
        throw new Error('Transcrição vazia retornada pelo servidor');
      }
      if (status === 'failed' || hasErrorMarker) {
        throw new Error('Falha ao transcrever o áudio');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Timeout ao aguardar transcrição do áudio');
  }, []);

  const transcribeRecordingAudio = useCallback(async (file: File) => {
    const base64 = await fileToBase64(file);
    const resolvedMimeType = file.type || resolveRecordingMimeType() || 'audio/webm';
    const response = await apiRequest('POST', '/api/media/upload/json', {
      file: base64,
      filename: file.name,
      mimeType: resolvedMimeType,
      conversationId: conversationId ?? undefined,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Falha ao enviar áudio para transcrição');
    }

    const result = await response.json() as {
      uploadId: string;
      processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
      transcription?: string | null;
    };
    if (result.processingStatus === 'completed' && result.transcription?.trim()) {
      return result.transcription.trim();
    }
    return waitForRecordingTranscription(result.uploadId);
  }, [conversationId, resolveRecordingMimeType, waitForRecordingTranscription]);

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
    if (conversationFilter.from) {
      params.set('from', conversationFilter.from);
    }
    if (conversationFilter.to) {
      params.set('to', conversationFilter.to);
    }
    const res = await apiRequest('GET', `/api/chat/conversations?${params.toString()}`);
    return res.json() as Promise<ConversationsResponse>;
  }, [conversationFilter]);

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['/api/chat/conversations', conversationFilter.from ?? null, conversationFilter.to ?? null],
    queryFn: fetchConversations,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 60,
  });

  const conversations = conversationsData?.pages.flatMap((page) => page.conversations) || [];
  const activeConversation = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId) ?? null
    : null;

  const fetchConversationMessages = useCallback(async () => {
    if (!conversationId) {
      throw new Error('ConversationId ausente para carregamento de mensagens');
    }
    const res = await apiRequest('GET', `/api/chat/conversations/${conversationId}/messages`);
    return res.json() as Promise<{ messages: Message[] }>;
  }, [conversationId]);

  const toggleMessageSelection = useCallback((messageId: string, index: number, shiftKey: boolean) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedMessageIndex.current !== null) {
        const start = Math.min(lastSelectedMessageIndex.current, index);
        const end = Math.max(lastSelectedMessageIndex.current, index);
        for (let i = start; i <= end; i += 1) {
          const target = messages[i];
          if (target?.id && target.role !== 'system') {
            next.add(target.id);
          }
        }
      } else if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      lastSelectedMessageIndex.current = index;
      return next;
    });
  }, [messages]);

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
  const { data: assistantSettingsData } = useQuery<AssistantSettingsPreview>({
    queryKey: ['/api/assistant-settings'],
    staleTime: 1000 * 60,
  });
  const resolvedVersion = versionData?.version || appVersion;
  const modelBadgeLabel = resolvedVersion ? `Alice ${resolvedVersion} 7B` : 'Alice 7B';
  const approvalPolicy: ApprovalPolicy = approvalPolicyData?.approvalPolicy ?? 'always_confirm';
  const typingSpeedMs = assistantSettingsData?.settings?.typingSpeedMs ?? assistantSettingsData?.defaults?.typingSpeedMs;
  const approvalPolicyForSelect: ApprovalPolicy =
    approvalPolicy === 'confirm_risky' ? 'always_confirm' : approvalPolicy;
  const approvalPolicyOptions = [
    { value: 'always_confirm', label: t('chat.approvalPolicy.alwaysConfirm') },
    { value: 'never_confirm', label: t('chat.approvalPolicy.neverConfirm') },
  ] as const;

  const { data: namespaces } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const { data: agentsData } = useQuery<AgentSummary[]>({
    queryKey: ['/api/agents'],
    staleTime: 1000 * 60,
  });

  const [routingModeByConversation, setRoutingModeByConversation] = useState<Record<string, 'auto' | 'manual'>>({});
  const [routingAgentIdsByConversation, setRoutingAgentIdsByConversation] = useState<Record<string, string[]>>({});
  const routingKey = conversationId ?? 'new';
  const routingMode = routingModeByConversation[routingKey] ?? 'auto';
  const routingAgentIds = routingAgentIdsByConversation[routingKey] ?? [];

  const agentOptions = useMemo(() => {
    return (agentsData ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.nome}${agent.slug ? ` (@${agent.slug})` : ''}`,
    }));
  }, [agentsData]);

  useEffect(() => {
    if (!agentOptions.length) return;
    setRoutingAgentIdsByConversation((prev) => {
      const current = prev[routingKey] ?? [];
      const validIds = new Set(agentOptions.map((option) => option.value));
      const filtered = current.filter((id) => validIds.has(id));
      if (filtered.length === current.length) return prev;
      return { ...prev, [routingKey]: filtered };
    });
  }, [agentOptions, routingKey]);

  const createConversation = useMutation({
    mutationFn: async (payload?: { agentId?: string; namespaceId?: string; context?: 'trading' | 'sales' | 'support' | 'cambio' | 'default'; route?: string }) => {
      const body: Record<string, unknown> = { titulo: 'Nova Conversa' };
      if (payload?.agentId) body.agentId = payload.agentId;
      if (payload?.namespaceId) body.namespaceId = payload.namespaceId;
      if (payload?.context) body.context = payload.context;
      if (payload?.route) body.route = payload.route;
      const res = await apiRequest('POST', '/api/chat/conversations', body);
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

  const ensureRoutingSelection = useCallback(() => {
    if (routingMode === 'manual' && routingAgentIds.length === 0) {
      toast({ title: t('chat.routing.missingAgents'), variant: 'destructive' });
      return false;
    }
    return true;
  }, [routingAgentIds.length, routingMode, t, toast]);

  const normalizeServerMessage = useCallback((message: ServerMessage): Message => {
    const role = message.role ?? (message.isFromUser ? 'user' : 'assistant');
    const content = message.content ?? message.conteudo ?? '';
    const createdAt = message.createdAt ?? message.criadoEm ?? new Date().toISOString();
    const mediaAttachments = message.mediaAttachments && message.mediaAttachments.length > 0
      ? message.mediaAttachments
      : message.anexos && message.anexos.length > 0
        ? mapAnexosToMediaAttachments(message.anexos)
        : undefined;

    const fallbackUser = currentUser
      ? {
        id: currentUser.id,
        firstName: currentUser.firstName ?? null,
        lastName: currentUser.lastName ?? null,
        preferredName: currentUser.preferredName ?? null,
        email: currentUser.email ?? null,
        profileImageUrl: null,
      }
      : null;
    const fallbackAgent = activeConversation?.agent ?? null;

    return {
      ...message,
      role,
      content,
      createdAt,
      mediaAttachments,
      user: role === 'user' ? (message.user ?? fallbackUser) : message.user ?? null,
      agent: role === 'assistant' ? (message.agent ?? fallbackAgent) : message.agent ?? null,
    } as Message;
  }, [mapAnexosToMediaAttachments, currentUser, activeConversation]);

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    scrollToBottom(isStreaming ? 'auto' : 'smooth');
  }, [messages, isStreaming, scrollToBottom]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!autoScrollRef.current) return;
      scrollToBottom('auto');
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

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
  const pushStreamEvent = useCallback((event: AgentEvent) => {
    setStreamEvents((prev) => {
      const next = [...prev, event];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const createStatusEvent = useCallback((stage?: string, message?: string): AgentEvent => {
    const resolvedStage = stage?.trim() || 'preparing';
    return {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      phase: 'system',
      action: resolvedStage,
      status: 'in_progress',
      message: message ?? resolveStreamStatus(resolvedStage),
    };
  }, [resolveStreamStatus]);
  const sendMessage = useMutation({
    mutationFn: async ({ content, mediaAttachments }: { content: string; mediaAttachments?: MediaAttachment[] }) => {
      if (!isAuthenticated) {
        toast({ title: 'Faça login para continuar', description: 'O chat em tempo real está disponível apenas para usuários autenticados.' });
        return '';
      }
      if (!ensureRoutingSelection()) {
        return '';
      }
      const currentRoutingMode = routingMode;
      const currentRoutingAgentIds = routingAgentIds;
      const currentRoutingKey = routingKey;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        tipo: mediaAttachments && mediaAttachments.length > 0 ? 'mixed' : 'text',
        mediaAttachments,
        user: currentUser
          ? {
            id: currentUser.id,
            firstName: currentUser.firstName ?? null,
            lastName: currentUser.lastName ?? null,
            preferredName: currentUser.preferredName ?? null,
            email: currentUser.email ?? null,
            profileImageUrl: null,
          }
          : null,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamEvents([]);
      setLastResponseUsedFallback(false);
      pushStreamEvent(createStatusEvent('preparing'));

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        agent: activeConversation?.agent ?? null,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const pathname = (location as string) ?? '';
      const resolvedRoute = normalizeRouteForContext(pathname);
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const contextPayload: { agentId?: string; namespaceId?: string; context?: 'trading' | 'sales' | 'support' | 'cambio' | 'default'; route?: string } = {};
        if (currentRoutingMode === 'manual' && currentRoutingAgentIds.length === 1) {
          contextPayload.agentId = currentRoutingAgentIds[0];
        }
        if (resolvedRoute.startsWith('/trading') || resolvedRoute.startsWith('/demo-trading')) {
          contextPayload.context = 'trading';
          contextPayload.route = resolvedRoute;
        } else if (resolvedRoute.startsWith('/sales')) {
          contextPayload.context = 'sales';
          contextPayload.route = resolvedRoute;
        } else if (resolvedRoute.startsWith('/support')) {
          contextPayload.context = 'support';
          contextPayload.route = resolvedRoute;
        } else if (resolvedRoute.startsWith('/cambio')) {
          contextPayload.context = 'cambio';
          contextPayload.route = resolvedRoute;
        } else {
          contextPayload.route = resolvedRoute;
        }
        const created = await createConversation.mutateAsync(Object.keys(contextPayload).length > 0 ? contextPayload : undefined);
        const nextConversationId = created.conversation.id;
        activeConversationId = nextConversationId;
        navigate(`/chat/${nextConversationId}`);
        setRoutingModeByConversation((prev) => {
          const { [currentRoutingKey]: _removed, ...rest } = prev;
          return { ...rest, [nextConversationId]: currentRoutingMode };
        });
        setRoutingAgentIdsByConversation((prev) => {
          const { [currentRoutingKey]: _removed, ...rest } = prev;
          return { ...rest, [nextConversationId]: currentRoutingAgentIds };
        });
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
            if (media.type === 'audio' && media.uploadId) {
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

      const routeForContext = resolvedRoute;

      const payload = {
        conversationId: activeConversationId,
        ...(content.trim().length > 0 ? { message: content } : {}),
        ...(mediaPayload && mediaPayload.length > 0 ? { mediaAttachments: mediaPayload } : {}),
        route: routeForContext,
        approvalPolicy,
        agentRouting: {
          mode: currentRoutingMode,
          agentIds: currentRoutingMode === 'manual' ? currentRoutingAgentIds : [],
        },
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

          // Parser SSE correto: eventos separados por \n\n, normaliza CRLF
          const normalized = buffer.replace(/\r\n/g, '\n');
          const events = normalized.split('\n\n');
          // O último segmento pode estar incompleto; preservar no buffer
          buffer = events.pop() || '';

          for (const event of events) {
            // Concatenar múltiplas linhas "data:" do mesmo evento
            const dataLines: string[] = [];
            for (const line of event.split('\n')) {
              if (line.startsWith('data: ')) {
                dataLines.push(line.slice(6));
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5));
              }
            }
            if (dataLines.length === 0) continue;
            const data = dataLines.join('\n').trim();
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
                  pushStreamEvent(createStatusEvent(parsed.stage, label));
                  resetTimeout();
                }

                if (parsed.type === 'agent_event' && parsed.data) {
                  pushStreamEvent(parsed.data as AgentEvent);
                  resetTimeout();
                }

                if (parsed.type === 'llm_metadata' && parsed.usedFallback) {
                  setLastResponseUsedFallback(true);
                  resetTimeout();
                }

                if (parsed.type === 'agent_route' && parsed.agent) {
                  const normalizedAgent = parsed.agent as Message['agent'];
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], agent: normalizedAgent };
                    }
                    return newMessages;
                  });
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
                    content: serverMessage.conteudo ?? '',
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

                if (parsed.type === 'web_image_results' && parsed.message) {
                  const normalizedMessage = normalizeServerMessage(parsed.message as ServerMessage);
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
                  resetTimeout();
                }

                if (parsed.type === 'final_message' && typeof parsed.content === 'string') {
                  fullContent = parsed.content;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], content: fullContent };
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.type === 'action_result' && parsed.data && typeof parsed.data === 'object') {
                  // Injeta metadados de action_result na última mensagem assistant para ActionResultCard
                  const actionData = parsed.data as Record<string, unknown>;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = {
                        ...newMessages[lastIdx],
                        metadata: {
                          ...(newMessages[lastIdx].metadata as Record<string, unknown> ?? {}),
                          actionType: typeof actionData.actionType === 'string' ? actionData.actionType : undefined,
                          actionOperation: typeof actionData.actionOperation === 'string' ? actionData.actionOperation : undefined,
                          actionStatus: typeof actionData.status === 'string' ? actionData.status : undefined,
                          actionSummary: typeof actionData.summary === 'string' ? actionData.summary : undefined,
                          actionResult: actionData.result !== null && typeof actionData.result === 'object' ? actionData.result as Record<string, unknown> : undefined,
                        },
                      };
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }
              } catch {
                // Ignorar erros de parse
              }
          }
        }
      } finally {
        clearTimeoutSafe();
        streamControllerRef.current = null;
      }

      setIsStreaming(false);
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      return fullContent;
    },
    onError: (error) => {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort && stopRequestedRef.current) {
        stopRequestedRef.current = false;
        setIsStreaming(false);
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
    },
  });

  useEffect(() => {
    if (isStreaming || !pendingSendRef.current) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    sendMessage.mutate(pending);
  }, [isStreaming, sendMessage]);

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

    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let file: File;

    setIsTranscribingRecording(true);
    try {
      file = await prepareRecordingFile(blob, mimeType, safeTimestamp, FILE_LIMITS.audio);
      const transcription = await transcribeRecordingAudio(file);
      if (recordingUnmountedRef.current) return;
      if (recordingSendModeRef.current === 'direct') {
        const base = inputRef.current.trim();
        const content = base ? `${base}\n${transcription}` : transcription;
        const currentPending = pendingMediaRef.current;
        sendMessage.mutate({
          content,
          mediaAttachments: currentPending.length > 0 ? currentPending : undefined,
        });
        setInput('');
        clearPendingMedia({ revokeBlobUrls: false });
      } else {
        setInput((prev) => {
          const base = prev.trim();
          return base.length > 0 ? `${base}\n${transcription}` : transcription;
        });
      }
    } catch (error) {
      if (error instanceof RecordingPreparationError) {
        if (error.code === 'size') {
          toast({
            title: t('chat.recordingConversionTooLarge'),
            description: t('chat.recordingConversionTooLargeDesc'),
            variant: 'destructive',
          });
          return;
        }
        toast({
          title: t('chat.recordingConversionFailed'),
          description: t('chat.recordingConversionFailedDesc'),
          variant: 'destructive',
        });
        frontendLogger.error('Falha ao preparar áudio gravado', { error });
        return;
      }
      const logLabel = recordingSendModeRef.current === 'direct'
        ? 'Falha ao transcrever áudio para envio direto'
        : 'Falha ao transcrever áudio para revisão';
      frontendLogger.error(logLabel, { error });
      toast({
        title: t('chat.recordingTranscriptionFailed'),
        description: t('chat.recordingTranscriptionFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      if (!recordingUnmountedRef.current) {
        setIsTranscribingRecording(false);
      }
    }

    recordingSendModeRef.current = 'review';
  }, [clearPendingMedia, sendMessage, t, toast, transcribeRecordingAudio]);

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
      const payload = { namespaceId: trainingNamespaceId };
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/training/collect`, payload);
      return res.json() as Promise<{ success: boolean; messages: number }>;
    },
    onSuccess: () => {
      setShowTrainingDialog(false);
      setTrainingDialogMode(null);
      toast({ title: t('chat.training.sent') });
    },
    onError: () => {
      toast({ title: t('chat.training.error'), variant: 'destructive' });
    },
  });

  const sendSelectedMessagesToTraining = useMutation({
    mutationFn: async () => {
      if (!conversationId) {
        throw new Error('Conversa não identificada');
      }
      if (selectedMessageIds.size === 0) {
        throw new Error('Mensagens não selecionadas');
      }
      if (!trainingNamespaceId) {
        throw new Error('Namespace obrigatório');
      }
      const payload = {
        namespaceId: trainingNamespaceId,
        items: [
          {
            conversationId,
            messageIds: Array.from(selectedMessageIds),
          },
        ],
      };
      const res = await apiRequest('POST', '/api/chat/training/collect-batch', payload);
      return res.json() as Promise<{ success: boolean; processed: number; failures: Array<{ conversationId: string; error: string }> }>;
    },
    onSuccess: (result) => {
      setShowTrainingDialog(false);
      setTrainingDialogMode(null);
      if (result.failures?.length) {
        toast({ title: t('chat.training.partial'), variant: 'destructive' });
      } else {
        toast({ title: t('chat.training.sent') });
      }
      setSelectedMessageIds(new Set());
      setMessageSelectionMode(false);
    },
    onError: () => {
      toast({ title: t('chat.training.error'), variant: 'destructive' });
    },
  });

  const openConversationTrainingDialog = useCallback(() => {
    setTrainingNamespaceId('');
    setTrainingDialogMode('conversation');
    setShowTrainingDialog(true);
  }, []);

  const openMessageTrainingDialog = useCallback(() => {
    if (selectedMessageIds.size === 0) {
      toast({ title: t('chat.selection.empty'), variant: 'destructive' });
      return;
    }
    setTrainingNamespaceId('');
    setTrainingDialogMode('messages');
    setShowTrainingDialog(true);
  }, [selectedMessageIds, t, toast]);

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
    if (!isAuthenticated) {
      toast({ title: 'Faça login para continuar', description: 'O chat em tempo real está disponível apenas para usuários autenticados.' });
      return;
    }

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
  }, [messages, isStreaming, sendMessage, isAuthenticated, toast]);

  const handleStopStreaming = useCallback(() => {
    if (!streamControllerRef.current) return;
    stopRequestedRef.current = true;
    streamControllerRef.current.abort('user_stop');
  }, []);

  const handleSend = useCallback(() => {
    if ((!input.trim() && pendingMedia.length === 0) || isRecording) return;
    if (!isAuthenticated) {
      toast({ title: 'Faça login para continuar', description: 'O chat em tempo real está disponível apenas para usuários autenticados.' });
      return;
    }

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
  }, [clearPendingMedia, handleStopStreaming, input, isRecording, isStreaming, pendingMedia, sendMessage, isAuthenticated, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const bumpInputFocus = useCallback(() => {
    setFocusNonce((prev) => prev + 1);
  }, []);

  // Handler para nova conversa com fechamento de drawer mobile
  const handleNewChatWithClose = useCallback(() => {
    setMessages([]);
    navigate('/chat');
    bumpInputFocus();
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile, bumpInputFocus]);

  // Handler para selecionar conversa (fecha drawer mobile se aberto)
  const handleSelectConversation = useCallback((id: string) => {
    navigate(`/chat/${id}`);
    bumpInputFocus();
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile, bumpInputFocus]);

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

  useEffect(() => {
    bumpInputFocus();
  }, [conversationId, bumpInputFocus]);

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
                filterLabel={conversationFilterLabel}
                onClearFilter={conversationFilter.isActive ? clearConversationFilter : undefined}
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
                filterLabel={conversationFilterLabel}
                onClearFilter={conversationFilter.isActive ? clearConversationFilter : undefined}
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
            <div className="hidden md:flex items-center gap-2">
              {conversationId && (
                <>
                  <Label className="text-xs text-muted-foreground">
                    {t('chat.approvalPolicy.label')}
                  </Label>
                  <Select
                    value={approvalPolicyForSelect}
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
                </>
              )}
              <Label className="text-xs text-muted-foreground">
                {t('chat.routing.label')}
              </Label>
              <Select
                value={routingMode}
                onValueChange={(value) => setRoutingModeByConversation((prev) => ({ ...prev, [routingKey]: value as 'auto' | 'manual' }))}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('chat.routing.auto')}</SelectItem>
                  <SelectItem value="manual">{t('chat.routing.manual')}</SelectItem>
                </SelectContent>
              </Select>
              {routingMode === 'manual' && (
                <div className="min-w-[220px]">
                  <MultiSelectDropdown
                    label={t('chat.routing.agentsLabel')}
                    options={agentOptions}
                    selectedValues={routingAgentIds}
                    onChange={(next) => setRoutingAgentIdsByConversation((prev) => ({ ...prev, [routingKey]: next }))}
                    emptyLabel={t('chat.routing.noAgents')}
                    placeholder={t('chat.routing.selectAgents')}
                    selectedCountLabel={t('chat.routing.selectedCount')}
                    selectAllLabel={t('chat.routing.selectAll')}
                    clearLabel={t('chat.routing.clearSelection')}
                    disabled={agentOptions.length === 0}
                  />
                </div>
              )}
            </div>
            {conversationId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden md:flex h-8 w-8"
                    data-testid="button-chat-actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openConversationTrainingDialog}>
                    <FileCheck className="h-4 w-4 mr-2" />
                    {t('chat.training.send')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMessageSelectionMode((prev) => !prev)}>
                    <CheckSquare className="h-4 w-4 mr-2" />
                    {messageSelectionMode ? t('chat.selection.cancelSelection') : t('chat.selection.selectMessages')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={openMessageTrainingDialog}
                    disabled={selectedMessageIds.size === 0}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {t('chat.selection.sendSelected')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteTargetId(conversationId)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir conversa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                    value={approvalPolicyForSelect}
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
                <Select
                  value={routingMode}
                  onValueChange={(value) => setRoutingModeByConversation((prev) => ({ ...prev, [routingKey]: value as 'auto' | 'manual' }))}
                >
                  <SelectTrigger className="h-6 w-[110px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('chat.routing.auto')}</SelectItem>
                    <SelectItem value="manual">{t('chat.routing.manual')}</SelectItem>
                  </SelectContent>
                </Select>
                {routingMode === 'manual' && (
                  <div className="min-w-[180px]">
                    <MultiSelectDropdown
                      label={t('chat.routing.agentsLabel')}
                      options={agentOptions}
                      selectedValues={routingAgentIds}
                      onChange={(next) => setRoutingAgentIdsByConversation((prev) => ({ ...prev, [routingKey]: next }))}
                      emptyLabel={t('chat.routing.noAgents')}
                      placeholder={t('chat.routing.selectAgents')}
                      selectedCountLabel={t('chat.routing.selectedCount')}
                      selectAllLabel={t('chat.routing.selectAll')}
                      clearLabel={t('chat.routing.clearSelection')}
                      disabled={agentOptions.length === 0}
                    />
                  </div>
                )}
                {conversationId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        data-testid="button-chat-actions-mobile"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={openConversationTrainingDialog}>
                        <FileCheck className="h-4 w-4 mr-2" />
                        {t('chat.training.send')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMessageSelectionMode((prev) => !prev)}>
                        <CheckSquare className="h-4 w-4 mr-2" />
                        {messageSelectionMode ? t('chat.selection.cancelSelection') : t('chat.selection.selectMessages')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={openMessageTrainingDialog}
                        disabled={selectedMessageIds.size === 0}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {t('chat.selection.sendSelected')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteTargetId(conversationId)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir conversa
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Área de mensagens - responsiva */}
          <ScrollArea ref={scrollAreaRef} className="flex-1 p-2 md:p-4">
            <div ref={messagesContainerRef} className="min-h-full">
              {showLoginBanner && (
                <Alert variant="default" className="mb-3 border-amber-500/50 bg-amber-500/10">
                  <Info className="h-4 w-4 text-amber-600" />
                  <AlertTitle>Faça login para chat em tempo real</AlertTitle>
                  <AlertDescription>
                    Usuários anônimos não iniciam WebSocket nem streaming. Entre com sua conta para conversar em tempo real.
                  </AlertDescription>
                </Alert>
              )}
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
                        streamEvents={isStreaming && index === messages.length - 1 ? streamEvents : null}
                        typingSpeedMs={typingSpeedMs}
                        onRateImage={handleRateImage}
                        onFeedback={handleFeedback}
                        onRegenerate={handleRegenerate}
                        onQuickReply={(content) => {
                          if (isStreaming) return;
                          if (!isAuthenticated) {
                            toast({ title: 'Faça login para continuar', description: 'O chat em tempo real está disponível apenas para usuários autenticados.' });
                            return;
                          }
                          sendMessage.mutate({ content });
                        }}
                        selectionMode={messageSelectionMode}
                        isSelected={selectedMessageIds.has(message.id)}
                        onToggleSelect={(shiftKey) => toggleMessageSelection(message.id, index, shiftKey)}
                      />
                    ))}
                    {lastResponseUsedFallback && messages.length > 0 && (
                      <Alert variant="default" className="mt-3 border-amber-500/50 bg-amber-500/10">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <AlertTitle>{t('chat.fallbackBanner.title')}</AlertTitle>
                        <AlertDescription>{t('chat.fallbackBanner.desc')}</AlertDescription>
                      </Alert>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

        </div>

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
              isRecordingDisabled={isStreaming || isRecording || isRecordingStarting || isTranscribingRecording}
              isMobile={isMobile}
              acceptedTypes={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio].join(',')}
              focusNonce={focusNonce}
              isDisabled={showLoginBanner}
            />
        </motion.form>

        <Dialog
          open={showTrainingDialog}
          onOpenChange={(open) => {
            setShowTrainingDialog(open);
            if (!open) {
              setTrainingDialogMode(null);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('chat.training.title')}</DialogTitle>
              <DialogDescription>
                {trainingDialogMode === 'messages'
                  ? t('chat.training.descMessages', { count: selectedMessageIds.size })
                  : t('chat.training.desc')}
              </DialogDescription>
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
              {trainingDialogMode === 'conversation' && messages.length > 10 && (
                <Alert className="border-amber-500/50 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t('chat.training.longConversationTitle')}</AlertTitle>
                  <AlertDescription>{t('chat.training.longConversationDesc')}</AlertDescription>
                </Alert>
              )}
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
                onClick={() => {
                  if (!trainingNamespaceId) {
                    toast({
                      title: 'Namespace obrigatório',
                      description: 'Selecione um namespace para enviar os dados ao treinamento.',
                      variant: 'destructive',
                    });
                    return;
                  }
                  if (trainingDialogMode === 'messages') {
                    sendSelectedMessagesToTraining.mutate();
                  } else {
                    sendConversationToTraining.mutate();
                  }
                }}
                disabled={
                  trainingDialogMode === 'messages'
                    ? sendSelectedMessagesToTraining.isPending
                    : sendConversationToTraining.isPending
                  || !trainingNamespaceId
                }
              >
                {(trainingDialogMode === 'messages'
                  ? sendSelectedMessagesToTraining.isPending
                  : sendConversationToTraining.isPending) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('chat.training.sending')}
                  </>
                ) : (
                  <>
                    <FileCheck className="h-4 w-4 mr-2" />
                    {trainingDialogMode === 'messages'
                      ? t('chat.selection.sendSelected')
                      : t('chat.training.confirm')}
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

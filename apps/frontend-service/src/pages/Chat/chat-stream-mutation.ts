import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { parseMessageSources } from './chat-message-sources';
import { mediaAttachmentToBase64 } from './chat-media-attachments';
import { normalizeRouteForContext } from './chat-page-routing';
import { buildCanonicalChatSelectionPayload } from './chat-selection';
import { normalizeServerMessage, type ServerMessagePayload } from './chat-message-normalization';
import { frontendLogger } from '@/lib/logger';
import type { AgentEvent, MediaAttachment, Message, RuntimeNotice, RuntimeNoticeCode } from './components/types';
import type { RoutingDebugData, RoutingMode } from './useChatRoutingState';
import type { ReasoningMode } from '@/lib/reasoning-mode';
import type { OptimisticConversationSyncState } from './useChatMessageSyncEffects';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type CreateConversationPayload = {
  agentId?: string | null;
  namespaceId?: string | null;
  reasoningMode?: ReasoningMode;
  context?: 'trading' | 'sales' | 'support' | 'cambio' | 'default';
  route?: string;
};

type CreateConversationResult = {
  conversation: {
    id: string;
  };
};

type StreamMediaAttachmentPayload = {
  id: string;
  filename: string;
  mimeType: string;
  file?: string;
  uploadId?: string;
  fileUrl?: string;
  size?: number;
};

export type ChatStreamMutationOptions = {
  activeConversationAgent: Message['agent'] | null;
  approvalPolicy: 'always_confirm' | 'confirm_risky' | 'never_confirm';
  conversationId?: string;
  createConversation: (payload?: CreateConversationPayload) => Promise<CreateConversationResult>;
  createStatusEvent: (stage?: string, label?: string) => AgentEvent;
  ensureRoutingSelection: () => boolean;
  fallbackMessageAgent: Message['agent'] | null;
  fallbackMessageUser: Message['user'];
  isAuthenticated: boolean;
  navigate: (path: string) => void;
  notify: NotifyFn;
  pushStreamEvent: (event: AgentEvent) => void;
  queryClient: QueryClient;
  resolveStreamStatus: (stage?: string) => string;
  routeContextFromQuery?: string | null;
  routedAgent: Message['agent'] | null;
  routingAgentIds: string[];
  routingKey: string;
  routingMode: RoutingMode;
  selectedAgentId: string | null;
  selectedNamespaceId: string | null;
  selectedReasoningMode: ReasoningMode;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setLastResponseUsedFallback: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setRuntimeNotice: Dispatch<SetStateAction<RuntimeNotice | null>>;
  setRoutedAgentByConversation: Dispatch<SetStateAction<Record<string, Message['agent'] | null>>>;
  setRoutingAgentIdsByConversation: Dispatch<SetStateAction<Record<string, string[]>>>;
  setRoutingDebugByConversation: Dispatch<SetStateAction<Record<string, RoutingDebugData>>>;
  setRoutingModeByConversation: Dispatch<SetStateAction<Record<string, RoutingMode>>>;
  setRoutingSourceByConversation: Dispatch<SetStateAction<Record<string, string>>>;
  setStreamEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  setStreamStatusLabel: Dispatch<SetStateAction<string | null>>;
  showStreamDiagnostics: boolean;
  stopRequestedRef: MutableRefObject<boolean>;
  streamControllerRef: MutableRefObject<AbortController | null>;
  optimisticConversationSyncRef: MutableRefObject<OptimisticConversationSyncState | null>;
  t: (key: string) => string;
};

export type SendMessagePayload = {
  content: string;
  mediaAttachments?: MediaAttachment[];
};

const STREAM_NO_CHUNK_TIMEOUT_MS = 120000;
const RUNTIME_NOTICE_CODES: RuntimeNoticeCode[] = [
  'serving_interrupted_for_training',
  'training_in_progress',
  'serving_restored',
];

function isRuntimeNoticeCode(value: unknown): value is RuntimeNoticeCode {
  return typeof value === 'string' && RUNTIME_NOTICE_CODES.includes(value as RuntimeNoticeCode);
}

export function createChatStreamMutationConfig(options: ChatStreamMutationOptions) {
  const mutationFn = async ({ content, mediaAttachments }: SendMessagePayload) => {
    const {
      activeConversationAgent,
      approvalPolicy,
      conversationId,
      createConversation,
      createStatusEvent,
      ensureRoutingSelection,
      fallbackMessageAgent,
      fallbackMessageUser,
      isAuthenticated,
      navigate,
      notify,
      pushStreamEvent,
      queryClient,
      resolveStreamStatus,
      routeContextFromQuery,
      routedAgent,
      routingAgentIds,
      routingKey,
      routingMode,
      selectedAgentId,
      selectedNamespaceId,
      selectedReasoningMode,
      setIsStreaming,
      setLastResponseUsedFallback,
      setMessages,
      setRuntimeNotice,
      setRoutedAgentByConversation,
      setRoutingAgentIdsByConversation,
      setRoutingDebugByConversation,
      setRoutingModeByConversation,
      setRoutingSourceByConversation,
      setStreamEvents,
      setStreamStatusLabel,
      showStreamDiagnostics,
      stopRequestedRef,
      streamControllerRef,
      optimisticConversationSyncRef,
      t,
    } = options;
    const selectedPayload = buildCanonicalChatSelectionPayload({
      agentId: selectedAgentId,
      namespaceId: selectedNamespaceId,
      reasoningMode: selectedReasoningMode,
    });

    if (!isAuthenticated) {
      notify({
        title: 'Faça login para continuar',
        description: 'O chat em tempo real está disponível apenas para usuários autenticados.',
      });
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
      user: fallbackMessageUser,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamStatusLabel(null);
    if (showStreamDiagnostics) {
      setStreamEvents([]);
    }
    setLastResponseUsedFallback(false);
    if (showStreamDiagnostics) {
      pushStreamEvent(createStatusEvent('preparing'));
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      agent: routedAgent ?? activeConversationAgent ?? null,
    };
    setMessages((prev) => [...prev, assistantMessage]);

    const pathname = window.location.pathname ?? '';
    const resolvedRoute = routeContextFromQuery ?? normalizeRouteForContext(pathname);
    const routeQuerySuffix = routeContextFromQuery ? `?from=${encodeURIComponent(routeContextFromQuery)}` : '';
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const contextPayload: CreateConversationPayload = {
        agentId: selectedPayload.agentId,
        namespaceId: selectedPayload.namespaceId,
      };
      contextPayload.reasoningMode = selectedPayload.reasoningMode;
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
      const created = await createConversation(Object.keys(contextPayload).length > 0 ? contextPayload : undefined);
      const nextConversationId = created.conversation.id;
      activeConversationId = nextConversationId;
      optimisticConversationSyncRef.current = {
        conversationId: nextConversationId,
        minimumMessageCount: 2,
      };
      queryClient.setQueryData<{ messages: Message[] }>(
        ['/api/chat/conversations', nextConversationId, 'messages'],
        { messages: [userMessage, assistantMessage] },
      );
      navigate(`/chat/${nextConversationId}${routeQuerySuffix}`);
      setRoutingModeByConversation((prev) => {
        const { [currentRoutingKey]: _removed, ...rest } = prev;
        return { ...rest, [nextConversationId]: currentRoutingMode };
      });
      setRoutingAgentIdsByConversation((prev) => {
        const { [currentRoutingKey]: _removed, ...rest } = prev;
        return { ...rest, [nextConversationId]: currentRoutingAgentIds };
      });
      setRoutedAgentByConversation((prev) => {
        const { [currentRoutingKey]: removedAgent, ...rest } = prev;
        if (!removedAgent) return rest;
        return { ...rest, [nextConversationId]: removedAgent };
      });
      setRoutingSourceByConversation((prev) => {
        const { [currentRoutingKey]: removedSource, ...rest } = prev;
        if (!removedSource) return rest;
        return { ...rest, [nextConversationId]: removedSource };
      });
      setRoutingDebugByConversation((prev) => {
        const { [currentRoutingKey]: removedDebug, ...rest } = prev;
        if (!removedDebug) return rest;
        return { ...rest, [nextConversationId]: removedDebug };
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
        }),
      )
      : undefined;

    const payload = {
      conversationId: activeConversationId,
      ...(content.trim().length > 0 ? { message: content } : {}),
      ...(mediaPayload && mediaPayload.length > 0 ? { mediaAttachments: mediaPayload } : {}),
      route: resolvedRoute,
      approvalPolicy,
      ...selectedPayload,
      streamDiagnostics: showStreamDiagnostics,
    };

    const res = await apiRequest('POST', '/api/chat/stream', payload, {
      signal: controller.signal,
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let pendingContent = '';
    let contentFlushTimerId: number | null = null;
    let buffer = '';
    let lastRuntimeNoticeCode: RuntimeNoticeCode | null = null;
    let sseParseErrorCount = 0;
    resetTimeout();

    const applyAssistantContent = (nextContent: string) => {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
          newMessages[lastIdx] = { ...newMessages[lastIdx], content: nextContent };
        }
        return newMessages;
      });
    };

    const flushPendingContent = () => {
      if (!pendingContent) return;
      fullContent += pendingContent;
      pendingContent = '';
      applyAssistantContent(fullContent);
    };

    const schedulePendingContentFlush = () => {
      if (contentFlushTimerId !== null) return;
      contentFlushTimerId = window.setTimeout(() => {
        contentFlushTimerId = null;
        flushPendingContent();
      }, 30);
    };

    const cancelPendingContentFlush = () => {
      if (contentFlushTimerId !== null) {
        window.clearTimeout(contentFlushTimerId);
        contentFlushTimerId = null;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        resetTimeout();

        let normalizedBuffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let separatorIndex = normalizedBuffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const event = normalizedBuffer.slice(0, separatorIndex);
          normalizedBuffer = normalizedBuffer.slice(separatorIndex + 2);
          separatorIndex = normalizedBuffer.indexOf('\n\n');

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
            const parsed = JSON.parse(data) as {
              type?: string;
              attachments?: Array<{
                id: string;
                url?: string;
                thumbnailUrl?: string;
                processingStatus?: string;
                uploadId?: string;
                transcription?: string;
                visionDescription?: string;
                visionModel?: string;
              }>;
              content?: string;
              conversationId?: string;
              data?: unknown;
              error?: string;
              generatedImage?: Message['generatedImage'];
              message?: unknown;
              mode?: RoutingMode;
              profile?: string;
              score?: number;
              selected?: { agentId?: string | null; namespaceId?: string | null };
              source?: string;
              sources?: unknown;
              stage?: string;
              threshold?: number;
              usedFallback?: boolean;
              agent?: Message['agent'];
              notice?: {
                code?: unknown;
                occurredAt?: unknown;
              };
            };
            const routingConversationKey = activeConversationId ?? conversationId ?? 'new';
            if (parsed.type === 'conversation' && parsed.conversationId && !conversationId) {
              navigate(`/chat/${parsed.conversationId}${routeQuerySuffix}`);
              queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
              queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations', parsed.conversationId, 'detail'] });
              resetTimeout();
            }

            if (parsed.type === 'status' && typeof parsed.stage === 'string' && parsed.stage.trim().length > 0) {
              const label = resolveStreamStatus(parsed.stage);
              setStreamStatusLabel(label);
              if (showStreamDiagnostics) {
                pushStreamEvent(createStatusEvent(parsed.stage, label));
              }
              resetTimeout();
            }

            if (showStreamDiagnostics && parsed.type === 'agent_event' && parsed.data) {
              pushStreamEvent(parsed.data as AgentEvent);
              resetTimeout();
            }

            if (parsed.type === 'llm_metadata' && parsed.usedFallback) {
              setLastResponseUsedFallback(true);
              resetTimeout();
            }

            if (parsed.type === 'agent_route') {
              const normalizedAgent = parsed.agent ?? null;
              const eventMode: RoutingMode = parsed.mode === 'manual' ? 'manual' : 'auto';
              const eventSource = typeof parsed.source === 'string' ? parsed.source : 'none';
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIdx = newMessages.length - 1;
                if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                  newMessages[lastIdx] = { ...newMessages[lastIdx], agent: normalizedAgent };
                }
                return newMessages;
              });
              setRoutedAgentByConversation((prev) => ({ ...prev, [routingConversationKey]: normalizedAgent ?? null }));
              setRoutingModeByConversation((prev) => ({ ...prev, [routingConversationKey]: eventMode }));
              setRoutingSourceByConversation((prev) => ({ ...prev, [routingConversationKey]: eventSource }));
              if (eventMode === 'manual' && normalizedAgent?.id) {
                setRoutingAgentIdsByConversation((prev) => ({ ...prev, [routingConversationKey]: [normalizedAgent.id] }));
              } else {
                setRoutingAgentIdsByConversation((prev) => ({ ...prev, [routingConversationKey]: [] }));
              }
              if (parsed.selected) {
                setRoutingDebugByConversation((prev) => ({
                  ...prev,
                  [routingConversationKey]: {
                    selectedAgentId: parsed.selected?.agentId ?? null,
                    selectedNamespaceId: parsed.selected?.namespaceId ?? null,
                    score: prev[routingConversationKey]?.score ?? null,
                    threshold: prev[routingConversationKey]?.threshold ?? null,
                    profile: prev[routingConversationKey]?.profile ?? null,
                    source: eventSource,
                    mode: eventMode,
                  },
                }));
              }
              resetTimeout();
            }

            if (parsed.type === 'routing_debug') {
              const resolvedMode: RoutingMode | null =
                parsed.mode === 'manual' || parsed.mode === 'auto' ? parsed.mode : null;
              const resolvedSource = typeof parsed.source === 'string' ? parsed.source : null;
              setRoutingDebugByConversation((prev) => ({
                ...prev,
                [routingConversationKey]: {
                  selectedAgentId: parsed.selected?.agentId ?? null,
                  selectedNamespaceId: parsed.selected?.namespaceId ?? null,
                  score: typeof parsed.score === 'number' ? parsed.score : null,
                  threshold: typeof parsed.threshold === 'number' ? parsed.threshold : null,
                  profile: typeof parsed.profile === 'string' ? parsed.profile : null,
                  source: resolvedSource,
                  mode: resolvedMode,
                },
              }));
              if (resolvedMode) {
                setRoutingModeByConversation((prev) => ({ ...prev, [routingConversationKey]: resolvedMode }));
              }
              if (resolvedSource) {
                setRoutingSourceByConversation((prev) => ({ ...prev, [routingConversationKey]: resolvedSource }));
              }
              resetTimeout();
            }

            if (parsed.type === 'sources') {
              const parsedSources = parseMessageSources(parsed.sources);
              if (parsedSources) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIdx = newMessages.length - 1;
                  if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                    const metadata = newMessages[lastIdx].metadata ?? {};
                    newMessages[lastIdx] = {
                      ...newMessages[lastIdx],
                      metadata: {
                        ...metadata,
                        sources: parsedSources,
                      },
                    };
                  }
                  return newMessages;
                });
              }
              resetTimeout();
            }

            if (parsed.type === 'message_saved') {
              resetTimeout();
            }

            if (parsed.type === 'runtime_notice') {
              const noticeCode = parsed.notice?.code;
              if (isRuntimeNoticeCode(noticeCode)) {
                const occurredAt = typeof parsed.notice?.occurredAt === 'string'
                  ? parsed.notice.occurredAt
                  : new Date().toISOString();
                const runtimeNotice: RuntimeNotice = {
                  code: noticeCode,
                  occurredAt,
                };
                setRuntimeNotice(runtimeNotice);

                if (lastRuntimeNoticeCode !== noticeCode) {
                  const isRestoredNotice = noticeCode === 'serving_restored';
                  notify({
                    title: t(
                      isRestoredNotice
                        ? 'chat.runtimeNotice.restored.title'
                        : 'chat.runtimeNotice.interruption.title',
                    ),
                    description: t(
                      isRestoredNotice
                        ? 'chat.runtimeNotice.restored.description'
                        : 'chat.runtimeNotice.interruption.description',
                    ),
                    variant: isRestoredNotice ? 'default' : 'destructive',
                  });
                  lastRuntimeNoticeCode = noticeCode;
                }
              }
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
              const normalizedMessage = normalizeServerMessage(parsed.message as ServerMessagePayload, {
                fallbackUser: fallbackMessageUser,
                fallbackAgent: fallbackMessageAgent,
              });
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
                      const serverAttachment = parsed.attachments?.find((att) => att.id === media.id);
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

            if (typeof parsed.content === 'string' && parsed.content.length > 0) {
              pendingContent += parsed.content;
              schedulePendingContentFlush();
              resetTimeout();
            }

            if (parsed.type === 'final_message' && typeof parsed.content === 'string') {
              cancelPendingContentFlush();
              pendingContent = '';
              fullContent = parsed.content;
              applyAssistantContent(fullContent);
              resetTimeout();
            }

            if (parsed.type === 'action_result' && parsed.data && typeof parsed.data === 'object') {
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
          } catch (parseError) {
            sseParseErrorCount += 1;
            const parseErrorMessage = parseError instanceof Error
              ? parseError.message
              : 'Erro desconhecido ao interpretar evento SSE';

            frontendLogger.warn('Falha ao interpretar evento SSE do chat', {
              parseErrorMessage,
              sseParseErrorCount,
              activeConversationId: activeConversationId ?? null,
              eventPreview: data.slice(0, 300),
            });

            if (showStreamDiagnostics) {
              pushStreamEvent({
                id: crypto.randomUUID(),
                ts: new Date().toISOString(),
                phase: 'system',
                action: 'sse_parse_error',
                status: 'error',
                message: `Falha ao interpretar evento SSE (#${sseParseErrorCount})`,
                payload: {
                  activeConversationId: activeConversationId ?? null,
                  parseErrorMessage,
                },
              });
            }
          }
        }
        buffer = normalizedBuffer;
      }
    } finally {
      cancelPendingContentFlush();
      flushPendingContent();
      clearTimeoutSafe();
      streamControllerRef.current = null;
      setStreamStatusLabel(null);
    }

    setIsStreaming(false);
    queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
    if (activeConversationId) {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations', activeConversationId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations', activeConversationId, 'messages'] });
    }
    return fullContent;
  };

  const onError = (error: unknown) => {
    const {
      setIsStreaming,
      setMessages,
      setStreamStatusLabel,
      stopRequestedRef,
      t,
    } = options;
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort && stopRequestedRef.current) {
      stopRequestedRef.current = false;
      setIsStreaming(false);
      setStreamStatusLabel(null);
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
    setStreamStatusLabel(null);
  };

  return {
    mutationFn,
    onError,
  };
}

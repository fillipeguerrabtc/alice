/**
 * Conversations - Página de conversas para seleção e treino
 *
 * Regra 6 - Sem mocks: dados reais da API
 * Regra 10 - Documentação PT-BR
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Calendar, CheckSquare, Filter, MessageSquare, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { TIMEZONE } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';
import type { Conversation, Message } from '@/pages/Chat/components/types';

type ConversationsResponse = {
  conversations: Conversation[];
  nextCursor?: { updatedAt: string; id: string } | null;
  hasMore?: boolean;
};

type MessagesResponse = { messages: Message[] };

type BatchItem = {
  conversationId: string;
  messageIds?: string[];
};

export default function ConversationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Map<string, Set<string>>>(new Map());
  const [trainingNamespaceId, setTrainingNamespaceId] = useState<string>('');
  const [trainingDialogMode, setTrainingDialogMode] = useState<'conversations' | 'messages' | null>(null);
  const lastSelectedMessageIndex = useRef<number | null>(null);

  const queryParams = useMemo(() => {
    const search = location.includes('?') ? location.split('?')[1] ?? '' : '';
    const params = new URLSearchParams(search);
    return {
      from: params.get('from') || '',
      to: params.get('to') || '',
    };
  }, [location]);

  const [fromDate, setFromDate] = useState(queryParams.from);
  const [toDate, setToDate] = useState(queryParams.to);
  const isFilterActive = Boolean(queryParams.from || queryParams.to);

  useEffect(() => {
    setFromDate(queryParams.from);
    setToDate(queryParams.to);
  }, [queryParams.from, queryParams.to]);

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    navigate(`/conversations${params.toString() ? `?${params.toString()}` : ''}`);
  }, [fromDate, toDate, navigate]);

  const clearFilters = useCallback(() => {
    setFromDate('');
    setToDate('');
    navigate('/conversations');
  }, [navigate]);

  const fetchConversations = useCallback(async ({ pageParam }: { pageParam?: { updatedAt: string; id: string } }) => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (pageParam?.updatedAt && pageParam?.id) {
      params.set('cursorUpdatedAt', pageParam.updatedAt);
      params.set('cursorId', pageParam.id);
    }
    if (queryParams.from) params.set('from', queryParams.from);
    if (queryParams.to) params.set('to', queryParams.to);
    const res = await apiRequest('GET', `/api/chat/conversations?${params.toString()}`);
    return res.json() as Promise<ConversationsResponse>;
  }, [queryParams.from, queryParams.to]);

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['/api/chat/conversations', queryParams.from || null, queryParams.to || null],
    queryFn: fetchConversations,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 60,
  });

  const conversations = conversationsData?.pages.flatMap((page) => page.conversations) ?? [];
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0]?.id ?? null);
    }
  }, [activeConversationId, conversations]);

  const { data: namespaces } = useQuery({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const { data: messagesData, isFetching: messagesLoading } = useQuery<MessagesResponse>({
    queryKey: ['/api/chat/conversations', activeConversationId, 'messages'],
    queryFn: async () => {
      if (!activeConversationId) {
        return { messages: [] };
      }
      const res = await apiRequest('GET', `/api/chat/conversations/${activeConversationId}/messages`);
      return res.json() as Promise<MessagesResponse>;
    },
    enabled: Boolean(activeConversationId),
  });

  const messages = messagesData?.messages ?? [];

  const selectedMessagesCount = useMemo(() => {
    let total = 0;
    selectedMessages.forEach((set) => {
      total += set.size;
    });
    return total;
  }, [selectedMessages]);

  const toggleConversationSelection = useCallback((conversationId: string) => {
    setSelectedConversations((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  const toggleMessageSelection = useCallback((messageId: string, index: number, shiftKey: boolean) => {
    if (!activeConversationId) return;
    setSelectedMessages((prev) => {
      const next = new Map(prev);
      const currentSet = new Set(next.get(activeConversationId) ?? []);

      if (shiftKey && lastSelectedMessageIndex.current !== null) {
        const start = Math.min(lastSelectedMessageIndex.current, index);
        const end = Math.max(lastSelectedMessageIndex.current, index);
        for (let i = start; i <= end; i += 1) {
          const target = messages[i];
          if (target?.id) {
            currentSet.add(target.id);
          }
        }
      } else if (currentSet.has(messageId)) {
        currentSet.delete(messageId);
      } else {
        currentSet.add(messageId);
      }

      lastSelectedMessageIndex.current = index;
      if (currentSet.size === 0) {
        next.delete(activeConversationId);
      } else {
        next.set(activeConversationId, currentSet);
      }
      return next;
    });
  }, [activeConversationId, messages]);

  const trainingMutation = useMutation({
    mutationFn: async (payload: { namespaceId?: string; items: BatchItem[] }) => {
      const res = await apiRequest('POST', '/api/chat/training/collect-batch', payload);
      return res.json() as Promise<{ success: boolean; processed: number; failures: Array<{ conversationId: string; error: string }> }>;
    },
    onSuccess: (result) => {
      setTrainingDialogMode(null);
      if (result.failures?.length) {
        toast({
          title: t('conversations.training.partial'),
          description: result.failures.map((f) => f.error).join('; '),
          variant: 'destructive',
        });
      } else {
        toast({ title: t('conversations.training.sent') });
      }
      setSelectedConversations(new Set());
      setSelectedMessages(new Map());
    },
    onError: () => {
      toast({ title: t('conversations.training.error'), variant: 'destructive' });
    },
  });

  const sendSelectedConversations = useCallback(() => {
    if (selectedConversations.size === 0) return;
    setTrainingDialogMode('conversations');
  }, [selectedConversations]);

  const sendSelectedMessages = useCallback(() => {
    if (selectedMessagesCount === 0) return;
    setTrainingDialogMode('messages');
  }, [selectedMessagesCount]);

  const confirmTrainingSend = useCallback(() => {
    if (!trainingDialogMode) return;
    const namespaceId = trainingNamespaceId || undefined;
    if (trainingDialogMode === 'conversations') {
      const items = Array.from(selectedConversations).map((id) => ({ conversationId: id }));
      trainingMutation.mutate({ namespaceId, items });
      return;
    }
    const items: BatchItem[] = [];
    selectedMessages.forEach((messageIds, conversationId) => {
      if (messageIds.size > 0) {
        items.push({ conversationId, messageIds: Array.from(messageIds) });
      }
    });
    if (items.length > 0) {
      trainingMutation.mutate({ namespaceId, items });
    }
  }, [selectedConversations, selectedMessages, trainingDialogMode, trainingNamespaceId, trainingMutation]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            {t('conversations.title')}
          </CardTitle>
          <CardDescription>{t('conversations.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto_auto]">
            <div className="space-y-2">
              <Label>{t('conversations.filters.from')}</Label>
              <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('conversations.filters.to')}</Label>
              <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button variant="secondary" onClick={applyFilters}>
                <Filter className="mr-2 h-4 w-4" />
                {t('conversations.filters.apply')}
              </Button>
              <Button variant="ghost" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                {t('conversations.filters.clear')}
              </Button>
            </div>
            <div className="flex items-end">
              {isFilterActive && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {t('conversations.filters.active')}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-[640px]">
          <CardHeader>
            <CardTitle>{t('conversations.list.title')}</CardTitle>
            <CardDescription>{t('conversations.list.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('conversations.list.selected', { count: selectedConversations.size })}</span>
              <Button variant="ghost" size="sm" onClick={sendSelectedConversations} disabled={selectedConversations.size === 0}>
                <Send className="mr-2 h-3.5 w-3.5" />
                {t('conversations.training.sendConversations')}
              </Button>
            </div>
            <ScrollArea className="h-[520px] pr-2">
              <div className="space-y-2">
                {conversationsLoading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-14 w-full" />
                  ))
                ) : (
                  conversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setActiveConversationId(conv.id)}
                      className={`w-full rounded-md border p-2 text-left transition ${activeConversationId === conv.id ? 'border-primary' : 'border-border hover:border-muted-foreground'}`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={selectedConversations.has(conv.id)}
                          onCheckedChange={() => toggleConversationSelection(conv.id)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t('conversations.list.selectConversation')}
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium truncate">{conv.titulo || t('conversations.list.untitled')}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(conv.atualizadoEm ?? conv.criadoEm, { locale, timeZone })}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
                {hasNextPage && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? t('common.loading') : t('conversations.list.loadMore')}
                  </Button>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="h-[640px]">
          <CardHeader>
            <CardTitle>{t('conversations.messages.title')}</CardTitle>
            <CardDescription>{t('conversations.messages.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Button
                  variant={messageSelectionMode ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setMessageSelectionMode((prev) => !prev)}
                >
                  <CheckSquare className="mr-2 h-3.5 w-3.5" />
                  {messageSelectionMode ? t('conversations.messages.cancel') : t('conversations.messages.select')}
                </Button>
                <span>{t('conversations.messages.selected', { count: selectedMessagesCount })}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={sendSelectedMessages} disabled={selectedMessagesCount === 0}>
                <Send className="mr-2 h-3.5 w-3.5" />
                {t('conversations.training.sendMessages')}
              </Button>
            </div>
            <ScrollArea className="h-[520px] pr-2">
              <div className="space-y-3">
                {messagesLoading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-12 w-full" />
                  ))
                ) : messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('conversations.messages.empty')}</div>
                ) : (
                  messages.map((message, index) => {
                    const selectionSet = selectedMessages.get(activeConversationId ?? '') ?? new Set();
                    const isSelected = selectionSet.has(message.id);
                    return (
                      <div
                        key={message.id}
                        className={`rounded-md border p-3 ${isSelected ? 'border-primary bg-muted/40' : 'border-border'}`}
                      >
                        <div className="flex items-start gap-2">
                          {messageSelectionMode && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMessageSelection(message.id, index, event.shiftKey);
                              }}
                              aria-label={t('conversations.messages.selectMessage')}
                            />
                          )}
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground">
                              {message.role === 'user' ? t('conversations.messages.user') : t('conversations.messages.assistant')}
                            </div>
                            <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(trainingDialogMode)} onOpenChange={() => setTrainingDialogMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conversations.training.title')}</DialogTitle>
            <DialogDescription>{t('conversations.training.desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('conversations.training.namespace')}</Label>
              <Select value={trainingNamespaceId} onValueChange={setTrainingNamespaceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('conversations.training.selectNamespace')} />
                </SelectTrigger>
                <SelectContent>
                  {(namespaces as Array<{ id: string; nome: string }> | undefined)?.map((namespace) => (
                    <SelectItem key={namespace.id} value={namespace.id}>
                      {namespace.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('conversations.training.namespaceOptional')}</p>
            </div>
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              {trainingDialogMode === 'conversations'
                ? t('conversations.training.summaryConversations', { count: selectedConversations.size })
                : t('conversations.training.summaryMessages', { count: selectedMessagesCount })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrainingDialogMode(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmTrainingSend} disabled={trainingMutation.isPending}>
              {trainingMutation.isPending ? t('conversations.training.sending') : t('conversations.training.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

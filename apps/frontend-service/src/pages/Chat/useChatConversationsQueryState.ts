import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { Conversation, ConversationsResponse } from './components/types';

type ConversationFilter = {
  from?: string;
  to?: string;
};

type UseChatConversationsQueryStateOptions = {
  conversationFilter: ConversationFilter;
  conversationId?: string;
};

export function useChatConversationsQueryState({
  conversationFilter,
  conversationId,
}: UseChatConversationsQueryStateOptions) {
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
  }, [conversationFilter.from, conversationFilter.to]);

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

  const conversations = useMemo<Conversation[]>(
    () => conversationsData?.pages.flatMap((page) => page.conversations) ?? [],
    [conversationsData],
  );
  const activeConversation = useMemo(
    () => (
      conversationId
        ? conversations.find((conversation) => conversation.id === conversationId) ?? null
        : null
    ),
    [conversationId, conversations],
  );

  return {
    activeConversation,
    conversations,
    conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  };
}

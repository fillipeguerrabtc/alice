import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { isIsoDateQueryParam, normalizeRouteForContext } from './chat-page-routing';

type UseChatConversationFiltersOptions = {
  location: string;
  navigate: (to: string) => void;
  t: TFunction;
};

export function useChatConversationFilters(options: UseChatConversationFiltersOptions) {
  const { location, navigate, t } = options;

  const routeContextFromQuery = useMemo(() => {
    const search = location.includes('?') ? location.split('?')[1] ?? '' : '';
    const params = new URLSearchParams(search);
    const fromParam = params.get('from');
    if (!fromParam || isIsoDateQueryParam(fromParam)) {
      return null;
    }
    return normalizeRouteForContext(fromParam);
  }, [location]);

  const conversationFilter = useMemo(() => {
    const search = location.includes('?') ? location.split('?')[1] ?? '' : '';
    const params = new URLSearchParams(search);
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const from = isIsoDateQueryParam(fromParam) ? fromParam : undefined;
    const to = isIsoDateQueryParam(toParam) ? toParam : undefined;
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

  return {
    clearConversationFilter,
    conversationFilter,
    conversationFilterLabel,
    routeContextFromQuery,
  };
}

import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus, MessageSquare, Trash2, CheckSquare, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ConversationItem } from './ConversationItem';
import type { Conversation } from './types';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

export interface ConversationsListProps {
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

export function ConversationsList({
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

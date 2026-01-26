/**
 * ConversationItem - Item da lista de conversas na sidebar
 * 
 * @module Chat/components/ConversationItem
 */

import { motion } from 'framer-motion';
import { MessageSquare, Trash2 } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Conversation } from './types';

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  onToggleSelect?: () => void;
  onDelete?: () => void;
}

export function ConversationItem({ 
  conversation, 
  isActive, 
  isSelectionMode = false,
  isSelected = false,
  onClick,
  onToggleSelect,
  onDelete,
}: ConversationItemProps) {
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? 'UTC';

  return (
    <motion.button
      variants={itemVariants}
      onClick={onClick}
      className={cn(
        'group w-full text-left p-3 rounded-lg transition-colors hover-elevate',
        isActive ? 'bg-accent' : 'hover:bg-muted/50'
      )}
      data-testid={`conversation-item-${conversation.id}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {isSelectionMode && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => {
              event.stopPropagation();
              onToggleSelect?.();
            }}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 accent-primary"
            aria-label="Selecionar conversa"
          />
        )}
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-sm truncate flex-1">
          {conversation.titulo || 'Nova Conversa'}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {formatDateTime(conversation.criadoEm, { locale, timeZone })}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.();
          }}
          className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-muted/60"
          aria-label="Excluir conversa"
          data-testid={`button-delete-conversation-${conversation.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.button>
  );
}

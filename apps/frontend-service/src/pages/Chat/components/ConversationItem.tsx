/**
 * ConversationItem - Item da lista de conversas na sidebar
 * 
 * @module Chat/components/ConversationItem
 */

import { motion } from 'framer-motion';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Conversation } from './types';

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}

export function ConversationItem({ 
  conversation, 
  isActive, 
  onClick 
}: ConversationItemProps) {
  return (
    <motion.button
      variants={itemVariants}
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors hover-elevate',
        isActive ? 'bg-accent' : 'hover:bg-muted/50'
      )}
      data-testid={`conversation-item-${conversation.id}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-sm truncate">
          {conversation.titulo || 'Nova Conversa'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {new Date(conversation.criadoEm).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </motion.button>
  );
}

/**
 * AgentStatusBadge - Badge de status do agente IA/Humano
 * 
 * Indica se a conversa está sendo atendida por IA ou agente humano.
 * 
 * @module Chat/components/AgentStatusBadge
 */

import { Bot, User, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type AgentStatus = 'ai' | 'human' | 'transferring';

interface AgentStatusBadgeProps {
  status: AgentStatus;
  agentName?: string;
}

export function AgentStatusBadge({ status, agentName }: AgentStatusBadgeProps) {
  const { t } = useTranslation();

  const statusConfig = {
    ai: {
      icon: Bot,
      label: t('chat.agent.ai'),
      variant: 'default' as const,
      className: 'bg-primary/10 text-primary border-primary/20',
    },
    human: {
      icon: User,
      label: agentName || t('chat.agent.human'),
      variant: 'secondary' as const,
      className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    },
    transferring: {
      icon: Loader2,
      label: t('chat.agent.transferring'),
      variant: 'outline' as const,
      className: 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge 
      variant={config.variant} 
      className={`flex items-center gap-1 ${config.className}`}
      data-testid="badge-agent-status"
    >
      <Icon className={`h-3 w-3 ${status === 'transferring' ? 'animate-spin' : ''}`} />
      <span>{config.label}</span>
    </Badge>
  );
}

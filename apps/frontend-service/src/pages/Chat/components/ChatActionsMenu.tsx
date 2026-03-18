import { MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ChatActionsMenuProps = {
  compact?: boolean;
  showConversationActions: boolean;
  onDeleteConversation: () => void;
};

export function ChatActionsMenu({
  compact = false,
  onDeleteConversation,
  showConversationActions,
}: ChatActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={compact ? 'h-6 w-6' : 'hidden md:flex h-8 w-8'}
          data-testid={compact ? 'button-chat-actions-mobile' : 'button-chat-actions'}
        >
          <MoreHorizontal className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showConversationActions && (
          <DropdownMenuItem
            onClick={onDeleteConversation}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Excluir conversa
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

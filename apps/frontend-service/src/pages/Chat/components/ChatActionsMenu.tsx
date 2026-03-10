import { AlertTriangle, CheckSquare, FileCheck, MoreHorizontal, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ChatActionsMenuProps = {
  compact?: boolean;
  showOperationsControls: boolean;
  showDiagnosticsControls: boolean;
  messageSelectionMode: boolean;
  selectedMessageCount: number;
  showStreamDiagnostics: boolean;
  onOpenConversationTrainingDialog: () => void;
  onToggleMessageSelectionMode: () => void;
  onOpenMessageTrainingDialog: () => void;
  onToggleStreamDiagnostics: () => void;
  onDeleteConversation: () => void;
  t: (key: string) => string;
};

export function ChatActionsMenu({
  compact = false,
  messageSelectionMode,
  onDeleteConversation,
  onOpenConversationTrainingDialog,
  onOpenMessageTrainingDialog,
  onToggleMessageSelectionMode,
  onToggleStreamDiagnostics,
  selectedMessageCount,
  showDiagnosticsControls,
  showOperationsControls,
  showStreamDiagnostics,
  t,
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
        {showOperationsControls && (
          <>
            <DropdownMenuItem onClick={onOpenConversationTrainingDialog}>
              <FileCheck className="h-4 w-4 mr-2" />
              {t('chat.training.send')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMessageSelectionMode}>
              <CheckSquare className="h-4 w-4 mr-2" />
              {messageSelectionMode ? t('chat.selection.cancelSelection') : t('chat.selection.selectMessages')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onOpenMessageTrainingDialog}
              disabled={selectedMessageCount === 0}
            >
              <Send className="h-4 w-4 mr-2" />
              {t('chat.selection.sendSelected')}
            </DropdownMenuItem>
          </>
        )}
        {showDiagnosticsControls && (
          <DropdownMenuItem onClick={onToggleStreamDiagnostics}>
            <AlertTriangle className="h-4 w-4 mr-2" />
            {showStreamDiagnostics ? 'Ocultar detalhes técnicos do stream' : 'Mostrar detalhes técnicos do stream'}
          </DropdownMenuItem>
        )}
        {showOperationsControls && (
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

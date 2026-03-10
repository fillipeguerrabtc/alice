import { type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight, Menu, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChatActionsMenu } from './ChatActionsMenu';
import { ChatGovernanceControls } from './ChatGovernanceControls';

type ChatActionsMenuProps = ComponentProps<typeof ChatActionsMenu>;
type ChatGovernanceControlsProps = ComponentProps<typeof ChatGovernanceControls>;

type ChatHeaderSectionProps = {
  chatActionsMenuProps: ChatActionsMenuProps;
  chatGovernanceControlsProps: ChatGovernanceControlsProps;
  conversationId?: string;
  isMobile: boolean;
  modelBadgeLabel: string;
  onOpenMobileDrawer: () => void;
  onToggleSidebar: () => void;
  showDesktopActionMenu: boolean;
  sidebarOpen: boolean;
};

export function ChatHeaderSection({
  chatActionsMenuProps,
  chatGovernanceControlsProps,
  conversationId,
  isMobile,
  modelBadgeLabel,
  onOpenMobileDrawer,
  onToggleSidebar,
  showDesktopActionMenu,
  sidebarOpen,
}: ChatHeaderSectionProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 md:p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-top">
      <div className="flex items-center gap-2">
        {isMobile ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMobileDrawer}
            className="h-9 w-9"
            data-testid="button-mobile-menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            data-testid="button-toggle-sidebar"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}
        <h1 className="text-base md:text-lg font-semibold truncate" data-testid="text-chat-title">
          {conversationId ? 'Conversa' : 'Nova Conversa'}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        <Badge variant="secondary" className="hidden md:flex gap-1 text-xs">
          <Sparkles className="h-3 w-3" />
          {modelBadgeLabel}
        </Badge>
        <div className="hidden md:flex items-center gap-2">
          <ChatGovernanceControls {...chatGovernanceControlsProps} />
        </div>
        {showDesktopActionMenu && (
          <ChatActionsMenu {...chatActionsMenuProps} />
        )}
        {isMobile && (
          <>
            <Badge variant="secondary" className="h-6 px-2 text-[10px] gap-1">
              <Sparkles className="h-3 w-3" />
              {modelBadgeLabel}
            </Badge>
            <ChatGovernanceControls compact {...chatGovernanceControlsProps} />
            {showDesktopActionMenu && (
              <ChatActionsMenu compact {...chatActionsMenuProps} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

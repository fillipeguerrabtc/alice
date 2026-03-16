import { type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight, Menu, Sparkles } from 'lucide-react';
import type { ChatWorkspaceKey } from '../chat-page-routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChatActionsMenu } from './ChatActionsMenu';
import { ChatGovernanceControls } from './ChatGovernanceControls';

type ChatActionsMenuProps = ComponentProps<typeof ChatActionsMenu>;
type ChatGovernanceControlsProps = ComponentProps<typeof ChatGovernanceControls>;
type WorkspaceOption = {
  label: string;
  value: ChatWorkspaceKey;
};

type ChatHeaderSectionProps = {
  activeWorkspace: ChatWorkspaceKey;
  chatActionsMenuProps: ChatActionsMenuProps;
  chatGovernanceControlsProps: ChatGovernanceControlsProps;
  conversationId?: string;
  isMobile: boolean;
  modelBadgeLabel: string;
  onOpenMobileDrawer: () => void;
  onToggleSidebar: () => void;
  onWorkspaceChange: (workspace: ChatWorkspaceKey) => void;
  showDesktopActionMenu: boolean;
  sidebarOpen: boolean;
  workspaceOptions: WorkspaceOption[];
};

export function ChatHeaderSection({
  activeWorkspace,
  chatActionsMenuProps,
  chatGovernanceControlsProps,
  conversationId,
  isMobile,
  modelBadgeLabel,
  onOpenMobileDrawer,
  onToggleSidebar,
  onWorkspaceChange,
  showDesktopActionMenu,
  sidebarOpen,
  workspaceOptions,
}: ChatHeaderSectionProps) {
  const showDesktopControls =
    workspaceOptions.length > 1 ||
    chatGovernanceControlsProps.showGovernanceControls ||
    showDesktopActionMenu;

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-top">
      <div className="flex flex-col gap-2 p-2 md:p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
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
            <h1 className="truncate text-base font-semibold md:text-lg" data-testid="text-chat-title">
              {conversationId ? 'Conversa' : 'Nova Conversa'}
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="hidden lg:flex gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              {modelBadgeLabel}
            </Badge>
            {isMobile && (
              <>
                <Select value={activeWorkspace} onValueChange={(value) => onWorkspaceChange(value as ChatWorkspaceKey)}>
                  <SelectTrigger
                    className="h-6 w-[108px] border-muted-foreground/20 bg-background/80 px-2 text-[10px]"
                    data-testid="chat-workspace-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {workspaceOptions.map((workspace) => (
                      <SelectItem
                        key={workspace.value}
                        value={workspace.value}
                        data-testid={`chat-workspace-${workspace.value}`}
                      >
                        {workspace.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="h-6 px-2 text-[10px] gap-1">
                  <Sparkles className="h-3 w-3" />
                  {modelBadgeLabel}
                </Badge>
                {activeWorkspace !== 'all' && (
                  <ChatGovernanceControls compact {...chatGovernanceControlsProps} />
                )}
                {showDesktopActionMenu && (
                  <ChatActionsMenu compact {...chatActionsMenuProps} />
                )}
              </>
            )}
          </div>
        </div>

        {!isMobile && showDesktopControls && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select value={activeWorkspace} onValueChange={(value) => onWorkspaceChange(value as ChatWorkspaceKey)}>
              <SelectTrigger
                className="h-8 w-full bg-background/80 md:w-[148px]"
                data-testid="chat-workspace-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {workspaceOptions.map((workspace) => (
                  <SelectItem
                    key={workspace.value}
                    value={workspace.value}
                    data-testid={`chat-workspace-${workspace.value}`}
                  >
                    {workspace.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ChatGovernanceControls compact {...chatGovernanceControlsProps} />
            {showDesktopActionMenu && (
              <ChatActionsMenu compact {...chatActionsMenuProps} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

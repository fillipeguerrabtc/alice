import { type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatActionsMenu } from './ChatActionsMenu';
import { ChatIdentityMenu } from './ChatIdentityMenu';

type ChatActionsMenuProps = ComponentProps<typeof ChatActionsMenu>;
type ChatIdentityMenuProps = ComponentProps<typeof ChatIdentityMenu>;

type ChatHeaderSectionProps = {
  chatActionsMenuProps: ChatActionsMenuProps;
  chatIdentityMenuProps: ChatIdentityMenuProps;
  isMobile: boolean;
  onOpenMobileDrawer: () => void;
  onToggleSidebar: () => void;
  showDesktopActionMenu: boolean;
  sidebarOpen: boolean;
};

export function ChatHeaderSection({
  chatActionsMenuProps,
  chatIdentityMenuProps,
  isMobile,
  onOpenMobileDrawer,
  onToggleSidebar,
  showDesktopActionMenu,
  sidebarOpen,
}: ChatHeaderSectionProps) {
  return (
    <div className="safe-area-inset-top bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/55">
      <div className="mx-auto flex w-full max-w-6xl min-w-0 items-center justify-between gap-3 px-3 py-2.5 md:px-5 md:py-3">
        <div className="flex min-w-0 items-center gap-2">
          {isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMobileDrawer}
              className="h-9 w-9 rounded-full border border-border/45 bg-background/78 shadow-sm"
              data-testid="button-mobile-menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="h-9 w-9 rounded-full border border-border/45 bg-background/78 shadow-sm"
              data-testid="button-toggle-sidebar"
            >
              {sidebarOpen ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          )}

          <ChatIdentityMenu {...chatIdentityMenuProps} />
        </div>

        <div className="flex shrink-0 items-center gap-2 overflow-hidden">
          {showDesktopActionMenu && (
            <ChatActionsMenu compact={isMobile} {...chatActionsMenuProps} />
          )}
        </div>
      </div>
    </div>
  );
}

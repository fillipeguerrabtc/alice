import { type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight, Menu, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <div className="safe-area-inset-top border-b border-border/60 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background)/0.92)_68%,hsl(var(--background)/0.84)_100%)] backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-3 md:px-5 md:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenMobileDrawer}
                className="mt-0.5 h-9 w-9 rounded-full border border-border/60 bg-background/80 shadow-sm"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="mt-0.5 h-9 w-9 rounded-full border border-border/60 bg-background/80 shadow-sm"
                data-testid="button-toggle-sidebar"
              >
                {sidebarOpen ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight md:text-xl" data-testid="text-chat-title">
                  {conversationId ? t('chat.header.conversationTitle') : t('chat.header.newConversationTitle')}
                </h1>
                <Badge
                  variant="outline"
                  className="hidden rounded-full border-border/70 bg-background/75 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline-flex"
                >
                  <Sparkles className="mr-1 h-3 w-3 text-primary/70" />
                  {modelBadgeLabel}
                </Badge>
              </div>
              <p className="max-w-2xl text-sm leading-5 text-muted-foreground">
                {conversationId
                  ? t('chat.header.conversationDescription')
                  : t('chat.header.newConversationDescription')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-full border-border/70 bg-background/75 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground md:hidden"
            >
              <Sparkles className="mr-1 h-3 w-3 text-primary/70" />
              {modelBadgeLabel}
            </Badge>
            {showDesktopActionMenu && (
              <ChatActionsMenu compact={isMobile} {...chatActionsMenuProps} />
            )}
          </div>
        </div>

        <div className="rounded-[1.35rem] border border-border/60 bg-background/80 p-3 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.35)] backdrop-blur-xl md:p-4">
          <ChatGovernanceControls {...chatGovernanceControlsProps} />
        </div>
      </div>
    </div>
  );
}

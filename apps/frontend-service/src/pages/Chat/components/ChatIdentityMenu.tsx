import { ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHAT_AUTOMATIC_OPTION_VALUE } from '../chat-selection';
import type { ReasoningMode } from '@/lib/reasoning-mode';

type ChatAreaOption = {
  value: string;
  label: string;
};

type ChatAgentOption = {
  value: string;
  label: string;
};

export type ChatIdentityMenuProps = {
  areaOptions: readonly ChatAreaOption[];
  reasoningMode: ReasoningMode;
  reasoningOptions: readonly {
    value: ReasoningMode;
    label: string;
  }[];
  canOverrideReasoningMode: boolean;
  agentOptions: readonly ChatAgentOption[];
  currentAgentLabel: string;
  currentAreaLabel: string;
  hasManualAgentSelection: boolean;
  hasManualAreaSelection: boolean;
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  onAreaChange: (value: string | null) => void;
  onAgentChange: (value: string | null) => void;
  onReasoningModeChange: (value: ReasoningMode) => void;
  modelBadgeLabel: string;
  t: (key: string) => string;
};

function getSelectedOptionLabel(
  options: readonly { value: string; label: string }[],
  selectedValue: string | null,
) {
  const resolvedValue = selectedValue ?? CHAT_AUTOMATIC_OPTION_VALUE;
  return options.find((option) => option.value === resolvedValue)?.label ?? options[0]?.label ?? '';
}

function getTopSummaryItems(options: {
  currentAreaLabel: string;
  currentAgentLabel: string;
  hasManualAreaSelection: boolean;
  hasManualAgentSelection: boolean;
  t: (key: string) => string;
}) {
  return [
    {
      key: 'area',
      label: options.t('chat.identityMenu.currentArea'),
      value: options.currentAreaLabel,
      isManual: options.hasManualAreaSelection,
    },
    {
      key: 'agent',
      label: options.t('chat.identityMenu.currentAgent'),
      value: options.currentAgentLabel,
      isManual: options.hasManualAgentSelection,
    },
  ].filter((item) => item.value.trim().length > 0);
}

export function ChatIdentityMenu({
  areaOptions,
  reasoningMode,
  reasoningOptions,
  canOverrideReasoningMode,
  agentOptions,
  currentAgentLabel,
  currentAreaLabel,
  hasManualAgentSelection,
  hasManualAreaSelection,
  selectedAgentId,
  selectedAreaNamespaceId,
  onAreaChange,
  onAgentChange,
  onReasoningModeChange,
  modelBadgeLabel,
  t,
}: ChatIdentityMenuProps) {
  const selectedAreaLabel = getSelectedOptionLabel(areaOptions, selectedAreaNamespaceId);
  const selectedAgentLabel = getSelectedOptionLabel(agentOptions, selectedAgentId);
  const currentReasoningLabel =
    reasoningOptions.find((option) => option.value === reasoningMode)?.label ?? t('chat.reasoning.auto');
  const topSummaryItems = getTopSummaryItems({
    currentAreaLabel,
    currentAgentLabel,
    hasManualAreaSelection,
    hasManualAgentSelection,
    t,
  });
  const hasManualConversationConfig = Boolean(selectedAreaNamespaceId || selectedAgentId);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 rounded-full px-3 text-sm font-semibold tracking-tight text-foreground hover:bg-accent/70"
            data-testid="button-chat-identity-menu"
            aria-label={t('chat.identityMenu.openMenu')}
          >
            <span className="truncate" data-testid="text-chat-title">
              {t('chat.identityMenu.title')}
            </span>
            {hasManualConversationConfig && (
              <span
                className="h-2 w-2 rounded-full bg-primary/80"
                aria-label={t('chat.identityMenu.manualConfigActive')}
              />
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={10}
          className="w-[18rem] rounded-2xl border-border/60 bg-background/95 p-2 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl"
          data-testid="menu-chat-identity"
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-semibold text-foreground">{t('chat.identityMenu.title')}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary/70" />
              <span className="truncate">{modelBadgeLabel}</span>
            </div>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
            {t('chat.selectionControls.reasoning')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={reasoningMode} onValueChange={(value) => onReasoningModeChange(value as ReasoningMode)}>
            {reasoningOptions.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                disabled={!canOverrideReasoningMode && option.value !== 'auto'}
                className="rounded-xl px-8 py-2.5"
                data-testid={`chat-identity-reasoning-${option.value}`}
              >
                <span className="truncate">{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-xl px-2 py-2.5" data-testid="chat-identity-area-trigger">
              <span>{t('chat.selectionControls.area')}</span>
              <span className="ml-auto max-w-[8rem] truncate text-xs font-normal text-muted-foreground">
                {selectedAreaLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[16rem] rounded-2xl border-border/60 bg-background/95 p-2 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl">
              <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
                {t('chat.selectionControls.area')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedAreaNamespaceId ?? CHAT_AUTOMATIC_OPTION_VALUE}
                onValueChange={(value) => onAreaChange(value === CHAT_AUTOMATIC_OPTION_VALUE ? null : value)}
              >
                {areaOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="rounded-xl px-8 py-2.5"
                    data-testid={`chat-identity-area-${option.value}`}
                  >
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-xl px-2 py-2.5" data-testid="chat-identity-agent-trigger">
              <span>{t('chat.selectionControls.agent')}</span>
              <span className="ml-auto max-w-[8rem] truncate text-xs font-normal text-muted-foreground">
                {selectedAgentLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[18rem] rounded-2xl border-border/60 bg-background/95 p-2 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl">
              <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
                {t('chat.selectionControls.agent')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedAgentId ?? CHAT_AUTOMATIC_OPTION_VALUE}
                onValueChange={(value) => onAgentChange(value === CHAT_AUTOMATIC_OPTION_VALUE ? null : value)}
              >
                {agentOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="rounded-xl px-8 py-2.5"
                    data-testid={`chat-identity-agent-${option.value}`}
                  >
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('chat.selectionControls.reasoning')}:</span>{' '}
            {currentReasoningLabel}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {topSummaryItems.length > 0 && (
        <div
          className="hidden min-w-0 flex-wrap items-center gap-1.5 md:flex"
          data-testid="chat-current-routing-summary"
          aria-label={t('chat.identityMenu.currentStateSummary')}
        >
          {topSummaryItems.map((item) => (
            <span
              key={item.key}
              className="inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              <span className="shrink-0 text-muted-foreground/70">{item.label}:</span>
              <span className="truncate text-foreground">{item.value}</span>
              {item.isManual && (
                <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                  {t('chat.identityMenu.manualBadge')}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

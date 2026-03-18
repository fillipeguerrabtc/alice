import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

type ChatGovernanceControlsProps = {
  areaOptions: readonly ChatAreaOption[];
  reasoningMode: ReasoningMode;
  reasoningOptions: readonly {
    value: ReasoningMode;
    label: string;
  }[];
  canOverrideReasoningMode: boolean;
  agentOptions: readonly ChatAgentOption[];
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  onAreaChange: (value: string | null) => void;
  onAgentChange: (value: string | null) => void;
  onReasoningModeChange: (value: ReasoningMode) => void;
  t: (key: string) => string;
};

export function ChatGovernanceControls({
  areaOptions,
  reasoningMode,
  reasoningOptions,
  canOverrideReasoningMode,
  agentOptions,
  selectedAgentId,
  selectedAreaNamespaceId,
  onAreaChange,
  onAgentChange,
  onReasoningModeChange,
  t,
}: ChatGovernanceControlsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.95fr)]">
      <div className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          {t('chat.selectionControls.area')}
        </Label>
        <Select
          value={selectedAreaNamespaceId ?? CHAT_AUTOMATIC_OPTION_VALUE}
          onValueChange={(value) => onAreaChange(value === CHAT_AUTOMATIC_OPTION_VALUE ? null : value)}
        >
          <SelectTrigger
            className="h-11 rounded-xl border-border/70 bg-background/80 px-3 text-sm shadow-sm"
            aria-label={t('chat.selectionControls.area')}
            data-testid="chat-area-select"
          >
            <SelectValue placeholder={t('chat.selectionControls.areaPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {areaOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          {t('chat.selectionControls.agent')}
        </Label>
        <Select
          value={selectedAgentId ?? CHAT_AUTOMATIC_OPTION_VALUE}
          onValueChange={(value) => onAgentChange(value === CHAT_AUTOMATIC_OPTION_VALUE ? null : value)}
        >
          <SelectTrigger
            className="h-11 rounded-xl border-border/70 bg-background/80 px-3 text-sm shadow-sm"
            aria-label={t('chat.selectionControls.agent')}
            data-testid="chat-agent-select"
          >
            <SelectValue placeholder={t('chat.selectionControls.agentPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {agentOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          {t('chat.selectionControls.reasoning')}
        </Label>
        <Select value={reasoningMode} onValueChange={(value) => onReasoningModeChange(value as ReasoningMode)}>
          <SelectTrigger
            className="h-11 rounded-xl border-border/70 bg-background/80 px-3 text-sm shadow-sm"
            aria-label={t('chat.selectionControls.reasoning')}
            data-testid="chat-reasoning-select"
          >
            <SelectValue placeholder={t('chat.selectionControls.reasoningPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {reasoningOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={!canOverrideReasoningMode && option.value !== 'auto'}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelectDropdown } from '@/components/trading';
import type { ReasoningMode } from '@/lib/reasoning-mode';

type ChatApprovalPolicyOption = {
  value: string;
  label: string;
};

type ChatAgentOption = {
  value: string;
  label: string;
};

type ChatRoutingDebug = {
  source?: string | null;
  score?: number | null;
  threshold?: number | null;
} | null;

type ChatGovernanceControlsProps = {
  compact?: boolean;
  showGovernanceControls: boolean;
  conversationId?: string;
  approvalPolicyForSelect: string;
  approvalPolicyOptions: readonly ChatApprovalPolicyOption[];
  routingMode: 'auto' | 'manual';
  reasoningMode: ReasoningMode;
  canOverrideReasoningMode: boolean;
  routingLabel: string;
  routingSourceLabel: string;
  routingDebug: ChatRoutingDebug;
  routingAgentIds: string[];
  agentOptions: readonly ChatAgentOption[];
  onApprovalPolicyChange: (value: string) => void;
  onReasoningModeChange: (value: ReasoningMode) => void;
  onRoutingModeChange: (value: 'auto' | 'manual') => void;
  onRoutingAgentIdsChange: (values: string[]) => void;
  t: (key: string) => string;
};

export function ChatGovernanceControls({
  compact = false,
  showGovernanceControls,
  conversationId,
  approvalPolicyForSelect,
  approvalPolicyOptions,
  routingMode,
  reasoningMode,
  canOverrideReasoningMode,
  routingLabel,
  routingSourceLabel,
  routingDebug,
  routingAgentIds,
  agentOptions,
  onApprovalPolicyChange,
  onReasoningModeChange,
  onRoutingModeChange,
  onRoutingAgentIdsChange,
  t,
}: ChatGovernanceControlsProps) {
  if (!showGovernanceControls) {
    return null;
  }

  if (compact) {
    return (
      <>
        {conversationId && (
          <Select value={approvalPolicyForSelect} onValueChange={onApprovalPolicyChange}>
            <SelectTrigger className="h-6 w-[120px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {approvalPolicyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={routingMode} onValueChange={(value) => onRoutingModeChange(value as 'auto' | 'manual')}>
          <SelectTrigger className="h-6 w-[110px] text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('chat.routing.auto')}</SelectItem>
            <SelectItem value="manual">{t('chat.routing.manual')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reasoningMode} onValueChange={(value) => onReasoningModeChange(value as ReasoningMode)}>
          <SelectTrigger className="h-6 w-[128px] text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('chat.reasoning.auto')}</SelectItem>
            {canOverrideReasoningMode && (
              <>
                <SelectItem value="thinking">{t('chat.reasoning.thinking')}</SelectItem>
                <SelectItem value="non_thinking">{t('chat.reasoning.nonThinking')}</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        <Badge
          variant="outline"
          className="h-6 max-w-[120px] truncate text-[10px]"
          title={routingSourceLabel}
        >
          {routingLabel}
        </Badge>
        {routingMode === 'manual' && (
          <div className="min-w-[180px]">
            <MultiSelectDropdown
              label={t('chat.routing.agentsLabel')}
              options={[...agentOptions]}
              selectedValues={routingAgentIds}
              onChange={onRoutingAgentIdsChange}
              emptyLabel={t('chat.routing.noAgents')}
              placeholder={t('chat.routing.selectAgents')}
              selectedCountLabel={t('chat.routing.selectedCount')}
              selectAllLabel={t('chat.routing.selectAll')}
              clearLabel={t('chat.routing.clearSelection')}
              disabled={agentOptions.length === 0}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {conversationId && (
        <>
          <Label className="text-xs text-muted-foreground">
            {t('chat.approvalPolicy.label')}
          </Label>
          <Select value={approvalPolicyForSelect} onValueChange={onApprovalPolicyChange}>
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {approvalPolicyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      <Label className="text-xs text-muted-foreground">
        {t('chat.routing.label')}
      </Label>
      <Select value={routingMode} onValueChange={(value) => onRoutingModeChange(value as 'auto' | 'manual')}>
        <SelectTrigger className="h-8 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t('chat.routing.auto')}</SelectItem>
          <SelectItem value="manual">{t('chat.routing.manual')}</SelectItem>
        </SelectContent>
      </Select>
      <Label className="text-xs text-muted-foreground">
        {t('chat.reasoning.label')}
      </Label>
      <Select value={reasoningMode} onValueChange={(value) => onReasoningModeChange(value as ReasoningMode)}>
        <SelectTrigger className="h-8 w-[172px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t('chat.reasoning.auto')}</SelectItem>
          {canOverrideReasoningMode && (
            <>
              <SelectItem value="thinking">{t('chat.reasoning.thinking')}</SelectItem>
              <SelectItem value="non_thinking">{t('chat.reasoning.nonThinking')}</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      <Badge
        variant="outline"
        className="h-8 max-w-[220px] truncate"
        title={routingDebug
          ? `source=${routingDebug.source ?? routingSourceLabel}; score=${routingDebug.score ?? '-'}; threshold=${routingDebug.threshold ?? '-'}`
          : routingSourceLabel}
      >
        {routingLabel}
      </Badge>
      {routingMode === 'manual' && (
        <div className="min-w-[220px]">
          <MultiSelectDropdown
            label={t('chat.routing.agentsLabel')}
            options={[...agentOptions]}
            selectedValues={routingAgentIds}
            onChange={onRoutingAgentIdsChange}
            emptyLabel={t('chat.routing.noAgents')}
            placeholder={t('chat.routing.selectAgents')}
            selectedCountLabel={t('chat.routing.selectedCount')}
            selectAllLabel={t('chat.routing.selectAll')}
            clearLabel={t('chat.routing.clearSelection')}
            disabled={agentOptions.length === 0}
          />
        </div>
      )}
    </>
  );
}

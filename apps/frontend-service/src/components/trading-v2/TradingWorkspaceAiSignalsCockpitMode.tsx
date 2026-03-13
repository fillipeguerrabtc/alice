import { useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { AlertTriangle, ArrowRightLeft, ChevronDown, ChevronUp, CircleCheck, CircleDashed, CircleX, FlaskConical, ShieldX } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/trading/MultiSelectDropdown';
import { SignalApprovalPanel } from '@/components/trading/SignalApprovalPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { ReasoningMode } from '@/lib/reasoning-mode';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type {
  TradingAutoRun,
  TradingAutoRunDetail,
  TradingCandidate,
} from '@/services/api/trading';
import type { TradingWorkspaceEnvironmentMode } from './types';

type SignalsCockpitStateCategory = 'blocked' | 'no_trade' | 'signal_generated' | 'executed' | 'failed' | 'running';

type TradingCockpitSignal = {
  confidence: number;
  id: string;
  metadata: {
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    dataSources?: {
      news?: boolean;
      orderBook?: boolean;
      trainingData?: boolean;
    };
    marketCondition?: string;
    techniques?: unknown;
    validationStatus?: 'pending' | 'validated' | 'failed';
    [key: string]: unknown;
  };
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol: string;
};

type TradingWorkspaceAiSignalsCockpitModeProps = {
  activeAutoRunDetail: TradingAutoRunDetail | undefined;
  activeAutoRunId: string | null;
  allowedModes: string[];
  autoMix: boolean;
  autoModeOptions: Array<{ label: string; value: string }>;
  autoSelectAllAssets: boolean;
  autoSelectedAssetKeys: string[];
  autoSignalAssetOptions: Array<{ label: string; value: string }>;
  autoUniverseScope: 'futures' | 'spot' | 'margin' | 'all';
  canOverrideReasoningMode: boolean;
  environmentMode: TradingWorkspaceEnvironmentMode;
  hasAutoSignalAssetsError: boolean;
  isLoadingAutoSignalAssets: boolean;
  isLoadingSignals: boolean;
  locale: string;
  marketType: 'futures' | 'spot' | 'margin';
  onAllowedModesChange: (values: string[]) => void;
  onAutoMixChange: (value: boolean) => void;
  onAutoSelectAllAssetsChange: (value: boolean) => void;
  onAutoSelectedAssetKeysChange: (values: string[]) => void;
  onAutoUniverseScopeChange: (value: 'futures' | 'spot' | 'margin' | 'all') => void;
  onOpenGeneratedSignal: (signalId: string | null) => void;
  onOpenSignalsPanel: () => void;
  onReasoningModeChange: (value: ReasoningMode) => void;
  onRunAutoNow: () => void;
  onSelectAutoRun: (runId: string) => void;
  reasoningMode: ReasoningMode;
  reasoningModeOptions: Array<{ label: string; value: ReasoningMode }>;
  renderSignalTypeBadge: (signalType: TradingCockpitSignal['signalType']) => ReactNode;
  selectedSignal: TradingCockpitSignal | null;
  signalAutoRunPending: boolean;
  signalAutoRuns: TradingAutoRun[];
  signals: TradingCockpitSignal[];
  t: TFunction;
  timeZone: string;
  topTradingCandidates: TradingCandidate[];
};

const REASON_CODE_TEXT: Record<string, string> = {
  TRADING_SCOPE_REQUIRED: 'Escopo de Trading obrigatório não configurado para executar o run.',
  UNVALIDATED: 'Candidato ainda sem validação estatística mínima (DSR/PBO).',
  LIQUIDITY_CONSTRAINT: 'Sem liquidez mínima: spread alargado ou profundidade insuficiente.',
  GUARDRAIL_BLOCKED: 'Guardrails bloquearam a execução por risco fora da política.',
  NO_CANDIDATES: 'Nenhum candidato elegível foi encontrado no escopo selecionado.',
  NO_EDGE: 'Edge líquido insuficiente para abrir operação com segurança.',
  UNEXPECTED_ERROR: 'Falha inesperada durante o processamento do run.',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveCockpitStateCategory(params: {
  linkedSignal: TradingCockpitSignal | null;
  latestRun: TradingAutoRun | null;
}): SignalsCockpitStateCategory {
  const { latestRun, linkedSignal } = params;

  if (!latestRun) {
    if (linkedSignal?.metadata?.approvalStatus === 'approved') return 'executed';
    if (linkedSignal) return 'signal_generated';
    return 'running';
  }

  if (latestRun.status === 'blocked') return 'blocked';
  if (latestRun.status === 'no_trade') return 'no_trade';
  if (latestRun.status === 'failed' || latestRun.status === 'cancelled') return 'failed';
  if (latestRun.status === 'succeeded') {
    return linkedSignal?.metadata?.approvalStatus === 'approved' ? 'executed' : 'signal_generated';
  }

  return 'running';
}

function resolveStateBadge(category: SignalsCockpitStateCategory): {
  icon: typeof CircleDashed;
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (category === 'blocked') {
    return { icon: ShieldX, label: 'blocked', variant: 'secondary' };
  }
  if (category === 'no_trade') {
    return { icon: CircleDashed, label: 'no_trade', variant: 'outline' };
  }
  if (category === 'signal_generated') {
    return { icon: CircleCheck, label: 'signal_generated', variant: 'default' };
  }
  if (category === 'executed') {
    return { icon: ArrowRightLeft, label: 'executed', variant: 'default' };
  }
  if (category === 'failed') {
    return { icon: CircleX, label: 'failed', variant: 'destructive' };
  }
  return { icon: CircleDashed, label: 'running', variant: 'outline' };
}

function resolveReasonText(machineReasonCode: string | null, providedReason: string | null): string {
  if (providedReason) {
    return providedReason;
  }
  if (!machineReasonCode) {
    return 'Sem reason code explícito para este run.';
  }
  return REASON_CODE_TEXT[machineReasonCode] ?? 'Reason code sem descrição cadastrada.';
}

export function TradingWorkspaceAiSignalsCockpitMode({
  activeAutoRunDetail,
  activeAutoRunId,
  allowedModes,
  autoMix,
  autoModeOptions,
  autoSelectAllAssets,
  autoSelectedAssetKeys,
  autoSignalAssetOptions,
  autoUniverseScope,
  canOverrideReasoningMode,
  environmentMode,
  hasAutoSignalAssetsError,
  isLoadingAutoSignalAssets,
  isLoadingSignals,
  locale,
  marketType,
  onAllowedModesChange,
  onAutoMixChange,
  onAutoSelectAllAssetsChange,
  onAutoSelectedAssetKeysChange,
  onAutoUniverseScopeChange,
  onOpenGeneratedSignal,
  onOpenSignalsPanel,
  onReasoningModeChange,
  onRunAutoNow,
  onSelectAutoRun,
  reasoningMode,
  reasoningModeOptions,
  renderSignalTypeBadge,
  selectedSignal,
  signalAutoRunPending,
  signalAutoRuns,
  signals,
  t,
  timeZone,
  topTradingCandidates,
}: TradingWorkspaceAiSignalsCockpitModeProps) {
  const [isGovernanceOpen, setIsGovernanceOpen] = useState(false);
  const latestRun = activeAutoRunDetail?.run?.runType === 'signal_auto'
    ? activeAutoRunDetail.run
    : signalAutoRuns[0] ?? null;

  const latestRunDetail = activeAutoRunDetail?.run?.id === latestRun?.id
    ? activeAutoRunDetail
    : undefined;
  const latestDecision = latestRunDetail?.decisions?.[0] ?? null;
  const entryPayload = asRecord(latestDecision?.entryPayload);
  const linkedSignalId = latestDecision?.tradingSignalId ?? latestRun?.tradingSignalId ?? null;
  const linkedSignal = (linkedSignalId
    ? signals.find((signal) => signal.id === linkedSignalId)
    : null)
    ?? selectedSignal
    ?? signals[0]
    ?? null;

  const stateCategory = resolveCockpitStateCategory({ linkedSignal, latestRun });
  const stateBadge = resolveStateBadge(stateCategory);
  const StateIcon = stateBadge.icon;

  const entryReasonCode = asString(entryPayload?.noTradeReasonCode);
  const entryReasonHuman = asString(entryPayload?.noTradeReasonHuman);
  const machineReasonCode = latestRun?.terminalReasonCode ?? entryReasonCode;
  const userReasonText = resolveReasonText(machineReasonCode, entryReasonHuman);
  const nextAction = asString(entryPayload?.nextAction);
  const candidateCount = latestDecision?.candidateIds?.length ?? 0;
  const approvedCandidateCount = latestDecision?.approved ? 1 : 0;
  const confidenceCalibrated = asNumber(entryPayload?.confidenceCalibrated);

  const techniques = Array.isArray(linkedSignal?.metadata?.techniques)
    ? linkedSignal?.metadata?.techniques.filter((item): item is string => typeof item === 'string')
    : [];
  const entryThresholds = asRecord(entryPayload?.thresholdsUsed);
  const regime = asString(entryThresholds?.regimeBucket)
    ?? asString(linkedSignal?.metadata?.marketCondition)
    ?? '-';

  const isDirectionalSignal = linkedSignal?.signalType === 'entry_long' || linkedSignal?.signalType === 'entry_short';
  const hasLinkedSignal = Boolean(linkedSignal?.id);

  const isNoTradeLikeSignal = linkedSignal?.signalType === 'neutral' || linkedSignal?.signalType === 'hold';

  const openGovernancePanel = (signalId: string | null) => {
    onOpenGeneratedSignal(signalId);
    onOpenSignalsPanel();
    setIsGovernanceOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Control Panel</CardTitle>
            <CardDescription>
              Configuração do run de sinais IA para ambiente {environmentMode === 'demo' ? 'Demo' : 'Real'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="ai-signals-v2-auto-mix"
                    checked={autoMix}
                    onCheckedChange={onAutoMixChange}
                  />
                  <Label htmlFor="ai-signals-v2-auto-mix" className="text-sm cursor-pointer">Auto Mix</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, usa escopo amplo de mercados/ativos e modos permitidos.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Escopo do universo</Label>
                <Select
                  value={autoUniverseScope}
                  onValueChange={(value) => onAutoUniverseScopeChange(value as 'futures' | 'spot' | 'margin' | 'all')}
                  disabled={autoMix}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="futures">Futures</SelectItem>
                    <SelectItem value="spot">Spot</SelectItem>
                    <SelectItem value="margin">Margin</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Modalidades permitidas</Label>
                <MultiSelectDropdown
                  label="Modalidades"
                  options={autoModeOptions}
                  selectedValues={allowedModes}
                  onChange={onAllowedModesChange}
                  placeholder={autoMix ? 'Todas (Auto Mix ativo)' : 'Selecionar...'}
                  disabled={autoMix}
                />
              </div>

              <div className="space-y-1 md:col-span-2 xl:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Ativos do universo</Label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ai-signals-v2-assets-all" className="text-xs text-muted-foreground cursor-pointer">
                      Todos os ativos
                    </Label>
                    <Switch
                      id="ai-signals-v2-assets-all"
                      checked={autoMix ? true : autoSelectAllAssets}
                      onCheckedChange={onAutoSelectAllAssetsChange}
                      disabled={autoMix}
                    />
                  </div>
                </div>
                <MultiSelectDropdown
                  label="Ativos"
                  options={autoSignalAssetOptions}
                  selectedValues={autoSelectedAssetKeys}
                  onChange={onAutoSelectedAssetKeysChange}
                  placeholder={
                    autoMix
                      ? 'Todos (Auto Mix ativo)'
                      : autoSelectAllAssets
                        ? 'Todos os ativos habilitados'
                        : 'Selecionar ativos...'
                  }
                  disabled={autoMix || autoSelectAllAssets || isLoadingAutoSignalAssets}
                />
                {hasAutoSignalAssetsError ? (
                  <p className="text-xs text-destructive">Falha ao carregar catálogo de ativos do Auto Engine.</p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('trading.signals.reasoning.label')}</Label>
                <Select
                  value={reasoningMode}
                  onValueChange={(value) => onReasoningModeChange(value as ReasoningMode)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reasoningModeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canOverrideReasoningMode ? (
                  <p className="text-xs text-muted-foreground">{t('trading.signals.reasoning.adminOnlyHint')}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onRunAutoNow} disabled={signalAutoRunPending}>
                Reexecutar run com escopo atual
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsGovernanceOpen(true)}>
                Abrir painel completo de sinais
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Latest Run</CardTitle>
            <CardDescription>Estado terminal e classificação semântica do run mais recente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <StateIcon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">State category</span>
              </div>
              <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
            </div>
            {latestRun ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Run ID</div>
                    <div className="font-medium">{latestRun.id.slice(0, 12)}...</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Status</div>
                    <div className="font-medium">{latestRun.status}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Market</div>
                    <div className="font-medium">{marketType}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Finalizado em</div>
                    <div className="font-medium">
                      {latestRun.finishedAt
                        ? formatDateTime(latestRun.finishedAt, { locale, timeZone })
                        : 'em execução'}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">machine-readable reason code:</span>{' '}
                    <span className="font-medium">{machineReasonCode ?? 'none'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">user-readable explanation:</span>{' '}
                    <span>{userReasonText}</span>
                  </div>
                  {nextAction ? (
                    <div>
                      <span className="text-muted-foreground">Próxima ação sugerida:</span>{' '}
                      <span>{nextAction}</span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState title="Nenhum run disponível" description="Execute um run para iniciar o cockpit." className="py-6" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Latest Signal</CardTitle>
            <CardDescription>Sinal mais recente ligado ao run e classificação operacional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isLoadingSignals ? (
              <p className="text-muted-foreground">Carregando sinais...</p>
            ) : linkedSignal ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderSignalTypeBadge(linkedSignal.signalType)}
                    <span className="font-medium">{linkedSignal.symbol}</span>
                  </div>
                  <Badge variant="outline">{linkedSignal.metadata?.validationStatus ?? 'pending'}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Confiança</div>
                    <div className="font-medium">
                      {formatNumber(Math.max(0, Math.min(1, linkedSignal.confidence)) * 100, locale, { maximumFractionDigits: 0 })}%
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Aprovação</div>
                    <div className="font-medium">{linkedSignal.metadata?.approvalStatus ?? 'pending'}</div>
                  </div>
                </div>

                {isNoTradeLikeSignal ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900">
                    Neutral/Hold não representa directional signal útil para execução. Trate como contexto de decisão ou treinamento.
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenGeneratedSignal(linkedSignal.id)}
                >
                  Abrir sinal completo
                </Button>
              </>
            ) : (
              <EmptyState title="Sem sinal vinculado" description="O último run ainda não produziu sinal disponível." className="py-6" />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Blocked / No-trade Explanation</CardTitle>
            <CardDescription>Explicação explícita para runs sem trade executável.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {stateCategory === 'blocked' || stateCategory === 'no_trade' || stateCategory === 'failed' ? (
              <>
                <div className="flex items-center gap-2 rounded-md border p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="font-medium">{stateCategory}</span>
                </div>
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">machine-readable reason code:</span>{' '}
                    <span className="font-medium">{machineReasonCode ?? 'none'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">user-readable explanation:</span>{' '}
                    <span>{userReasonText}</span>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="Sem bloqueio ativo"
                description="Último run não terminou em blocked/no_trade/failed."
                className="py-6"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Evidence Summary</CardTitle>
            <CardDescription>Evidências mínimas para auditoria e explicação operacional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">candidateCount</div>
                <div className="font-medium">{candidateCount}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">approvedCandidateCount</div>
                <div className="font-medium">{approvedCandidateCount}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">confidenceCalibrated</div>
                <div className="font-medium">
                  {confidenceCalibrated != null
                    ? formatNumber(confidenceCalibrated, locale, { maximumFractionDigits: 4 })
                    : '-'}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">ragEvidenceIds</div>
                <div className="font-medium">{latestDecision?.ragEvidenceIds?.length ?? 0}</div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Top candidates atuais</p>
              {topTradingCandidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum candidate disponível.</p>
              ) : (
                <div className="space-y-2">
                  {topTradingCandidates.slice(0, 3).map((candidate) => (
                    <div key={candidate.id} className="rounded-md border p-2 text-xs">
                      <div className="font-medium">{candidate.strategyKey} · {candidate.timeframe}</div>
                      <div className="text-muted-foreground">
                        side={candidate.side} · edge={formatNumber(Number(candidate.expectedEdge ?? 0), locale, { maximumFractionDigits: 6 })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lineage Summary</CardTitle>
            <CardDescription>Contexto mínimo de strategy, regime, validação e fontes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Strategy / technique</div>
                <div className="font-medium">{techniques.length > 0 ? techniques.slice(0, 3).join(', ') : 'n/a'}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Regime</div>
                <div className="font-medium">{regime}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Confidence</div>
                <div className="font-medium">
                  {confidenceCalibrated != null
                    ? formatNumber(confidenceCalibrated, locale, { maximumFractionDigits: 4 })
                    : linkedSignal
                      ? formatNumber(linkedSignal.confidence, locale, { maximumFractionDigits: 4 })
                      : '-'}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Validation status</div>
                <div className="font-medium">{linkedSignal?.metadata?.validationStatus ?? 'pending'}</div>
              </div>
            </div>

            <div className="rounded-md border p-3 text-xs space-y-1">
              <div className="text-muted-foreground">Evidence source summary</div>
              <div>
                dataSources: {linkedSignal?.metadata?.dataSources
                  ? Object.entries(linkedSignal.metadata.dataSources)
                    .filter(([, enabled]) => Boolean(enabled))
                    .map(([source]) => source)
                    .join(', ') || 'none'
                  : 'none'}
              </div>
              <div>ragEvidenceIds: {latestDecision?.ragEvidenceIds?.length ?? 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">CTA Actions</CardTitle>
          <CardDescription>Handoff explícito para Demo, Training dataset e re-run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!hasLinkedSignal || !isDirectionalSignal}
              onClick={() => openGovernancePanel(linkedSignal?.id ?? null)}
            >
              Enviar para Demo
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasLinkedSignal}
              onClick={() => openGovernancePanel(linkedSignal?.id ?? null)}
            >
              Enviar para Training dataset
            </Button>
            <Button type="button" onClick={onRunAutoNow} disabled={signalAutoRunPending}>
              Re-run com ajustes de escopo
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            As ações de Demo/Training usam o fluxo real de aprovação do painel de sinais, sem bypass de guardrails.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run History</CardTitle>
          <CardDescription>Últimos runs para navegação rápida de auditoria.</CardDescription>
        </CardHeader>
        <CardContent>
          {signalAutoRuns.length === 0 ? (
            <EmptyState title="Nenhum run encontrado" className="py-6" />
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {signalAutoRuns.slice(0, 20).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onSelectAutoRun(run.id)}
                  className={`w-full border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/40 ${activeAutoRunId === run.id ? 'bg-muted/50' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{run.id.slice(0, 12)}...</span>
                    <Badge variant="outline">{run.status}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {formatDateTime(run.createdAt, { locale, timeZone })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Governança de Aprovação</CardTitle>
          <CardDescription>
            Ações finais de aprovação/rejeição continuam no painel dedicado de `SignalApprovalPanel`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Use o atalho abaixo para abrir a trilha completa de aprovação, envio para Demo e envio para Training dataset.
          </p>
          <Button type="button" variant="outline" onClick={() => setIsGovernanceOpen(true)}>
            <FlaskConical className="mr-2 h-4 w-4" />
            Abrir trilha completa de aprovação
          </Button>
        </CardContent>
      </Card>

      <Collapsible open={isGovernanceOpen} onOpenChange={setIsGovernanceOpen}>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Governança avançada de sinais</CardTitle>
                <CardDescription>
                  Fluxo real de aprovação/rejeição, envio para Demo e envio para Training dataset.
                </CardDescription>
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {isGovernanceOpen ? 'Recolher' : 'Expandir'}
                  {isGovernanceOpen ? (
                    <ChevronUp className="ml-1 h-4 w-4" />
                  ) : (
                    <ChevronDown className="ml-1 h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <SignalApprovalPanel marketType={marketType} />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

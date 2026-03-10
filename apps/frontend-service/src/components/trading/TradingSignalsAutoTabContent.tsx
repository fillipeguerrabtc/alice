import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type {
  TradingAutoRun,
  TradingAutoRunDetail,
  TradingCandidate,
} from '@/services/api/trading';
import { MultiSelectDropdown } from './MultiSelectDropdown';

type TradingSignalForValidation = {
  id: string;
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  suggestedPrice?: number | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  suggestedSize?: number | null;
};

type TradingSignalsAutoTabContentProps = {
  activeAutoRunDetail: TradingAutoRunDetail | undefined;
  activeAutoRunId: string | null;
  allowedModes: string[];
  autoMix: boolean;
  autoModeOptions: Array<{ label: string; value: string }>;
  autoSelectAllAssets: boolean;
  autoSelectedAssetKeys: string[];
  autoSignalAssetOptions: Array<{ label: string; value: string }>;
  autoUniverseScope: 'futures' | 'spot' | 'margin' | 'all';
  formatDecisionSummary: (payload?: Record<string, unknown> | null) => string | null;
  hasAutoSignalAssetsError: boolean;
  isLoadingAutoSignalAssets: boolean;
  locale: string;
  onAllowedModesChange: (values: string[]) => void;
  onAutoMixChange: (value: boolean) => void;
  onAutoSelectAllAssetsChange: (value: boolean) => void;
  onAutoSelectedAssetKeysChange: (values: string[]) => void;
  onAutoUniverseScopeChange: (value: 'futures' | 'spot' | 'margin' | 'all') => void;
  onOpenGeneratedSignal: (signalId: string | null) => void;
  onOpenSignalsPanel: () => void;
  onRunAutoNow: () => void;
  onSelectAutoRun: (runId: string) => void;
  signalAutoRunPending: boolean;
  signalAutoRuns: TradingAutoRun[];
  signals: TradingSignalForValidation[];
  timeZone: string;
  topTradingCandidates: TradingCandidate[];
};

export function TradingSignalsAutoTabContent({
  activeAutoRunDetail,
  activeAutoRunId,
  allowedModes,
  autoMix,
  autoModeOptions,
  autoSelectAllAssets,
  autoSelectedAssetKeys,
  autoSignalAssetOptions,
  autoUniverseScope,
  formatDecisionSummary,
  hasAutoSignalAssetsError,
  isLoadingAutoSignalAssets,
  locale,
  onAllowedModesChange,
  onAutoMixChange,
  onAutoSelectAllAssetsChange,
  onAutoSelectedAssetKeysChange,
  onAutoUniverseScopeChange,
  onOpenGeneratedSignal,
  onOpenSignalsPanel,
  onRunAutoNow,
  onSelectAutoRun,
  signalAutoRunPending,
  signalAutoRuns,
  signals,
  timeZone,
  topTradingCandidates,
}: TradingSignalsAutoTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Sinais IA (Auto)</CardTitle>
          <CardDescription>Fluxo multi-asset enterprise com guardrails institucionais e decisao automatica por mercado/ativo/tecnica.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            O Auto Engine analisa microestrutura, arbitragem e contexto RAG por intent/regime para decidir se há trade.
            Quando <strong>Auto Mix</strong> está ativo, a execução usa análise completa enterprise:
            todos os mercados, todos os ativos e todas as modalidades habilitadas.
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-mix-switch"
                checked={autoMix}
                onCheckedChange={onAutoMixChange}
              />
              <Label htmlFor="auto-mix-switch" className="text-sm cursor-pointer">
                Auto Mix
              </Label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Escopo do universo</Label>
              <Select value={autoUniverseScope} onValueChange={(v) => onAutoUniverseScopeChange(v as typeof autoUniverseScope)} disabled={autoMix}>
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
                placeholder={autoMix ? 'Todas (Auto Mix ativo)' : 'Selecionar…'}
                disabled={autoMix}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Ativos do universo</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="auto-assets-all-switch" className="text-xs text-muted-foreground cursor-pointer">
                    Todos os ativos
                  </Label>
                  <Switch
                    id="auto-assets-all-switch"
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
                <p className="text-xs text-destructive">Falha ao carregar catalogo de ativos do Auto Engine.</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            {topTradingCandidates.slice(0, 5).map((candidate) => (
              <div key={candidate.id} className="border rounded p-2 text-sm">
                <div className="font-medium">{candidate.strategyKey} · {candidate.timeframe}</div>
                <div>Side: {candidate.side}</div>
                <div>Edge: {formatNumber(Number(candidate.expectedEdge ?? 0), locale)}</div>
                <div>Guardrails: {(Array.isArray(candidate.riskFlags) ? candidate.riskFlags : []).length > 0 ? 'restrito' : 'aprovável'}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRunAutoNow} disabled={signalAutoRunPending}>
              {signalAutoRunPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Rodar Auto agora
            </Button>
            <Button variant="outline" onClick={onOpenSignalsPanel}>Ir para painel de sinais</Button>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Histórico de runs (últimos 30)</div>
            {signalAutoRuns.length === 0 ? (
              <EmptyState title="Nenhum run encontrado." className="py-3 [&>p]:text-xs" />
            ) : (
              <div className="max-h-52 overflow-y-auto border rounded">
                {signalAutoRuns.map((run) => {
                  const payload = run.payload ?? {};
                  const payloadSymbol = typeof payload.symbol === 'string' ? payload.symbol : '-';
                  const payloadMarket = typeof payload.marketType === 'string' ? payload.marketType : '-';
                  return (
                    <button
                      key={run.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted/40 ${activeAutoRunId === run.id ? 'bg-muted/50' : ''}`}
                      onClick={() => onSelectAutoRun(run.id)}
                    >
                      <div className="text-xs font-medium">{formatDateTime(run.createdAt, { locale, timeZone })} · {run.status}</div>
                      <div className="text-xs text-muted-foreground">{payloadSymbol} · {payloadMarket} · {run.approved === null || run.approved === undefined ? 'Aprovação: n/a' : run.approved ? 'Aprovação: sim' : 'Aprovação: não'}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {activeAutoRunDetail && activeAutoRunDetail.run.runType === 'signal_auto' && (
            <Card className="border-primary/30 mt-2">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">Signal Run: {activeAutoRunDetail.run.id.slice(0, 8)}… — {activeAutoRunDetail.run.status}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs px-3 pb-3">
                {Array.isArray(activeAutoRunDetail.steps) && activeAutoRunDetail.steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-2">
                    <span className={
                      step.status === 'succeeded' ? 'text-green-600' :
                      step.status === 'failed' ? 'text-red-600' :
                      step.status === 'running' ? 'text-yellow-600' :
                      'text-muted-foreground'
                    }>●</span>
                    <span>{step.stepName}: {step.status}</span>
                  </div>
                ))}
                {Array.isArray(activeAutoRunDetail.decisions) && activeAutoRunDetail.decisions.length > 0 && (() => {
                  const decision = activeAutoRunDetail.decisions[0];
                  const entrySummary = formatDecisionSummary(decision.entryPayload);
                  const guardrailsSummary = formatDecisionSummary(decision.guardrails);
                  const costsSummary = formatDecisionSummary(decision.estimatedCosts);
                  const entryPayload = decision.entryPayload ?? {};
                  const noTradeReasonCode = typeof entryPayload.noTradeReasonCode === 'string' ? entryPayload.noTradeReasonCode : null;
                  const noTradeReasonHuman = typeof entryPayload.noTradeReasonHuman === 'string' ? entryPayload.noTradeReasonHuman : null;
                  const nextAction = typeof entryPayload.nextAction === 'string' ? entryPayload.nextAction : null;
                  const timeframe = typeof entryPayload.timeframe === 'string' ? entryPayload.timeframe : '-';
                  const horizon = typeof entryPayload.horizon === 'string' ? entryPayload.horizon : '-';
                  const operationIntent = typeof entryPayload.operationIntent === 'string' ? entryPayload.operationIntent : '-';
                  const side = typeof entryPayload.side === 'string' ? entryPayload.side : '-';
                  const edgeNet = Number(entryPayload.edgeNet);
                  const confidenceCalibrated = Number(entryPayload.confidenceCalibrated);
                  const riskReward = Number(entryPayload.riskReward);
                  return (
                    <div className="mt-2 border-t pt-2 space-y-1">
                      <div className="font-medium">Decisão: {decision.approved ? 'Aprovada ✅' : 'Sem trade ❌'}</div>
                      {decision.reasoning && (
                        <div className="text-muted-foreground">Motivo: {decision.reasoning}</div>
                      )}
                      <div>Intent: {operationIntent} · Side: {side} · Timeframe: {timeframe} · Horizonte: {horizon}</div>
                      <div>
                        Edge líquido: {Number.isFinite(edgeNet) ? formatNumber(edgeNet, locale, { maximumFractionDigits: 6 }) : '-'} ·
                        Conf. calibrada: {Number.isFinite(confidenceCalibrated) ? formatNumber(confidenceCalibrated, locale, { maximumFractionDigits: 4 }) : '-'} ·
                        R/R: {Number.isFinite(riskReward) ? formatNumber(riskReward, locale, { maximumFractionDigits: 3 }) : '-'}
                      </div>
                      {entrySummary && (
                        <div><span className="font-medium">Entrada:</span> {entrySummary}</div>
                      )}
                      {guardrailsSummary && (
                        <div><span className="font-medium">Guardrails:</span> {guardrailsSummary}</div>
                      )}
                      {costsSummary && (
                        <div><span className="font-medium">Custos:</span> {costsSummary}</div>
                      )}
                      {!decision.approved && noTradeReasonCode && (
                        <div>
                          <span className="font-medium">No-trade:</span> {noTradeReasonCode}
                          {noTradeReasonHuman ? ` · ${noTradeReasonHuman}` : ''}
                        </div>
                      )}
                      {!decision.approved && nextAction && (
                        <div><span className="font-medium">Próxima ação:</span> {nextAction}</div>
                      )}
                      {decision.tradingSignalId && (
                        <div className="pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenGeneratedSignal(decision.tradingSignalId ?? null)}
                          >
                            Ver sinal gerado
                          </Button>
                          {(() => {
                            const linkedSignal = signals.find((signal) => signal.id === decision.tradingSignalId);
                            if (!linkedSignal) return null;
                            const hasInvalidEntryFields = (linkedSignal.signalType === 'entry_long' || linkedSignal.signalType === 'entry_short')
                              && (!Number.isFinite(linkedSignal.suggestedPrice ?? Number.NaN)
                                || !Number.isFinite(linkedSignal.suggestedStopLoss ?? Number.NaN)
                                || !Number.isFinite(linkedSignal.suggestedTakeProfit ?? Number.NaN)
                                || !Number.isFinite(linkedSignal.suggestedSize ?? Number.NaN));
                            return hasInvalidEntryFields ? (
                              <div className="text-amber-600 mt-1">Sinal inválido — bug: campos de entrada incompletos.</div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

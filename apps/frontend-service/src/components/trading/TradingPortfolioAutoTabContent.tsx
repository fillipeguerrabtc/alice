import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { formatDateTime, formatNumber } from '@/lib/utils';
import type { TradingAutoRunDetail } from '@/services/api/trading';

type TradingPortfolioOption = {
  id: string;
  name: string;
};

type TradingTopCandidate = {
  confidenceCalibrated?: string | number | null;
  confidenceRaw?: string | number | null;
  dsrScore?: string | number | null;
  expectedEdge?: string | number | null;
  id: string;
  pboScore?: string | number | null;
  strategyKey: string;
  timeframe: string;
};

type TradingRebalanceSummary = {
  asofTimestamp: string;
  id: string;
  status: string;
};

type TradingExecutionReportSummary = {
  createdAt: string;
  id: string;
  instrumentId: string;
  marketType: string;
};

type EnqueueTradingJob = 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk';

type TradingPortfolioAutoTabContentProps = {
  activeAutoRunDetail: TradingAutoRunDetail | undefined;
  enqueuePending: boolean;
  formatDecisionSummary: (payload?: Record<string, unknown> | null) => string | null;
  locale: string;
  onEnqueueTrading: (job: EnqueueTradingJob) => void;
  onOpenLab: () => void;
  onRunPipeline: () => void;
  onSelectedPortfolioChange: (value: string) => void;
  selectedPortfolioId: string;
  timeZone: string;
  topTradingCandidates: TradingTopCandidate[];
  tradingExecutionReports: TradingExecutionReportSummary[];
  tradingJobStatus: string;
  tradingPortfolios: TradingPortfolioOption[];
  tradingRebalances: TradingRebalanceSummary[];
};

export function TradingPortfolioAutoTabContent({
  activeAutoRunDetail,
  enqueuePending,
  formatDecisionSummary,
  locale,
  onEnqueueTrading,
  onOpenLab,
  onRunPipeline,
  onSelectedPortfolioChange,
  selectedPortfolioId,
  timeZone,
  topTradingCandidates,
  tradingExecutionReports,
  tradingJobStatus,
  tradingPortfolios,
  tradingRebalances,
}: TradingPortfolioAutoTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Portfólio (Auto)</CardTitle>
          <CardDescription>
            Modo institucional padrão: decisões por edge líquido, confiança calibrada e guardrails de DSR/PBO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Label htmlFor="portfolio-auto-select">Portfólio</Label>
            <Select value={selectedPortfolioId} onValueChange={onSelectedPortfolioChange}>
              <SelectTrigger id="portfolio-auto-select" className="w-[280px]">
                <SelectValue placeholder="Selecione o portfólio" />
              </SelectTrigger>
              <SelectContent>
                {tradingPortfolios.map((portfolio) => (
                  <SelectItem key={portfolio.id} value={portfolio.id}>
                    {portfolio.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No-trade é resultado válido quando custos/risco superam o edge esperado.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRunPipeline} disabled={enqueuePending}>Run Pipeline</Button>
            <Button variant="secondary" onClick={() => onEnqueueTrading('universe-scan')} disabled={enqueuePending}>Enqueue Universe</Button>
            <Button variant="secondary" onClick={() => onEnqueueTrading('backtest')} disabled={enqueuePending}>Enqueue Backtest</Button>
            <Button variant="secondary" onClick={() => onEnqueueTrading('calibration')} disabled={enqueuePending}>Enqueue Calibration</Button>
            <Button variant="secondary" onClick={() => onEnqueueTrading('portfolio-rebalance')} disabled={enqueuePending}>Enqueue Rebalance</Button>
            <Button variant="secondary" onClick={() => onEnqueueTrading('model-risk')} disabled={enqueuePending}>Enqueue Model Risk</Button>
            <Button variant="outline" onClick={onOpenLab}>Abrir Lab assíncrono</Button>
          </div>
          {tradingJobStatus && (
            <div className="text-xs text-muted-foreground">{tradingJobStatus}</div>
          )}
          {activeAutoRunDetail && activeAutoRunDetail.run.runType === 'portfolio_auto' && (
            <Card className="border-primary/30">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">Run: {activeAutoRunDetail.run.id.slice(0, 8)}… — {activeAutoRunDetail.run.status}</CardTitle>
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
                    {step.error && <span className="text-red-500 truncate max-w-[200px]">{step.error}</span>}
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
                    </div>
                  );
                })()}
                {activeAutoRunDetail.run.error && (
                  <div className="text-red-500 mt-1">{activeAutoRunDetail.run.error}</div>
                )}
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Candidates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {topTradingCandidates.length === 0 ? (
                  <EmptyState title="Nenhum candidate encontrado." className="py-4" />
                ) : topTradingCandidates.map((candidate) => (
                  <div key={candidate.id} className="border rounded p-2">
                    <div className="font-medium">{candidate.strategyKey} · {candidate.timeframe}</div>
                    <div>Edge líquido: {formatNumber(Number(candidate.expectedEdge ?? 0), locale)}</div>
                    <div>Conf. calibrada: {formatNumber(Number(candidate.confidenceCalibrated ?? candidate.confidenceRaw ?? 0), locale)}</div>
                    <div>DSR/PBO: {formatNumber(Number(candidate.dsrScore ?? 0), locale)} / {formatNumber(Number(candidate.pboScore ?? 0), locale)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rebalances e Execution Reports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {tradingRebalances.slice(0, 4).map((rebalance) => (
                  <div key={rebalance.id} className="border rounded p-2">
                    <div className="font-medium">{rebalance.status}</div>
                    <div>Asof: {formatDateTime(rebalance.asofTimestamp, { locale, timeZone })}</div>
                  </div>
                ))}
                {tradingExecutionReports.slice(0, 4).map((report) => (
                  <div key={report.id} className="border rounded p-2">
                    <div className="font-medium">{report.marketType.toUpperCase()}</div>
                    <div>Instrumento: {report.instrumentId}</div>
                    <div>Criado em: {formatDateTime(report.createdAt, { locale, timeZone })}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

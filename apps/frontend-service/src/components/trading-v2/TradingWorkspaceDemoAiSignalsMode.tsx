import { useMemo, type ReactNode } from 'react';
import { ArrowRightLeft, CheckCircle, FlaskConical, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { DemoSignalHandoffItem } from '@/services/api/tradingDemo';

type DemoPostMortemSummary = {
  classification: {
    pnlPct: number;
    tradeStyle: string;
  } | null;
  createdAt: string;
  id: string;
  status: string;
};

type DemoQueueStats = {
  dlq: number;
  pending: number;
};

type TradingWorkspaceDemoAiSignalsModeProps = {
  executeSignalPending: boolean;
  formatDate: (value: string) => string;
  handoffSignals: DemoSignalHandoffItem[];
  isLoadingHandoffSignals: boolean;
  onExecuteSignal: (signal: DemoSignalHandoffItem) => void;
  onOpenHistory: () => void;
  onOpenPostmortems: () => void;
  onSendPostmortemToTraining: (postmortemId: string) => void;
  postmortemIdsSentToTraining: Set<string>;
  postmortems: DemoPostMortemSummary[];
  queueStats: DemoQueueStats | undefined;
  renderSignalTypeBadge: (signalType: DemoSignalHandoffItem['signalType']) => ReactNode;
  sendPostmortemPending: boolean;
};

function resolveSignalExecutionReason(signal: DemoSignalHandoffItem): string | null {
  if (signal.signalType !== 'entry_long' && signal.signalType !== 'entry_short') {
    return 'Apenas sinais direcionais podem virar execução demo.';
  }
  if (!signal.suggestedSize || signal.suggestedSize <= 0) {
    return 'Sem tamanho sugerido válido para execução automática.';
  }
  return null;
}

export function TradingWorkspaceDemoAiSignalsMode({
  executeSignalPending,
  formatDate,
  handoffSignals,
  isLoadingHandoffSignals,
  onExecuteSignal,
  onOpenHistory,
  onOpenPostmortems,
  onSendPostmortemToTraining,
  postmortemIdsSentToTraining,
  postmortems,
  queueStats,
  renderSignalTypeBadge,
  sendPostmortemPending,
}: TradingWorkspaceDemoAiSignalsModeProps) {
  const directionalSignals = useMemo(
    () => handoffSignals.filter((signal) => signal.signalType === 'entry_long' || signal.signalType === 'entry_short'),
    [handoffSignals],
  );

  const prioritizedSignals = useMemo(() => directionalSignals.slice(0, 8), [directionalSignals]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Signal Handoff to Demo</CardTitle>
            <CardDescription>
              Execução em paper trading usando rota dedicada de demo, sem tocar em live execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoadingHandoffSignals ? (
              <p className="text-sm text-muted-foreground">Carregando sinais elegíveis...</p>
            ) : prioritizedSignals.length === 0 ? (
              <EmptyState title="Sem sinais direcionais no momento" description="Gere/valide sinais no Trading Real para habilitar handoff." />
            ) : (
              <div className="space-y-2">
                {prioritizedSignals.map((signal) => {
                  const reason = resolveSignalExecutionReason(signal);
                  const canExecute = reason === null;
                  return (
                    <div key={signal.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {renderSignalTypeBadge(signal.signalType)}
                          <span className="font-medium">{signal.symbol}</span>
                          <Badge variant="outline">{signal.marketType}</Badge>
                        </div>
                        <Badge variant="secondary">{(signal.confidence * 100).toFixed(0)}%</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        size sugerido: {signal.suggestedSize ?? '-'} • approval: {String(signal.metadata?.approvalStatus ?? 'pending')}
                      </p>
                      {reason ? (
                        <p className="mt-1 text-xs text-amber-700">{reason}</p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        disabled={!canExecute || executeSignalPending}
                        onClick={() => onExecuteSignal(signal)}
                      >
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                        Executar em Demo
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Isolation Guarantees</CardTitle>
            <CardDescription>Guardrails explícitos para evitar qualquer mistura com execução live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Paper execution only (`/api/integrations/demo-trading/*`)</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Persistência isolada em tabelas `demo_*` por tenant</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <FlaskConical className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Post-mortem automático obrigatório no fechamento de posição demo</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onOpenPostmortems}>
                Abrir post-mortems
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onOpenHistory}>
                Abrir histórico
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Automatic Postmortem Pipeline</CardTitle>
          <CardDescription>Status da fila e últimos post-mortems para handoff de treinamento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">pending: {queueStats?.pending ?? 0}</Badge>
            <Badge variant={queueStats?.dlq ? 'destructive' : 'outline'}>dlq: {queueStats?.dlq ?? 0}</Badge>
          </div>

          {postmortems.length === 0 ? (
            <EmptyState title="Nenhum post-mortem ainda" description="Feche uma posição demo para iniciar o pipeline automático." />
          ) : (
            <div className="space-y-2">
              {postmortems.slice(0, 6).map((postmortem) => (
                <div key={postmortem.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{postmortem.status}</Badge>
                      {postmortem.classification ? (
                        <Badge variant="secondary">
                          {postmortem.classification.tradeStyle} • {postmortem.classification.pnlPct.toFixed(2)}%
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(postmortem.createdAt)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={postmortemIdsSentToTraining.has(postmortem.id) || sendPostmortemPending}
                    onClick={() => onSendPostmortemToTraining(postmortem.id)}
                  >
                    {postmortemIdsSentToTraining.has(postmortem.id) ? 'Enviado para Training' : 'Enviar para Training dataset'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

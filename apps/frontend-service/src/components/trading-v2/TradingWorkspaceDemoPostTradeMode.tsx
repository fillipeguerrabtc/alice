import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

type DemoClosedPositionSummary = {
  closedAt: string | null;
  id: string;
  metadata?: Record<string, unknown>;
  openedAt: string;
  realizedPnl: string | null;
  side: string;
  status: string;
  symbol: string;
};

type DemoFundHistorySummary = {
  amount: string;
  createdAt: string;
  currency: string;
  id: string;
  reason: string | null;
};

type TradingWorkspaceDemoPostTradeModeProps = {
  closedPositions: DemoClosedPositionSummary[];
  formatDate: (value: string) => string;
  formatMoney: (value: number | string) => string;
  fundHistory: DemoFundHistorySummary[];
  onOpenPositionDetail: (positionId: string) => void;
};

function resolveCloseReason(position: DemoClosedPositionSummary): string {
  const metadataReason = typeof position.metadata?.closeReason === 'string' ? position.metadata.closeReason : null;
  if (metadataReason) {
    return metadataReason;
  }
  if (position.status === 'liquidated') {
    return 'liquidation';
  }
  return 'manual';
}

export function TradingWorkspaceDemoPostTradeMode({
  closedPositions,
  formatDate,
  formatMoney,
  fundHistory,
  onOpenPositionDetail,
}: TradingWorkspaceDemoPostTradeModeProps) {
  return (
    <div className="space-y-4">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Post-trade Review</CardTitle>
          <CardDescription>Histórico consolidado de posições e movimentações financeiras demo.</CardDescription>
        </CardHeader>
        <CardContent>
          {closedPositions.length === 0 ? (
            <EmptyState title="Sem posições fechadas" description="Quando houver fechamento, a trilha pós-trade aparecerá aqui." />
          ) : (
            <div className="space-y-2">
              {closedPositions.slice(0, 20).map((position) => {
                const pnl = Number(position.realizedPnl ?? '0');
                return (
                  <button
                    key={position.id}
                    type="button"
                    className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
                    onClick={() => onOpenPositionDetail(position.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{position.symbol}</span>
                        <Badge variant={position.side === 'long' ? 'default' : 'destructive'}>{position.side}</Badge>
                        <Badge variant="outline">{position.status}</Badge>
                      </div>
                      <span className={`font-mono text-sm ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {pnl >= 0 ? '+' : ''}${formatMoney(pnl)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(position.openedAt)} → {position.closedAt ? formatDate(position.closedAt) : '-'}
                    </p>
                    <p className="text-xs text-muted-foreground">Motivo: {resolveCloseReason(position)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fund Flow</CardTitle>
          <CardDescription>Débitos/créditos de PnL e ajustes de saldo demo.</CardDescription>
        </CardHeader>
        <CardContent>
          {fundHistory.length === 0 ? (
            <EmptyState title="Sem movimentações" />
          ) : (
            <div className="space-y-2">
              {fundHistory.slice(0, 20).map((entry) => {
                const action = entry.reason?.split(' - ')[0] ?? 'unknown';
                const isDebit = action.includes('debit');
                return (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{entry.reason?.split(' - ')[1] ?? action}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
                    </div>
                    <p className={`font-mono text-sm ${isDebit ? 'text-red-600' : 'text-green-600'}`}>
                      {isDebit ? '-' : '+'}{formatMoney(entry.amount)} {entry.currency}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

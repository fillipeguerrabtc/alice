import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

type DemoPositionSummary = {
  closedAt: string | null;
  entryPrice: string;
  exitPrice: string | null;
  id: string;
  leverage: number;
  liquidationPrice?: string | null;
  marginAmount?: string | null;
  marketType: string;
  metadata?: Record<string, unknown>;
  realizedPnl: string | null;
  side: string;
  stopLoss: string | null;
  size: string;
  status: string;
  symbol: string;
  takeProfit: string | null;
  totalFees: string | null;
  openedAt: string;
};

type TradingWorkspaceDemoPortfolioAutoModeProps = {
  closePositionPending: boolean;
  formatMoney: (value: number | string) => string;
  onClosePosition: (positionId: string) => void;
  openPositions: DemoPositionSummary[];
  renderPositionLivePnl: (position: DemoPositionSummary) => ReactNode;
  totalAccountEquity: number;
  totalUnrealizedPnl: number;
  usdtAvailable: string;
  winRate: number;
};

export function TradingWorkspaceDemoPortfolioAutoMode({
  closePositionPending,
  formatMoney,
  onClosePosition,
  openPositions,
  renderPositionLivePnl,
  totalAccountEquity,
  totalUnrealizedPnl,
  usdtAvailable,
  winRate,
}: TradingWorkspaceDemoPortfolioAutoModeProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Demo Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${formatMoney(usdtAvailable)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${formatMoney(totalAccountEquity)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Unrealized PnL</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${totalUnrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalUnrealizedPnl >= 0 ? '+' : ''}${formatMoney(totalUnrealizedPnl)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{winRate.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Portfolio Auto (Demo)</CardTitle>
          <CardDescription>
            Gestão consolidada de posições demo com execução paper-only e isolamento total de live execution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openPositions.length === 0 ? (
            <EmptyState title="Sem posições abertas" description="As próximas execuções demo aparecerão aqui." />
          ) : (
            <div className="space-y-2">
              {openPositions.map((position) => (
                <div key={position.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={position.side === 'long' ? 'default' : 'destructive'}>{position.side.toUpperCase()}</Badge>
                      <span className="font-medium">{position.symbol}</span>
                      <Badge variant="outline">{position.marketType}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      size: {position.size} • entry: ${formatMoney(position.entryPrice)}
                    </p>
                    <div className="mt-1">{renderPositionLivePnl(position)}</div>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={closePositionPending}
                    onClick={() => onClosePosition(position.id)}
                  >
                    Fechar posição
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

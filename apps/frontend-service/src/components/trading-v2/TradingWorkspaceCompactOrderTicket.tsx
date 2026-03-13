import { ArrowUpRight, ArrowDownRight, Plus, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type TradingWorkspaceCompactOrderTicketProps = {
  bestAskPrice?: string | number | null;
  bestBidPrice?: string | number | null;
  onOpenNewOrderDialog: () => void;
  onOpenOcoOrderDialog?: () => void;
  onQuickOrder: (side: 'buy' | 'sell') => void;
  selectedSymbol: string;
  tradingEnabled: boolean;
};

function formatPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(2) : '-';
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '-';
}

export function TradingWorkspaceCompactOrderTicket({
  bestAskPrice,
  bestBidPrice,
  onOpenNewOrderDialog,
  onOpenOcoOrderDialog,
  onQuickOrder,
  selectedSymbol,
  tradingEnabled,
}: TradingWorkspaceCompactOrderTicketProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Símbolo ativo</span>
        <Badge variant="outline">{selectedSymbol || '-'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          className="bg-green-600 hover:bg-green-700"
          onClick={() => onQuickOrder('buy')}
          disabled={!tradingEnabled}
          data-testid="operate-v2-quick-buy"
        >
          <ArrowUpRight className="mr-2 h-4 w-4" />
          Buy
        </Button>
        <Button
          type="button"
          className="bg-red-600 hover:bg-red-700"
          onClick={() => onQuickOrder('sell')}
          disabled={!tradingEnabled}
          data-testid="operate-v2-quick-sell"
        >
          <ArrowDownRight className="mr-2 h-4 w-4" />
          Sell
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border p-2">
          <p className="text-xs text-muted-foreground">Best bid</p>
          <p className="font-mono">${formatPrice(bestBidPrice)}</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-xs text-muted-foreground">Best ask</p>
          <p className="font-mono">${formatPrice(bestAskPrice)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="default"
          onClick={onOpenNewOrderDialog}
          disabled={!tradingEnabled}
          data-testid="operate-v2-open-order-dialog"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova ordem
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onOpenOcoOrderDialog}
          disabled={!tradingEnabled || !onOpenOcoOrderDialog}
          data-testid="operate-v2-open-oco-dialog"
        >
          <Link2 className="mr-2 h-4 w-4" />
          OCO
        </Button>
      </div>
    </div>
  );
}

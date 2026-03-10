import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ErrorBoundary } from '@/components/error-boundary';
import type { OrderBookData } from './OrderBookViz';
import { OrderBookViz } from './OrderBookViz';
import { AlertTriangle } from 'lucide-react';

type TradingOrderBookTabContentProps = {
  currentPrice: number;
  isLoadingOrderBook: boolean;
  locale: string;
  orderBookData: OrderBookData | null;
  orderBookDepth: number | null;
  orderBookPrecision: number | null;
  selectedSymbol: string;
};

export function TradingOrderBookTabContent({
  currentPrice,
  isLoadingOrderBook,
  locale,
  orderBookData,
  orderBookDepth,
  orderBookPrecision,
  selectedSymbol,
}: TradingOrderBookTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <ErrorBoundary
        fallback={
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Erro no livro de ofertas</AlertTitle>
            <AlertDescription>
              Não foi possível carregar o orderbook. Verifique sua conexão ou tente recarregar.
            </AlertDescription>
          </Alert>
        }
      >
        <OrderBookViz
          data={orderBookData}
          symbol={selectedSymbol}
          currentPrice={currentPrice}
          isLoading={isLoadingOrderBook}
          depth={orderBookDepth ?? undefined}
          precision={orderBookPrecision ?? undefined}
          locale={locale}
        />
      </ErrorBoundary>
    </div>
  );
}

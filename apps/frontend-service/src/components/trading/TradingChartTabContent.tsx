import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ErrorBoundary } from '@/components/error-boundary';
import type { KlineData } from './CandleChart';
import { CandleChart } from './CandleChart';
import { AlertTriangle } from 'lucide-react';

type TradingChartTabContentProps = {
  currentPrice: number;
  intervalOptions: Array<{ value: string; label: string }>;
  isLoadingKlines: boolean;
  klines: KlineData[];
  locale: string;
  onIntervalChange: (value: string) => void;
  onRefresh: () => void;
  onSymbolChange: (symbol: string) => void;
  selectedInterval: string;
  selectedSymbol: string;
  symbolOptions: string[];
  timeZone: string;
};

export function TradingChartTabContent({
  currentPrice,
  intervalOptions,
  isLoadingKlines,
  klines,
  locale,
  onIntervalChange,
  onRefresh,
  onSymbolChange,
  selectedInterval,
  selectedSymbol,
  symbolOptions,
  timeZone,
}: TradingChartTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <ErrorBoundary
        fallback={
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Erro no gráfico</AlertTitle>
            <AlertDescription>
              Não foi possível renderizar o gráfico de candles. Tente recarregar a página ou selecionar outro símbolo.
            </AlertDescription>
          </Alert>
        }
      >
        <CandleChart
          data={klines}
          symbol={selectedSymbol}
          interval={selectedInterval}
          intervalOptions={intervalOptions}
          symbolOptions={symbolOptions}
          onSymbolChange={onSymbolChange}
          currentPrice={currentPrice}
          isLoading={isLoadingKlines}
          onIntervalChange={onIntervalChange}
          onRefresh={onRefresh}
          height={500}
          showVolume={true}
          locale={locale}
          timeZone={timeZone}
        />
      </ErrorBoundary>
    </div>
  );
}

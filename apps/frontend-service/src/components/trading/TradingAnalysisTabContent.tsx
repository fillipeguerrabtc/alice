import type { TFunction } from 'i18next';
import { BarChart3 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TechnicalAnalysisPanel } from './TechnicalAnalysisPanel';

type TradingAnalysisTabContentProps = {
  intervalOptions: Array<{ value: string; label: string }>;
  selectedInterval: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  t: TFunction;
};

export function TradingAnalysisTabContent({
  intervalOptions,
  selectedInterval,
  selectedMarginMode,
  selectedMarketType,
  selectedSymbol,
  t,
}: TradingAnalysisTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <Alert className="bg-muted/50 border-primary/20">
        <BarChart3 className="h-4 w-4" />
        <AlertTitle>{t('trading.analysisVsSignals.title')}</AlertTitle>
        <AlertDescription>{t('trading.analysisVsSignals.desc')}</AlertDescription>
      </Alert>
      <TechnicalAnalysisPanel
        symbol={selectedSymbol}
        defaultInterval={selectedInterval}
        intervalOptions={intervalOptions}
        marketType={selectedMarketType}
        marginMode={selectedMarginMode}
      />
    </div>
  );
}

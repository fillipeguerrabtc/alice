import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type EnqueueTradingJob = 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk';

type TradingLabTabContentProps = {
  enqueuePending: boolean;
  onEnqueueTrading: (job: EnqueueTradingJob) => void;
  onOpenManualAnalysis: () => void;
};

export function TradingLabTabContent({
  enqueuePending,
  onEnqueueTrading,
  onOpenManualAnalysis,
}: TradingLabTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Lab / Research</CardTitle>
          <CardDescription>Parâmetros avançados e pesquisa assíncrona via jobs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Múltiplos testes elevam risco de overfitting. Use purge/embargo e valide com DSR/PBO.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onEnqueueTrading('universe-scan')} disabled={enqueuePending}>Queue Universe Scan</Button>
            <Button variant="outline" onClick={() => onEnqueueTrading('backtest')} disabled={enqueuePending}>Queue Backtest</Button>
            <Button variant="outline" onClick={() => onEnqueueTrading('calibration')} disabled={enqueuePending}>Queue Calibration</Button>
            <Button variant="outline" onClick={() => onEnqueueTrading('portfolio-rebalance')} disabled={enqueuePending}>Queue Rebalance</Button>
            <Button variant="outline" onClick={() => onEnqueueTrading('model-risk')} disabled={enqueuePending}>Queue Model Risk</Button>
          </div>
          <Button variant="outline" onClick={onOpenManualAnalysis}>Abrir análise manual</Button>
        </CardContent>
      </Card>
    </div>
  );
}

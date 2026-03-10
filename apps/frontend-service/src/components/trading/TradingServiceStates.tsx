import { AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type TradingStatusErrorStateProps = {
  errorMessage: string;
  onReload: () => void;
};

type TradingStatusUnavailableStateProps = {
  onReload: () => void;
};

type TradingNotConfiguredStateProps = {
  description: string;
  missingKeys: string[];
  title: string;
};

type TradingTenantRequiredStateProps = {
  description: string;
  title: string;
};

export function TradingContentLoadingState() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

export function TradingStatusErrorState({ errorMessage, onReload }: TradingStatusErrorStateProps) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-yellow-500" />
          <div>
            <h3 className="text-lg font-medium">Falha ao carregar o status do Trading</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{errorMessage}</p>
          </div>
          <Button onClick={onReload}>Recarregar status</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function TradingStatusUnavailableState({ onReload }: TradingStatusUnavailableStateProps) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-yellow-500" />
          <div>
            <h3 className="text-lg font-medium">Status do Trading indisponível</h3>
            <p className="text-muted-foreground mt-2 max-w-md">
              Não foi possível obter o status do serviço. Tente novamente em alguns instantes.
            </p>
          </div>
          <Button onClick={onReload}>Recarregar status</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function TradingNotConfiguredState({
  description,
  missingKeys,
  title,
}: TradingNotConfiguredStateProps) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">{title}</h3>
          <p className="text-muted-foreground text-center max-w-md mb-4">{description}</p>
          <div className="p-4 bg-muted rounded-lg text-sm font-mono space-y-1">
            {missingKeys.map((key) => (
              <p key={key}>{key}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function TradingTenantRequiredState({
  description,
  title,
}: TradingTenantRequiredStateProps) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">{title}</h3>
          <p className="text-muted-foreground text-center max-w-md">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type TradingLoadingScreenProps = {
  message: string;
};

type TradingAuthRequiredScreenProps = {
  description: string;
  loginLabel: string;
  title: string;
  onLogin: () => void;
};

type TradingForbiddenScreenProps = {
  description: string;
  title: string;
};

export function TradingLoadingScreen({ message }: TradingLoadingScreenProps) {
  return (
    <div className="flex h-app items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export function TradingAuthRequiredScreen({
  description,
  loginLabel,
  title,
  onLogin,
}: TradingAuthRequiredScreenProps) {
  return (
    <div className="flex h-app items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onLogin} className="w-full">
            {loginLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function TradingForbiddenScreen({ description, title }: TradingForbiddenScreenProps) {
  return (
    <div className="flex h-app items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export function resolveTradingLoadingMessage(t: TFunction): string {
  return t('common.loading', { defaultValue: 'Carregando...' });
}

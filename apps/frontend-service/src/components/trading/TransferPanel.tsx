/**
 * TransferPanel - Transferências entre contas KuCoin
 * 
 * Flex transfer entre contas (Spot, Margin, Futures, etc.)
 * e consulta de limites de transferência.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API KuCoin
 * Regra 10 - Documentação PT-BR
 * 
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowRightLeft, AlertCircle } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export interface TransferPanelProps {
  /** Moeda padrão */
  defaultCurrency?: string;
}

/** Tipos de conta KuCoin para transferência */
const ACCOUNT_TYPES = [
  { value: 'MAIN', label: 'Main (Funding)' },
  { value: 'TRADE', label: 'Trading (Spot)' },
  { value: 'TRADE_HF', label: 'Trading HF (Spot Pro)' },
  { value: 'MARGIN', label: 'Margin (Cross)' },
  { value: 'ISOLATED', label: 'Margin (Isolated)' },
  { value: 'CONTRACT', label: 'Futures' },
] as const;

interface TransferQuota {
  currency?: string;
  balance?: string;
  available?: string;
  holds?: string;
  transferable?: string;
}

export function TransferPanel({ defaultCurrency = 'USDT' }: TransferPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [currency, setCurrency] = useState(defaultCurrency);
  const [fromAccountType, setFromAccountType] = useState('TRADE');
  const [toAccountType, setToAccountType] = useState('CONTRACT');
  const [amount, setAmount] = useState('');

  // Limites de transferência
  const { data: quotas, isLoading: loadingQuotas } = useQuery<TransferQuota>({
    queryKey: ['account', 'transfer', 'quotas', currency, fromAccountType],
    queryFn: async () => {
      const params = new URLSearchParams({ currency, type: fromAccountType });
      const res = await apiRequest('GET', `/api/integrations/trading/account/transfer/quotas?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 30_000,
    enabled: !!currency,
  });

  // Executar transferência
  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/integrations/trading/account/transfer', {
        currency,
        amount,
        fromAccountType,
        toAccountType,
        type: 'INTERNAL', // transferência interna entre contas do mesmo usuário
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.transfer.success', 'Transferência realizada com sucesso') });
      setAmount('');
      queryClient.invalidateQueries({ queryKey: ['account', 'transfer', 'quotas'] });
    },
    onError: (err: Error) => {
      toast({ title: t('trading.account.transfer.error', 'Erro na transferência'), description: err.message, variant: 'destructive' });
    },
  });

  /** Troca origem/destino */
  const swapAccounts = () => {
    setFromAccountType(toAccountType);
    setToAccountType(fromAccountType);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {t('trading.account.transfer.title', 'Transferir entre Contas')}
          </CardTitle>
          <CardDescription>{t('trading.account.transfer.desc', 'Mova fundos entre contas Spot, Margin e Futures')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Moeda */}
          <div>
            <Label>{t('trading.account.transfer.currency', 'Moeda')}</Label>
            <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="USDT" />
          </div>

          {/* Origem e Destino */}
          <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
            <div>
              <Label>{t('trading.account.transfer.from', 'De')}</Label>
              <Select value={fromAccountType} onValueChange={setFromAccountType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map(at => (
                    <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={swapAccounts} className="mb-0.5">
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
            <div>
              <Label>{t('trading.account.transfer.to', 'Para')}</Label>
              <Select value={toAccountType} onValueChange={setToAccountType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map(at => (
                    <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Limites */}
          {loadingQuotas ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : quotas ? (
            <div className="grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.account.transfer.balance', 'Saldo')}</span>
                <span className="font-mono">{quotas.balance || '0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.account.transfer.transferable', 'Transferível')}</span>
                <span className="font-mono text-green-500">{quotas.transferable || '0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.account.transfer.available', 'Disponível')}</span>
                <span className="font-mono">{quotas.available || '0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.account.transfer.holds', 'Bloqueado')}</span>
                <span className="font-mono text-amber-500">{quotas.holds || '0'}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              {t('trading.account.transfer.noQuotas', 'Sem dados de limites')}
            </div>
          )}

          {/* Quantidade e botão */}
          <div>
            <Label>{t('trading.account.transfer.amount', 'Quantidade')}</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1"
              />
              {quotas?.transferable && (
                <Button variant="outline" size="sm" onClick={() => setAmount(quotas.transferable || '')}>
                  Max
                </Button>
              )}
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => transferMutation.mutate()}
            disabled={transferMutation.isPending || !amount || fromAccountType === toAccountType}
          >
            {transferMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('trading.account.transfer.confirm', 'Transferir')} {currency}
          </Button>

          {fromAccountType === toAccountType && (
            <p className="text-xs text-amber-500 text-center">{t('trading.account.transfer.sameAccount', 'Origem e destino devem ser diferentes')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * LedgerHistory - Histórico de transações (ledgers) KuCoin
 * 
 * Ledgers por tipo de conta: Spot/Margin, Trade HF, Margin HF, Futures.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API KuCoin
 * Regra 10 - Documentação PT-BR
 * 
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, FileText, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

export interface LedgerHistoryProps {
  /** Tipo de ledger padrão */
  defaultType?: string;
}

/** Tipos de ledger disponíveis */
const LEDGER_TYPES = [
  { value: 'spot-margin', label: 'Spot / Margin', endpoint: '/api/integrations/trading/account/ledgers/spot-margin' },
  { value: 'trade-hf', label: 'Trade HF (Spot Pro)', endpoint: '/api/integrations/trading/account/ledgers/trade-hf' },
  { value: 'margin-hf', label: 'Margin HF', endpoint: '/api/integrations/trading/account/ledgers/margin-hf' },
  { value: 'futures', label: 'Futures', endpoint: '/api/integrations/trading/account/ledgers/futures' },
] as const;

interface LedgerEntry {
  id?: string;
  currency?: string;
  amount?: string;
  fee?: string;
  balance?: string;
  accountType?: string;
  bizType?: string;
  direction?: string;
  createdAt?: number;
  context?: string;
}

export function LedgerHistory({ defaultType = 'spot-margin' }: LedgerHistoryProps) {
  const { t } = useTranslation();
  const [ledgerType, setLedgerType] = useState(defaultType);
  const [currency, setCurrency] = useState('');

  const selectedLedger = LEDGER_TYPES.find(lt => lt.value === ledgerType) || LEDGER_TYPES[0];

  const { data: ledgersRaw, isLoading } = useQuery<{ items?: LedgerEntry[] }>({
    queryKey: ['account', 'ledgers', ledgerType, currency],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '50' });
      if (currency) params.append('currency', currency);
      const res = await apiRequest('GET', `${selectedLedger.endpoint}?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 30_000,
  });

  const ledgers = ledgersRaw?.items || [];

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label>{t('trading.account.ledger.type', 'Tipo de Conta')}</Label>
          <Select value={ledgerType} onValueChange={setLedgerType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEDGER_TYPES.map(lt => (
                <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label>{t('trading.account.ledger.currency', 'Moeda (opcional)')}</Label>
          <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="USDT, BTC..." />
        </div>
      </div>

      {/* Lista de ledgers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t('trading.account.ledger.title', 'Histórico de Transações')} - {selectedLedger.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : ledgers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{t('trading.account.ledger.empty', 'Nenhuma transação encontrada')}</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {ledgers.map((entry, i) => {
                const isCredit = entry.direction === 'in' || Number(entry.amount || 0) > 0;
                return (
                  <div key={entry.id || i} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded text-sm border-b border-muted last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {isCredit ? (
                        <ArrowDownRight className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-red-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-semibold ${isCredit ? 'text-green-500' : 'text-red-500'}`}>
                            {isCredit ? '+' : ''}{entry.amount} {entry.currency}
                          </span>
                          {entry.bizType && <Badge variant="outline" className="text-xs">{entry.bizType}</Badge>}
                        </div>
                        {entry.fee && Number(entry.fee) !== 0 && (
                          <span className="text-xs text-muted-foreground">Fee: {entry.fee}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {entry.balance && (
                        <div className="text-xs font-mono">{t('trading.account.ledger.balance', 'Saldo')}: {entry.balance}</div>
                      )}
                      {entry.createdAt && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      )}
                    </div>
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

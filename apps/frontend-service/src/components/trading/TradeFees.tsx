/**
 * TradeFees - Consulta de taxas de trading KuCoin
 * 
 * Exibe taxas básicas Spot/Margin e taxas Futures por símbolo.
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Percent, Search } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

/** Símbolo Futures padrão quando nenhum é fornecido */
const DEFAULT_FUTURES_SYMBOL = 'XBTUSDTM';

export interface TradeFeesProps {
  /** Símbolo Futures padrão */
  defaultFuturesSymbol?: string;
}

interface BasicFee {
  takerFeeRate?: string;
  makerFeeRate?: string;
}

interface FuturesFee {
  symbol?: string;
  takerFeeRate?: string;
  makerFeeRate?: string;
}

export function TradeFees({ defaultFuturesSymbol }: TradeFeesProps) {
  const { t } = useTranslation();
  // Fallback para constante quando string vazia ou undefined (default params não cobrem '')
  const resolvedSymbol = defaultFuturesSymbol || DEFAULT_FUTURES_SYMBOL;
  const [futuresSymbol, setFuturesSymbol] = useState(resolvedSymbol);
  const [searchSymbol, setSearchSymbol] = useState(resolvedSymbol);

  // Fee básica Spot/Margin
  const { data: basicFee, isLoading: loadingBasic } = useQuery<BasicFee>({
    queryKey: ['account', 'fees', 'basic'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/fees/basic');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 300_000,
  });

  // Fee Futures (por símbolo)
  const { data: futuresFee, isLoading: loadingFutures } = useQuery<FuturesFee>({
    queryKey: ['account', 'fees', 'futures', futuresSymbol],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/account/fees/futures?symbol=${futuresSymbol}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 300_000,
    enabled: !!futuresSymbol,
  });

  /** Renderiza bloco de fee */
  const renderFeeBlock = (label: string, taker?: string, maker?: string) => {
    const takerPct = (Number(taker || 0) * 100).toFixed(4);
    const makerPct = (Number(maker || 0) * 100).toFixed(4);
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center p-4 bg-red-500/10 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">Taker ({label})</div>
          <div className="text-2xl font-mono font-bold text-red-500">{takerPct}%</div>
          <div className="text-xs text-muted-foreground mt-1">Rate: {taker || '0'}</div>
        </div>
        <div className="text-center p-4 bg-green-500/10 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">Maker ({label})</div>
          <div className="text-2xl font-mono font-bold text-green-500">{makerPct}%</div>
          <div className="text-xs text-muted-foreground mt-1">Rate: {maker || '0'}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Taxas Spot/Margin */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            {t('trading.account.fees.spotTitle', 'Taxas Spot / Margin')}
          </CardTitle>
          <CardDescription>{t('trading.account.fees.spotDesc', 'Taxas base aplicadas a ordens Spot e Margin')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingBasic ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : basicFee ? (
            renderFeeBlock('Spot/Margin', basicFee.takerFeeRate, basicFee.makerFeeRate)
          ) : (
            <p className="text-sm text-muted-foreground">{t('trading.account.fees.noData', 'Dados não disponíveis')}</p>
          )}
        </CardContent>
      </Card>

      {/* Taxas Futures */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            {t('trading.account.fees.futuresTitle', 'Taxas Futures')}
          </CardTitle>
          <CardDescription>{t('trading.account.fees.futuresDesc', 'Taxas por contrato Futures')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label>{t('trading.account.fees.symbol', 'Símbolo')}</Label>
              <Input
                value={searchSymbol}
                onChange={e => setSearchSymbol(e.target.value.toUpperCase())}
                placeholder={DEFAULT_FUTURES_SYMBOL}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => setFuturesSymbol(searchSymbol)} disabled={loadingFutures}>
                {loadingFutures ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {futuresFee ? (
            <div className="space-y-2">
              <div className="text-sm text-center text-muted-foreground">
                {t('trading.account.fees.contract', 'Contrato')}: <span className="font-mono font-semibold">{futuresFee.symbol}</span>
              </div>
              {renderFeeBlock('Futures', futuresFee.takerFeeRate, futuresFee.makerFeeRate)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center">{t('trading.account.fees.searchHint', 'Busque um símbolo Futures')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

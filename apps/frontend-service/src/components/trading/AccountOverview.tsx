/**
 * AccountOverview - Resumo de balances e informações da conta KuCoin
 * 
 * Exibe resumo consolidado: informações da conta, API key info,
 * balances Spot, e taxas de trading.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API KuCoin
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, User, Key, Wallet, Percent, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';

/** Propriedades do componente */
export interface AccountOverviewProps {
  /** Callback ao clicar em refresh */
  onRefresh?: () => void;
}

/** Resposta do endpoint /account/summary */
interface AccountSummary {
  level?: number;
  subQuantity?: number;
  spotSubQuantity?: number;
  marginSubQuantity?: number;
  futuresSubQuantity?: number;
  maxSubQuantity?: number;
  maxDefaultSubQuantity?: number;
  maxSpotSubQuantity?: number;
  maxMarginSubQuantity?: number;
  maxFuturesSubQuantity?: number;
}

/** Resposta do endpoint /account/apikey */
interface ApiKeyInfo {
  remark?: string;
  apiKey?: string;
  apiVersion?: number;
  permission?: string;
  ipWhitelist?: string;
  createdAt?: number;
  uid?: number;
  isMaster?: boolean;
}

/** Resposta do endpoint /account/fees/basic */
interface BasicFee {
  takerFeeRate?: string;
  makerFeeRate?: string;
}

/** Resposta do endpoint /account/fees/futures */
interface FuturesFee {
  symbol?: string;
  takerFeeRate?: string;
  makerFeeRate?: string;
}

export function AccountOverview({ onRefresh }: AccountOverviewProps) {
  const { t } = useTranslation();

  // Resumo da conta
  const { data: summary, isLoading: loadingSummary } = useQuery<AccountSummary>({
    queryKey: ['account', 'summary'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/summary');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 60_000,
  });

  // Info da API key
  const { data: apiKeyInfo, isLoading: loadingApiKey } = useQuery<ApiKeyInfo>({
    queryKey: ['account', 'apikey'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/apikey');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 120_000,
  });

  // Fee básica Spot/Margin
  const { data: basicFee, isLoading: loadingFee } = useQuery<BasicFee>({
    queryKey: ['account', 'fees', 'basic'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/fees/basic');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 300_000,
  });

  // Fee Futures
  const { data: futuresFee } = useQuery<FuturesFee>({
    queryKey: ['account', 'fees', 'futures'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/fees/futures?symbol=XBTUSDTM');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 300_000,
  });

  const isLoading = loadingSummary || loadingApiKey || loadingFee;

  return (
    <div className="space-y-4">
      {/* Cabeçalho com refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('trading.account.overview.title', 'Visão Geral da Conta')}</h3>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          {t('trading.refresh', 'Atualizar')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Informações da Conta */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="h-4 w-4" />
              {t('trading.account.overview.accountInfo', 'Informações da Conta')}
            </CardTitle>
            <CardDescription>{t('trading.account.overview.accountInfoDesc', 'Detalhes da conta e sub-contas')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : summary ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.level', 'Nível')}</span>
                  <Badge variant="secondary">{summary.level ?? '-'}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.subAccounts', 'Sub-contas')}</span>
                  <span className="font-mono">{summary.subQuantity ?? 0} / {summary.maxSubQuantity ?? '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.spotSubs', 'Spot Sub-contas')}</span>
                  <span className="font-mono">{summary.spotSubQuantity ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.futuresSubs', 'Futures Sub-contas')}</span>
                  <span className="font-mono">{summary.futuresSubQuantity ?? 0}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {t('trading.account.overview.noData', 'Dados não disponíveis')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* API Key Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Key className="h-4 w-4" />
              {t('trading.account.overview.apiKeyInfo', 'Informações da API Key')}
            </CardTitle>
            <CardDescription>{t('trading.account.overview.apiKeyInfoDesc', 'Permissões e configurações da chave')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingApiKey ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : apiKeyInfo ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.apiKeyRemark', 'Remark')}</span>
                  <span className="font-mono truncate max-w-[150px]">{apiKeyInfo.remark || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.permissions', 'Permissões')}</span>
                  <span className="font-mono text-xs">{apiKeyInfo.permission || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.isMaster', 'Master')}</span>
                  <Badge variant={apiKeyInfo.isMaster ? 'default' : 'secondary'}>
                    {apiKeyInfo.isMaster ? 'Sim' : 'Não'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.overview.uid', 'UID')}</span>
                  <span className="font-mono">{apiKeyInfo.uid ?? '-'}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {t('trading.account.overview.noData', 'Dados não disponíveis')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Taxas Spot/Margin */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Percent className="h-4 w-4" />
              {t('trading.account.overview.spotFees', 'Taxas Spot/Margin')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingFee ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : basicFee ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taker Fee</span>
                  <span className="font-mono text-red-500">{(Number(basicFee.takerFeeRate || 0) * 100).toFixed(3)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maker Fee</span>
                  <span className="font-mono text-green-500">{(Number(basicFee.makerFeeRate || 0) * 100).toFixed(3)}%</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">-</div>
            )}
          </CardContent>
        </Card>

        {/* Taxas Futures */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {t('trading.account.overview.futuresFees', 'Taxas Futures (BTC)')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {futuresFee ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taker Fee</span>
                  <span className="font-mono text-red-500">{(Number(futuresFee.takerFeeRate || 0) * 100).toFixed(3)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maker Fee</span>
                  <span className="font-mono text-green-500">{(Number(futuresFee.makerFeeRate || 0) * 100).toFixed(3)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-mono">{futuresFee.symbol || 'XBTUSDTM'}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">-</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * DepositWithdraw - Gestão de depósitos e withdrawals KuCoin
 * 
 * Permite criar endereços de depósito, visualizar histórico de depósitos
 * e withdrawals, executar withdrawals e consultar limites.
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, Copy, CheckCircle, XCircle, Clock } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export interface DepositWithdrawProps {
  /** Moeda padrão selecionada */
  defaultCurrency?: string;
}

interface DepositAddress {
  address?: string;
  memo?: string;
  chain?: string;
  contractAddress?: string;
}

interface DepositRecord {
  currency?: string;
  amount?: string;
  address?: string;
  memo?: string;
  status?: string;
  createdAt?: number;
  walletTxId?: string;
  chain?: string;
}

interface WithdrawalRecord {
  id?: string;
  currency?: string;
  amount?: string;
  address?: string;
  memo?: string;
  status?: string;
  createdAt?: number;
  walletTxId?: string;
  fee?: string;
  chain?: string;
}

interface WithdrawalQuota {
  currency?: string;
  limitBTCAmount?: string;
  usedBTCAmount?: string;
  remainAmount?: string;
  availableAmount?: string;
  withdrawMinFee?: string;
  innerWithdrawMinFee?: string;
  withdrawMinSize?: string;
  isWithdrawEnabled?: boolean;
  precision?: number;
  chain?: string;
}

/** Mapa de status para badge */
function getStatusBadge(status: string | undefined) {
  switch (status) {
    case 'SUCCESS':
    case 'WALLET_PROCESSING':
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Sucesso</Badge>;
    case 'PROCESSING':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Processando</Badge>;
    case 'FAILURE':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Falha</Badge>;
    default:
      return <Badge variant="outline">{status || '-'}</Badge>;
  }
}

export function DepositWithdraw({ defaultCurrency = 'USDT' }: DepositWithdrawProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [currency, setCurrency] = useState(defaultCurrency);
  const [chain, setChain] = useState('');
  const [withdrawForm, setWithdrawForm] = useState({ address: '', amount: '', memo: '', chain: '' });
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);

  // Endereço de depósito
  const { data: depositAddress, isLoading: loadingAddress } = useQuery<DepositAddress>({
    queryKey: ['account', 'deposit', 'address', currency, chain],
    queryFn: async () => {
      const params = new URLSearchParams({ currency });
      if (chain) params.append('chain', chain);
      const res = await apiRequest('GET', `/api/integrations/trading/account/deposit/address?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 300_000,
    enabled: !!currency,
  });

  // Histórico de depósitos
  const { data: depositsRaw, isLoading: loadingDeposits } = useQuery<{ items?: DepositRecord[] }>({
    queryKey: ['account', 'deposits', currency],
    queryFn: async () => {
      const params = new URLSearchParams({ currency, pageSize: '20' });
      const res = await apiRequest('GET', `/api/integrations/trading/account/deposits?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 30_000,
  });

  // Histórico de withdrawals
  const { data: withdrawalsRaw, isLoading: loadingWithdrawals } = useQuery<{ items?: WithdrawalRecord[] }>({
    queryKey: ['account', 'withdrawals', currency],
    queryFn: async () => {
      const params = new URLSearchParams({ currency, pageSize: '20' });
      const res = await apiRequest('GET', `/api/integrations/trading/account/withdrawals?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 30_000,
  });

  // Limites de withdrawal
  const { data: quotas } = useQuery<WithdrawalQuota>({
    queryKey: ['account', 'withdrawal', 'quotas', currency],
    queryFn: async () => {
      const params = new URLSearchParams({ currency });
      const res = await apiRequest('GET', `/api/integrations/trading/account/withdrawal/quotas?${params}`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 60_000,
    enabled: !!currency,
  });

  // Criar endereço de depósito
  const createAddressMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { currency };
      if (chain) body.chain = chain;
      const res = await apiRequest('POST', '/api/integrations/trading/account/deposit/address', body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.deposit.addressCreated', 'Endereço criado com sucesso') });
      queryClient.invalidateQueries({ queryKey: ['account', 'deposit', 'address'] });
    },
    onError: (err: Error) => {
      toast({ title: t('trading.account.deposit.addressError', 'Erro ao criar endereço'), description: err.message, variant: 'destructive' });
    },
  });

  // Executar withdrawal
  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        currency,
        address: withdrawForm.address,
        amount: withdrawForm.amount,
      };
      if (withdrawForm.memo) body.memo = withdrawForm.memo;
      if (withdrawForm.chain) body.chain = withdrawForm.chain;
      const res = await apiRequest('POST', '/api/integrations/trading/account/withdraw', body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.withdraw.success', 'Withdrawal enviado com sucesso') });
      setShowWithdrawDialog(false);
      setWithdrawForm({ address: '', amount: '', memo: '', chain: '' });
      queryClient.invalidateQueries({ queryKey: ['account', 'withdrawals'] });
    },
    onError: (err: Error) => {
      toast({ title: t('trading.account.withdraw.error', 'Erro no withdrawal'), description: err.message, variant: 'destructive' });
    },
  });

  // Cancelar withdrawal
  const cancelWithdrawalMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/integrations/trading/account/withdrawals/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.withdraw.cancelled', 'Withdrawal cancelado') });
      queryClient.invalidateQueries({ queryKey: ['account', 'withdrawals'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const deposits = depositsRaw?.items || [];
  const withdrawals = withdrawalsRaw?.items || [];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: t('trading.account.deposit.copied', 'Copiado!') });
  };

  return (
    <div className="space-y-4">
      {/* Seletor de moeda */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label>{t('trading.account.deposit.currency', 'Moeda')}</Label>
          <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="USDT" />
        </div>
        <div className="flex-1">
          <Label>{t('trading.account.deposit.chain', 'Chain (opcional)')}</Label>
          <Input value={chain} onChange={e => setChain(e.target.value)} placeholder="ex: TRC20, ERC20" />
        </div>
      </div>

      <Tabs defaultValue="deposit">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">
            <ArrowDownToLine className="h-4 w-4 mr-2" />
            {t('trading.account.deposit.title', 'Depósitos')}
          </TabsTrigger>
          <TabsTrigger value="withdrawal">
            <ArrowUpFromLine className="h-4 w-4 mr-2" />
            {t('trading.account.withdraw.title', 'Withdrawals')}
          </TabsTrigger>
        </TabsList>

        {/* Depósitos */}
        <TabsContent value="deposit" className="space-y-4">
          {/* Endereço de depósito */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('trading.account.deposit.addressTitle', 'Endereço de Depósito')}</CardTitle>
              <CardDescription>{currency} {chain ? `(${chain})` : ''}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAddress ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : depositAddress?.address ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded break-all">{depositAddress.address}</code>
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(depositAddress.address || '')}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  {depositAddress.memo && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Memo:</span>
                      <code className="text-xs bg-muted p-1 rounded">{depositAddress.memo}</code>
                      <Button variant="ghost" size="icon" onClick={() => copyToClipboard(depositAddress.memo || '')}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t('trading.account.deposit.noAddress', 'Nenhum endereço encontrado.')}</p>
                  <Button size="sm" onClick={() => createAddressMutation.mutate()} disabled={createAddressMutation.isPending}>
                    {createAddressMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('trading.account.deposit.createAddress', 'Criar Endereço')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Histórico de depósitos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('trading.account.deposit.history', 'Histórico de Depósitos')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingDeposits ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : deposits.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('trading.account.deposit.empty', 'Nenhum depósito encontrado')}</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {deposits.map((d, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                      <div>
                        <span className="font-mono font-semibold">{d.amount} {d.currency}</span>
                        <span className="text-xs text-muted-foreground ml-2">{d.chain || ''}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(d.status)}
                        {d.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(d.createdAt).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Withdrawals */}
        <TabsContent value="withdrawal" className="space-y-4">
          {/* Limites */}
          {quotas && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('trading.account.withdraw.quotas', 'Limites de Withdrawal')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('trading.account.withdraw.available', 'Disponível')}</span>
                    <span className="font-mono">{quotas.availableAmount || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('trading.account.withdraw.remaining', 'Restante')}</span>
                    <span className="font-mono">{quotas.remainAmount || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('trading.account.withdraw.minFee', 'Fee mínima')}</span>
                    <span className="font-mono">{quotas.withdrawMinFee || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('trading.account.withdraw.minSize', 'Mín. withdraw')}</span>
                    <span className="font-mono">{quotas.withdrawMinSize || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('trading.account.withdraw.enabled', 'Habilitado')}</span>
                    <Badge variant={quotas.isWithdrawEnabled ? 'default' : 'destructive'}>
                      {quotas.isWithdrawEnabled ? 'Sim' : 'Não'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Botão de withdraw */}
          <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
            <DialogTrigger asChild>
              <Button className="w-full">
                <ArrowUpFromLine className="h-4 w-4 mr-2" />
                {t('trading.account.withdraw.action', 'Executar Withdrawal')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('trading.account.withdraw.dialogTitle', 'Novo Withdrawal')}</DialogTitle>
                <DialogDescription>{t('trading.account.withdraw.dialogDesc', 'Envie fundos para um endereço externo')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{t('trading.account.withdraw.address', 'Endereço')}</Label>
                  <Input value={withdrawForm.address} onChange={e => setWithdrawForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div>
                  <Label>{t('trading.account.withdraw.amount', 'Quantidade')}</Label>
                  <Input type="number" value={withdrawForm.amount} onChange={e => setWithdrawForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>{t('trading.account.withdraw.memo', 'Memo (opcional)')}</Label>
                  <Input value={withdrawForm.memo} onChange={e => setWithdrawForm(f => ({ ...f, memo: e.target.value }))} />
                </div>
                <div>
                  <Label>{t('trading.account.withdraw.chainField', 'Chain (opcional)')}</Label>
                  <Input value={withdrawForm.chain} onChange={e => setWithdrawForm(f => ({ ...f, chain: e.target.value }))} />
                </div>
                <Button className="w-full" onClick={() => withdrawMutation.mutate()} disabled={withdrawMutation.isPending || !withdrawForm.address || !withdrawForm.amount}>
                  {withdrawMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('trading.account.withdraw.confirm', 'Confirmar Withdrawal')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Histórico de withdrawals */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('trading.account.withdraw.history', 'Histórico de Withdrawals')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingWithdrawals ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : withdrawals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('trading.account.withdraw.empty', 'Nenhum withdrawal encontrado')}</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {withdrawals.map((w, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                      <div>
                        <span className="font-mono font-semibold">{w.amount} {w.currency}</span>
                        {w.fee && <span className="text-xs text-muted-foreground ml-2">fee: {w.fee}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(w.status)}
                        {w.status === 'PROCESSING' && w.id && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => cancelWithdrawalMutation.mutate(w.id!)}
                            disabled={cancelWithdrawalMutation.isPending}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

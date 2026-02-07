/**
 * SubAccountsPanel - Gestão de sub-contas KuCoin
 * 
 * Criar sub-contas, habilitar permissões Margin/Futures,
 * listar sub-contas e consultar balances.
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Users, Plus, Shield, ChevronDown, ChevronUp, Wallet } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export interface SubAccountsPanelProps {
  /** Callback opcional */
  onSubAccountCreated?: () => void;
}

interface SubAccount {
  userId?: string;
  uid?: number;
  subName?: string;
  status?: number;
  type?: number;
  access?: string;
  createdAt?: number;
  remarks?: string;
}

interface SubAccountBalance {
  subUserId?: string;
  subName?: string;
  mainAccounts?: { currency: string; balance: string; available: string; holds: string }[];
  tradeAccounts?: { currency: string; balance: string; available: string; holds: string }[];
  marginAccounts?: { currency: string; balance: string; available: string; holds: string }[];
}

export function SubAccountsPanel({ onSubAccountCreated }: SubAccountsPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ subName: '', password: '', access: 'Spot', remarks: '' });
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  // Listar sub-contas
  const { data: subAccountsRaw, isLoading } = useQuery<{ items?: SubAccount[] }>({
    queryKey: ['account', 'sub-accounts'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/account/sub-accounts?pageSize=50');
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 60_000,
  });

  // Balance de sub-conta específica
  const { data: subBalance, isLoading: loadingBalance } = useQuery<SubAccountBalance>({
    queryKey: ['account', 'sub-accounts', expandedSub, 'balance'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/account/sub-accounts/${expandedSub}/balance`);
      const json = await res.json();
      return json.data || json;
    },
    staleTime: 30_000,
    enabled: !!expandedSub,
  });

  // Criar sub-conta
  const createSubMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/integrations/trading/account/sub-accounts', {
        subName: createForm.subName,
        password: createForm.password,
        access: createForm.access,
        remarks: createForm.remarks || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.subAccounts.created', 'Sub-conta criada com sucesso') });
      setShowCreateDialog(false);
      setCreateForm({ subName: '', password: '', access: 'Spot', remarks: '' });
      queryClient.invalidateQueries({ queryKey: ['account', 'sub-accounts'] });
      onSubAccountCreated?.();
    },
    onError: (err: Error) => {
      toast({ title: t('trading.account.subAccounts.createError', 'Erro ao criar sub-conta'), description: err.message, variant: 'destructive' });
    },
  });

  // Habilitar margin
  const enableMarginMutation = useMutation({
    mutationFn: async (subUserId: string) => {
      const res = await apiRequest('POST', `/api/integrations/trading/account/sub-accounts/${subUserId}/margin`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.subAccounts.marginEnabled', 'Margin habilitada') });
      queryClient.invalidateQueries({ queryKey: ['account', 'sub-accounts'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  // Habilitar futures
  const enableFuturesMutation = useMutation({
    mutationFn: async (subUserId: string) => {
      const res = await apiRequest('POST', `/api/integrations/trading/account/sub-accounts/${subUserId}/futures`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('trading.account.subAccounts.futuresEnabled', 'Futures habilitado') });
      queryClient.invalidateQueries({ queryKey: ['account', 'sub-accounts'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const subAccounts = subAccountsRaw?.items || [];

  /** Renderiza balances de uma conta */
  const renderBalanceGroup = (label: string, accounts?: { currency: string; balance: string; available: string }[]) => {
    if (!accounts || accounts.length === 0) return null;
    return (
      <div className="space-y-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase">{label}</span>
        {accounts.map((a, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span>{a.currency}</span>
            <span className="font-mono">{a.balance} <span className="text-muted-foreground">(disp: {a.available})</span></span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t('trading.account.subAccounts.title', 'Sub-contas')}
        </h3>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              {t('trading.account.subAccounts.create', 'Criar Sub-conta')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('trading.account.subAccounts.createTitle', 'Nova Sub-conta')}</DialogTitle>
              <DialogDescription>{t('trading.account.subAccounts.createDesc', 'Crie uma sub-conta na KuCoin')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t('trading.account.subAccounts.name', 'Nome')}</Label>
                <Input value={createForm.subName} onChange={e => setCreateForm(f => ({ ...f, subName: e.target.value }))} placeholder="minha-sub-conta" />
              </div>
              <div>
                <Label>{t('trading.account.subAccounts.password', 'Senha')}</Label>
                <Input type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div>
                <Label>{t('trading.account.subAccounts.access', 'Acesso')}</Label>
                <Select value={createForm.access} onValueChange={v => setCreateForm(f => ({ ...f, access: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Spot">Spot</SelectItem>
                    <SelectItem value="Futures">Futures</SelectItem>
                    <SelectItem value="Margin">Margin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('trading.account.subAccounts.remarks', 'Observações (opcional)')}</Label>
                <Input value={createForm.remarks} onChange={e => setCreateForm(f => ({ ...f, remarks: e.target.value }))} />
              </div>
              <Button className="w-full" onClick={() => createSubMutation.mutate()} disabled={createSubMutation.isPending || !createForm.subName || !createForm.password}>
                {createSubMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('trading.account.subAccounts.confirmCreate', 'Criar')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Lista de sub-contas */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : subAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t('trading.account.subAccounts.empty', 'Nenhuma sub-conta encontrada')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {subAccounts.map((sub) => (
            <Card key={sub.userId || sub.uid}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedSub(expandedSub === sub.userId ? null : sub.userId || null)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{sub.subName || sub.userId}</CardTitle>
                    <Badge variant="outline">{sub.access || 'Spot'}</Badge>
                    {sub.remarks && <span className="text-xs text-muted-foreground">({sub.remarks})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost" size="sm"
                      onClick={(e) => { e.stopPropagation(); if (sub.userId) enableMarginMutation.mutate(sub.userId); }}
                      disabled={enableMarginMutation.isPending || !sub.userId}
                    >
                      <Shield className="h-3 w-3 mr-1" />
                      Margin
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={(e) => { e.stopPropagation(); if (sub.userId) enableFuturesMutation.mutate(sub.userId); }}
                      disabled={enableFuturesMutation.isPending || !sub.userId}
                    >
                      <Wallet className="h-3 w-3 mr-1" />
                      Futures
                    </Button>
                    {expandedSub === sub.userId ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {expandedSub === sub.userId && (
                <CardContent className="pt-0">
                  {loadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : subBalance ? (
                    <div className="space-y-3">
                      {renderBalanceGroup('Main (Funding)', subBalance.mainAccounts)}
                      {renderBalanceGroup('Trade (Spot)', subBalance.tradeAccounts)}
                      {renderBalanceGroup('Margin', subBalance.marginAccounts)}
                      {!subBalance.mainAccounts?.length && !subBalance.tradeAccounts?.length && !subBalance.marginAccounts?.length && (
                        <p className="text-xs text-muted-foreground">{t('trading.account.subAccounts.noBalance', 'Sem saldo')}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('trading.account.subAccounts.loadError', 'Erro ao carregar saldo')}</p>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

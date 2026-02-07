/**
 * MarginDebitPanel - Painel para operações de empréstimo Margin
 *
 * Permite tomar emprestado (borrow), devolver (repay) e visualizar
 * histórico de juros na conta Margin.
 *
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, Percent, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export interface MarginDebitPanelProps {
  /** Moeda padrão para borrow/repay */
  defaultCurrency?: string;
}

interface BorrowForm {
  currency: string;
  size: string;
  timeInForce: 'IOC' | 'FOK';
}

interface RepayForm {
  currency: string;
  size: string;
}

interface BorrowRecord {
  orderNo: string;
  currency: string;
  size: string;
  actualSize?: string;
  status: string;
  createdAt?: number;
}

interface RepayRecord {
  orderNo: string;
  currency: string;
  size: string;
  actualSize?: string;
  status: string;
  createdAt?: number;
}

interface LendingRate {
  currency: string;
  dailyInterestRate: string;
  annualInterestRate?: string;
}

export function MarginDebitPanel({ defaultCurrency = 'USDT' }: MarginDebitPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('borrow');

  const [borrowForm, setBorrowForm] = useState<BorrowForm>({
    currency: defaultCurrency,
    size: '',
    timeInForce: 'IOC',
  });

  const [repayForm, setRepayForm] = useState<RepayForm>({
    currency: defaultCurrency,
    size: '',
  });

  // Query: taxas de juros atuais
  const { data: lendingRates, isLoading: isLoadingRates } = useQuery<LendingRate[]>({
    queryKey: ['/api/integrations/trading/margin/lending-rates'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/margin/lending-rates');
      const json = await res.json();
      return json.data ?? json;
    },
    refetchInterval: 60_000, // Atualizar taxas a cada 1 minuto
  });

  // Query: histórico de empréstimos
  const { data: borrowHistory, isLoading: isLoadingBorrow } = useQuery<BorrowRecord[]>({
    queryKey: ['/api/integrations/trading/margin/borrow'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/margin/borrow');
      const json = await res.json();
      return json.data?.items ?? json.items ?? [];
    },
  });

  // Query: histórico de pagamentos
  const { data: repayHistory, isLoading: isLoadingRepay } = useQuery<RepayRecord[]>({
    queryKey: ['/api/integrations/trading/margin/repay'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/margin/repay');
      const json = await res.json();
      return json.data?.items ?? json.items ?? [];
    },
  });

  // Mutation: tomar emprestado
  const borrowMutation = useMutation({
    mutationFn: async (form: BorrowForm) => {
      const res = await apiRequest('POST', '/api/integrations/trading/margin/borrow', {
        currency: form.currency,
        size: form.size,
        timeInForce: form.timeInForce,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.margin.borrowSuccess'),
        description: t('trading.margin.borrowSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/margin/borrow'] });
      setBorrowForm({ ...borrowForm, size: '' });
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.margin.borrowError'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation: devolver
  const repayMutation = useMutation({
    mutationFn: async (form: RepayForm) => {
      const res = await apiRequest('POST', '/api/integrations/trading/margin/repay', {
        currency: form.currency,
        size: form.size,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.margin.repaySuccess'),
        description: t('trading.margin.repaySuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/margin/repay'] });
      setRepayForm({ ...repayForm, size: '' });
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.margin.repayError'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const currentRate = lendingRates?.find((r) => r.currency === borrowForm.currency);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="h-5 w-5" />
          {t('trading.margin.debitTitle')}
        </CardTitle>
        <CardDescription>
          {t('trading.margin.debitSubtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="borrow">
              <ArrowDownToLine className="h-4 w-4 mr-1" />
              {t('trading.margin.borrow')}
            </TabsTrigger>
            <TabsTrigger value="repay">
              <ArrowUpFromLine className="h-4 w-4 mr-1" />
              {t('trading.margin.repay')}
            </TabsTrigger>
            <TabsTrigger value="rates">
              <Percent className="h-4 w-4 mr-1" />
              {t('trading.margin.rates')}
            </TabsTrigger>
          </TabsList>

          {/* Aba Borrow */}
          <TabsContent value="borrow" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{t('trading.margin.currency')}</Label>
                <Input
                  value={borrowForm.currency}
                  onChange={(e) => setBorrowForm({ ...borrowForm, currency: e.target.value.toUpperCase() })}
                  placeholder="USDT"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('trading.margin.amount')}</Label>
                <Input
                  type="number"
                  value={borrowForm.size}
                  onChange={(e) => setBorrowForm({ ...borrowForm, size: e.target.value })}
                  placeholder="100"
                />
              </div>
              {currentRate && (
                <p className="text-xs text-muted-foreground">
                  {t('trading.margin.dailyRate')}: {(Number(currentRate.dailyInterestRate) * 100).toFixed(4)}%
                </p>
              )}
              <Button
                onClick={() => borrowMutation.mutate(borrowForm)}
                disabled={!borrowForm.size || Number(borrowForm.size) <= 0 || borrowMutation.isPending}
                className="w-full"
              >
                {borrowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowDownToLine className="h-4 w-4 mr-2" />
                )}
                {t('trading.margin.borrowAction')}
              </Button>
            </div>

            {/* Histórico de empréstimos */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">{t('trading.margin.borrowHistory')}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/margin/borrow'] })}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
              {isLoadingBorrow ? (
                <Skeleton className="h-24" />
              ) : !borrowHistory?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('trading.margin.noHistory')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('trading.margin.currency')}</TableHead>
                      <TableHead>{t('trading.margin.amount')}</TableHead>
                      <TableHead>{t('trading.margin.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {borrowHistory.slice(0, 5).map((record) => (
                      <TableRow key={record.orderNo}>
                        <TableCell>{record.currency}</TableCell>
                        <TableCell>{record.actualSize ?? record.size}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{record.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Aba Repay */}
          <TabsContent value="repay" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{t('trading.margin.currency')}</Label>
                <Input
                  value={repayForm.currency}
                  onChange={(e) => setRepayForm({ ...repayForm, currency: e.target.value.toUpperCase() })}
                  placeholder="USDT"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('trading.margin.amount')}</Label>
                <Input
                  type="number"
                  value={repayForm.size}
                  onChange={(e) => setRepayForm({ ...repayForm, size: e.target.value })}
                  placeholder="100"
                />
              </div>
              <Button
                onClick={() => repayMutation.mutate(repayForm)}
                disabled={!repayForm.size || Number(repayForm.size) <= 0 || repayMutation.isPending}
                className="w-full"
              >
                {repayMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="h-4 w-4 mr-2" />
                )}
                {t('trading.margin.repayAction')}
              </Button>
            </div>

            {/* Histórico de pagamentos */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">{t('trading.margin.repayHistory')}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/margin/repay'] })}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
              {isLoadingRepay ? (
                <Skeleton className="h-24" />
              ) : !repayHistory?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('trading.margin.noHistory')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('trading.margin.currency')}</TableHead>
                      <TableHead>{t('trading.margin.amount')}</TableHead>
                      <TableHead>{t('trading.margin.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {repayHistory.slice(0, 5).map((record) => (
                      <TableRow key={record.orderNo}>
                        <TableCell>{record.currency}</TableCell>
                        <TableCell>{record.actualSize ?? record.size}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{record.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Aba Rates */}
          <TabsContent value="rates" className="mt-4">
            {isLoadingRates ? (
              <Skeleton className="h-32" />
            ) : !lendingRates?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('trading.margin.noRates')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('trading.margin.currency')}</TableHead>
                    <TableHead>{t('trading.margin.dailyRate')}</TableHead>
                    <TableHead>{t('trading.margin.annualRate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lendingRates.map((rate) => (
                    <TableRow key={rate.currency}>
                      <TableCell className="font-medium">{rate.currency}</TableCell>
                      <TableCell>{(Number(rate.dailyInterestRate) * 100).toFixed(4)}%</TableCell>
                      <TableCell>
                        {rate.annualInterestRate
                          ? `${(Number(rate.annualInterestRate) * 100).toFixed(2)}%`
                          : `~${(Number(rate.dailyInterestRate) * 365 * 100).toFixed(2)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Wallet,
  Send,
  Users,
  Calculator,
  Layers,
  History,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  ArrowLeftRight,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';

interface WiseBalance {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount?: {
    value: number;
    currency: string;
  };
  totalWorth?: {
    value: number;
    currency: string;
  };
}

interface WiseTransfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount: number;
  quote: number;
  status: string;
  reference: string;
  rate: number;
  created: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceValue: number;
  targetValue: number;
  customerTransactionId: string;
}

interface WiseRecipient {
  id: number;
  business: number | null;
  profile: number;
  accountHolderName: string;
  type: string;
  country: string;
  currency: string;
  active: boolean;
}

interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fee: number;
  expirationTime: string | null;
  deliveryEstimate: string | null;
  formattedEstimatedDelivery: string | null;
}

interface WiseBatchGroup {
  id: string;
  name: string;
  status: string;
  sourceCurrency: string;
  version: number;
  created: string;
}

interface WiseBalanceStatement {
  type: string;
  amount: { value: number; currency: string };
  date: string;
  note?: string;
  totalFees?: { value: number; currency: string };
  reference?: string;
  runningBalance?: { value: number; currency: string };
}

interface WiseBalanceStatementResponse {
  accountId: number;
  currency: string;
  intervalStart: string;
  intervalEnd: string;
  transactions: WiseBalanceStatement[];
}

interface WiseStatus {
  configured: boolean;
  sandbox: boolean;
  profileId: string | null;
}

interface WiseBalancesResponse {
  balances: WiseBalance[];
  sandbox: boolean;
}

interface WiseTransfersResponse {
  transfers: WiseTransfer[];
}

interface WiseRecipientsResponse {
  recipients: WiseRecipient[];
}

interface WiseBatchGroupsResponse {
  batchGroups: WiseBatchGroup[];
}

const CURRENCIES = [
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
];

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'outgoing_payment_sent':
    case 'funds_converted':
      return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Completed</Badge>;
    case 'processing':
    case 'incoming_payment_waiting':
    case 'waiting_recipient_input_to_proceed':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Processing</Badge>;
    case 'cancelled':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Cancelled</Badge>;
    case 'failed':
    case 'bounced_back':
      return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function WisePayments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const [activeTab, setActiveTab] = useState('balances');
  const [quoteForm, setQuoteForm] = useState({
    sourceCurrency: 'EUR',
    targetCurrency: 'USD',
    sourceAmount: '',
  });
  const [exchangeForm, setExchangeForm] = useState({
    sourceCurrency: 'EUR',
    targetCurrency: 'USD',
    sourceAmount: '',
  });
  const [statementForm, setStatementForm] = useState({
    balanceId: '',
    currency: 'EUR',
    intervalStart: '',
    intervalEnd: '',
  });
  const [statementData, setStatementData] = useState<WiseBalanceStatementResponse | null>(null);
  const [showNewRecipientDialog, setShowNewRecipientDialog] = useState(false);
  const [showNewBalanceDialog, setShowNewBalanceDialog] = useState(false);
  const [newBalanceForm, setNewBalanceForm] = useState({
    currency: 'EUR',
    type: 'STANDARD' as 'STANDARD' | 'SAVINGS',
    name: '',
  });

  const { data: statusData, isLoading: isLoadingStatus } = useQuery<WiseStatus>({
    queryKey: ['/api/integrations/wise/status'],
  });

  const { data: balancesData, isLoading: isLoadingBalances, refetch: refetchBalances } = useQuery<WiseBalancesResponse>({
    queryKey: ['/api/integrations/wise/balances'],
    enabled: statusData?.configured,
  });

  const { data: transfersData, isLoading: isLoadingTransfers, refetch: refetchTransfers } = useQuery<WiseTransfersResponse>({
    queryKey: ['/api/integrations/wise/transfers'],
    enabled: statusData?.configured,
  });

  const { data: recipientsData, isLoading: isLoadingRecipients, refetch: refetchRecipients } = useQuery<WiseRecipientsResponse>({
    queryKey: ['/api/integrations/wise/recipients'],
    enabled: statusData?.configured,
  });

  const { data: batchGroupsData, isLoading: isLoadingBatchGroups, refetch: refetchBatchGroups } = useQuery<WiseBatchGroupsResponse>({
    queryKey: ['/api/integrations/wise/batch-groups'],
    enabled: statusData?.configured,
  });

  const createQuoteMutation = useMutation({
    mutationFn: async (data: { sourceCurrency: string; targetCurrency: string; sourceAmount: number }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/quotes', data);
      return res.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      toast({
        title: t('wise.success.quoteCreated'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: () => {
      toast({
        title: t('wise.errors.quoteFailed'),
        variant: 'destructive',
      });
    },
  });

  const createBalanceMutation = useMutation({
    mutationFn: async (payload: { currency: string; type: 'STANDARD' | 'SAVINGS'; name?: string }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balances', payload);
      return res.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      setShowNewBalanceDialog(false);
      setNewBalanceForm({ currency: 'EUR', type: 'STANDARD', name: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.balances.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.balanceCreateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteBalanceMutation = useMutation({
    mutationFn: async (balanceId: number) => {
      const res = await apiRequest('DELETE', `/api/integrations/wise/balances/${balanceId}`);
      return res.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.balances.deleted') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.balanceDeleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeQuoteMutation = useMutation({
    mutationFn: async (payload: { sourceCurrency: string; targetCurrency: string; sourceAmount: number }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balance-quotes', payload);
      return res.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      toast({
        title: t('wise.exchange.quoteReady'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: (error) => {
      toast({
        title: t('wise.exchange.quoteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeExecuteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balance-movements', { quoteId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.exchange.completed') });
    },
    onError: (error) => {
      toast({
        title: t('wise.exchange.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const statementMutation = useMutation({
    mutationFn: async (payload: { balanceId: string; currency: string; intervalStart: string; intervalEnd: string }) => {
      const params = new URLSearchParams({
        currency: payload.currency,
        intervalStart: payload.intervalStart,
        intervalEnd: payload.intervalEnd,
      });
      const res = await apiRequest('GET', `/api/integrations/wise/balances/${payload.balanceId}/statement?${params.toString()}`);
      return res.json() as Promise<{ statement: WiseBalanceStatementResponse }>;
    },
    onSuccess: (data) => {
      setStatementData(data.statement);
    },
    onError: (error) => {
      toast({
        title: t('wise.history.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteRecipientMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/integrations/wise/recipients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/recipients'] });
      toast({
        title: t('wise.success.recipientDeleted'),
      });
    },
    onError: () => {
      toast({
        title: t('wise.errors.deleteFailed'),
        variant: 'destructive',
      });
    },
  });

  const handleGetQuote = () => {
    if (!quoteForm.sourceAmount) return;
    createQuoteMutation.mutate({
      sourceCurrency: quoteForm.sourceCurrency,
      targetCurrency: quoteForm.targetCurrency,
      sourceAmount: parseFloat(quoteForm.sourceAmount),
    });
  };

  const handleGetExchangeQuote = () => {
    if (!exchangeForm.sourceAmount) return;
    exchangeQuoteMutation.mutate({
      sourceCurrency: exchangeForm.sourceCurrency,
      targetCurrency: exchangeForm.targetCurrency,
      sourceAmount: parseFloat(exchangeForm.sourceAmount),
    });
  };

  const handleExecuteExchange = () => {
    const quote = (exchangeQuoteMutation.data as { quote: WiseQuote } | undefined)?.quote;
    if (!quote?.id) return;
    exchangeExecuteMutation.mutate(quote.id);
  };

  const handleFetchStatement = () => {
    if (!statementForm.balanceId || !statementForm.intervalStart || !statementForm.intervalEnd) {
      toast({ title: t('wise.history.missingParams'), variant: 'destructive' });
      return;
    }
    const startIso = new Date(`${statementForm.intervalStart}T00:00:00.000Z`).toISOString();
    const endIso = new Date(`${statementForm.intervalEnd}T23:59:59.999Z`).toISOString();
    statementMutation.mutate({
      balanceId: statementForm.balanceId,
      currency: statementForm.currency,
      intervalStart: startIso,
      intervalEnd: endIso,
    });
  };

  const handleCreateBalance = () => {
    if (newBalanceForm.type === 'SAVINGS' && !newBalanceForm.name.trim()) {
      toast({ title: t('wise.balances.nameRequired'), variant: 'destructive' });
      return;
    }
    const payload = {
      currency: newBalanceForm.currency,
      type: newBalanceForm.type,
      name: newBalanceForm.type === 'SAVINGS' ? newBalanceForm.name.trim() : undefined,
    };
    createBalanceMutation.mutate(payload);
  };

  const handleDeleteRecipient = (id: number) => {
    if (window.confirm(t('wise.recipients.confirmDelete'))) {
      deleteRecipientMutation.mutate(id);
    }
  };

  const handleDeleteBalance = (balanceId: number) => {
    if (window.confirm(t('wise.balances.confirmDelete'))) {
      deleteBalanceMutation.mutate(balanceId);
    }
  };

  if (isLoadingStatus) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!statusData?.configured) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('wise.notConfigured')}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Configure WISE_API_KEY e WISE_PROFILE_ID para ativar os pagamentos Wise.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const balances = (balancesData?.balances || []) as WiseBalance[];
  const transfers = (transfersData?.transfers || []) as WiseTransfer[];
  const recipients = (recipientsData?.recipients || []) as WiseRecipient[];
  const batchGroups = (batchGroupsData?.batchGroups || []) as WiseBatchGroup[];
  const balanceCurrencies = Array.from(new Set(balances.map((balance) => balance.currency)));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-wise-title">{t('wise.title')}</h1>
          <p className="text-muted-foreground">{t('wise.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {statusData?.sandbox && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-600">
              {t('wise.sandbox')}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchBalances();
              refetchTransfers();
              refetchRecipients();
              refetchBatchGroups();
            }}
            data-testid="button-wise-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href="https://erp.yesyoudeserve.duckdns.org"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-erpnext"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('erpnext.openErpnext')}
            </a>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-7 gap-1">
          <TabsTrigger value="balances" data-testid="tab-balances">
            <Wallet className="h-4 w-4 mr-2" />
            {t('wise.balances.title')}
          </TabsTrigger>
          <TabsTrigger value="exchange" data-testid="tab-exchange">
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            {t('wise.exchange.title')}
          </TabsTrigger>
          <TabsTrigger value="transfers" data-testid="tab-transfers">
            <Send className="h-4 w-4 mr-2" />
            {t('wise.transfers.title')}
          </TabsTrigger>
          <TabsTrigger value="recipients" data-testid="tab-recipients">
            <Users className="h-4 w-4 mr-2" />
            {t('wise.recipients.title')}
          </TabsTrigger>
          <TabsTrigger value="quotes" data-testid="tab-quotes">
            <Calculator className="h-4 w-4 mr-2" />
            {t('wise.quotes.title')}
          </TabsTrigger>
          <TabsTrigger value="batch" data-testid="tab-batch">
            <Layers className="h-4 w-4 mr-2" />
            {t('wise.batch.title')}
          </TabsTrigger>
          <TabsTrigger value="statements" data-testid="tab-statements">
            <FileText className="h-4 w-4 mr-2" />
            {t('wise.history.title')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.balances.subtitle')}</CardDescription>
            <Dialog open={showNewBalanceDialog} onOpenChange={setShowNewBalanceDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-balance">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('wise.balances.new')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('wise.balances.new')}</DialogTitle>
                  <DialogDescription>{t('wise.balances.newDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('wise.balances.currency')}</Label>
                    <Select
                      value={newBalanceForm.currency}
                      onValueChange={(value: string) => setNewBalanceForm((prev) => ({ ...prev, currency: value }))}
                    >
                      <SelectTrigger data-testid="select-balance-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((curr) => (
                          <SelectItem key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.balances.type')}</Label>
                    <Select
                      value={newBalanceForm.type}
                      onValueChange={(value: 'STANDARD' | 'SAVINGS') => setNewBalanceForm((prev) => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger data-testid="select-balance-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">{t('wise.balances.standard')}</SelectItem>
                        <SelectItem value="SAVINGS">{t('wise.balances.savings')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newBalanceForm.type === 'SAVINGS' && (
                    <div className="space-y-2">
                      <Label>{t('wise.balances.name')}</Label>
                      <Input
                        value={newBalanceForm.name}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setNewBalanceForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder={t('wise.balances.namePlaceholder')}
                        data-testid="input-balance-name"
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewBalanceDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={handleCreateBalance}
                    disabled={createBalanceMutation.isPending}
                    data-testid="button-save-balance"
                  >
                    {createBalanceMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {isLoadingBalances ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          ) : balances.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.balances.noBalances')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {balances.map((balance) => (
                <Card key={balance.id} data-testid={`card-balance-${balance.currency}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{balance.currency}</Badge>
                        <Badge variant="secondary" className="text-xs">
                          {balance.type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteBalance(balance.id)}
                        data-testid={`button-delete-balance-${balance.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(balance.amount.value, balance.currency, locale)}
                    </div>
                    {balance.name && (
                      <p className="text-sm text-muted-foreground mt-1">{balance.name}</p>
                    )}
                    {balance.reservedAmount && balance.reservedAmount.value > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('wise.balances.reserved')}: {' '}
                        {formatCurrency(balance.reservedAmount.value, balance.currency, locale)}
                      </p>
                    )}
                    {balance.totalWorth && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('wise.balances.total')}: {' '}
                        {formatCurrency(balance.totalWorth.value, balance.totalWorth.currency, locale)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="exchange" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.exchange.title')}</CardTitle>
              <CardDescription>{t('wise.exchange.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {balanceCurrencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('wise.exchange.noBalances')}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.from')}</Label>
                    <Select
                      value={exchangeForm.sourceCurrency}
                      onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, sourceCurrency: value }))}
                    >
                      <SelectTrigger data-testid="select-exchange-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.amount')}</Label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={exchangeForm.sourceAmount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExchangeForm((prev) => ({ ...prev, sourceAmount: e.target.value }))}
                      data-testid="input-exchange-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.to')}</Label>
                    <Select
                      value={exchangeForm.targetCurrency}
                      onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, targetCurrency: value }))}
                    >
                      <SelectTrigger data-testid="select-exchange-target">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={handleGetExchangeQuote}
                      disabled={!exchangeForm.sourceAmount || exchangeQuoteMutation.isPending}
                      data-testid="button-exchange-quote"
                    >
                      {exchangeQuoteMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                      )}
                      {t('wise.exchange.getQuote')}
                    </Button>
                  </div>
                </div>
              )}

              {exchangeQuoteMutation.data && (
                <Card className="mt-4 bg-muted/50">
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
                        <p className="text-lg font-medium">
                          {formatNumber((exchangeQuoteMutation.data as { quote: WiseQuote }).quote.rate, locale, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
                        <p className="text-lg font-medium">
                          {formatCurrency(
                            (exchangeQuoteMutation.data as { quote: WiseQuote }).quote.fee,
                            exchangeForm.sourceCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.exchange.receive')}</p>
                        <p className="text-lg font-medium text-green-600">
                          {formatCurrency(
                            (exchangeQuoteMutation.data as { quote: WiseQuote }).quote.targetAmount,
                            exchangeForm.targetCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.expires')}</p>
                        <p className="text-lg font-medium">
                          {(exchangeQuoteMutation.data as { quote: WiseQuote }).quote.expirationTime
                            ? formatDate((exchangeQuoteMutation.data as { quote: WiseQuote }).quote.expirationTime as string, { locale, timeZone })
                            : '-'}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={handleExecuteExchange}
                      disabled={exchangeExecuteMutation.isPending}
                      data-testid="button-exchange-execute"
                    >
                      {exchangeExecuteMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                      )}
                      {t('wise.exchange.execute')}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfers" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.transfers.subtitle')}</CardDescription>
            <Button data-testid="button-new-transfer">
              <Plus className="h-4 w-4 mr-2" />
              {t('wise.transfers.new')}
            </Button>
          </div>

          {isLoadingTransfers ? (
            <Skeleton className="h-64" />
          ) : transfers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Send className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.transfers.noTransfers')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.transfers.amount')}</TableHead>
                    <TableHead>{t('wise.transfers.recipient')}</TableHead>
                    <TableHead>{t('wise.transfers.reference')}</TableHead>
                    <TableHead>{t('wise.transfers.status')}</TableHead>
                    <TableHead>{t('wise.transfers.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer) => (
                    <TableRow key={transfer.id} data-testid={`row-transfer-${transfer.id}`}>
                      <TableCell className="font-mono">{transfer.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCurrency(transfer.sourceValue, transfer.sourceCurrency, locale)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          → {formatCurrency(transfer.targetValue, transfer.targetCurrency, locale)}
                        </div>
                      </TableCell>
                      <TableCell>{transfer.targetAccount}</TableCell>
                      <TableCell>{transfer.reference || '-'}</TableCell>
                      <TableCell>{getStatusBadge(transfer.status)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(transfer.created, { locale, timeZone })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.recipients.subtitle')}</CardDescription>
            <Dialog open={showNewRecipientDialog} onOpenChange={setShowNewRecipientDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-recipient">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('wise.recipients.new')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('wise.recipients.new')}</DialogTitle>
                  <DialogDescription>{t('wise.recipients.subtitle')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.name')}</Label>
                    <Input placeholder="John Doe" data-testid="input-recipient-name" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.currency')}</Label>
                    <Select>
                      <SelectTrigger data-testid="select-recipient-currency">
                        <SelectValue placeholder={t('wise.recipients.currency')} />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((curr) => (
                          <SelectItem key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.iban')}</Label>
                    <Input placeholder="PT50..." data-testid="input-recipient-iban" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewRecipientDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button data-testid="button-save-recipient">
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoadingRecipients ? (
            <Skeleton className="h-64" />
          ) : recipients.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.recipients.noRecipients')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.recipients.name')}</TableHead>
                    <TableHead>{t('wise.recipients.currency')}</TableHead>
                    <TableHead>{t('wise.recipients.accountType')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((recipient) => (
                    <TableRow key={recipient.id} data-testid={`row-recipient-${recipient.id}`}>
                      <TableCell className="font-mono">{recipient.id}</TableCell>
                      <TableCell className="font-medium">{recipient.accountHolderName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{recipient.currency}</Badge>
                      </TableCell>
                      <TableCell>{recipient.type}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRecipient(recipient.id)}
                          data-testid={`button-delete-recipient-${recipient.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="quotes" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.quotes.title')}</CardTitle>
              <CardDescription>{t('wise.quotes.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.quotes.from')}</Label>
                  <Select
                    value={quoteForm.sourceCurrency}
                    onValueChange={(value: string) => setQuoteForm({ ...quoteForm, sourceCurrency: value })}
                  >
                    <SelectTrigger data-testid="select-quote-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((curr) => (
                        <SelectItem key={curr.code} value={curr.code}>
                          {curr.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.quotes.amount')}</Label>
                  <Input
                    type="number"
                    placeholder="1000"
                    value={quoteForm.sourceAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuoteForm({ ...quoteForm, sourceAmount: e.target.value })}
                    data-testid="input-quote-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.quotes.to')}</Label>
                  <Select
                    value={quoteForm.targetCurrency}
                    onValueChange={(value: string) => setQuoteForm({ ...quoteForm, targetCurrency: value })}
                  >
                    <SelectTrigger data-testid="select-quote-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((curr) => (
                        <SelectItem key={curr.code} value={curr.code}>
                          {curr.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    onClick={handleGetQuote}
                    disabled={!quoteForm.sourceAmount || createQuoteMutation.isPending}
                    data-testid="button-get-quote"
                  >
                    {createQuoteMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Calculator className="h-4 w-4 mr-2" />
                    )}
                    {t('wise.quotes.getQuote')}
                  </Button>
                </div>
              </div>

              {createQuoteMutation.data && (
                <Card className="mt-4 bg-muted/50">
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
                        <p className="text-lg font-medium">
                          {formatNumber((createQuoteMutation.data as { quote: WiseQuote }).quote.rate, locale, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
                        <p className="text-lg font-medium">
                          {formatCurrency(
                            (createQuoteMutation.data as { quote: WiseQuote }).quote.fee,
                            quoteForm.sourceCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.receive')}</p>
                        <p className="text-lg font-medium text-green-600">
                          {formatCurrency(
                            (createQuoteMutation.data as { quote: WiseQuote }).quote.targetAmount,
                            quoteForm.targetCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.delivery')}</p>
                        <p className="text-lg font-medium">
                          {(createQuoteMutation.data as { quote: WiseQuote }).quote.deliveryEstimate
                            ? formatDate((createQuoteMutation.data as { quote: WiseQuote }).quote.deliveryEstimate as string, { locale, timeZone })
                            : ((createQuoteMutation.data as { quote: WiseQuote }).quote.formattedEstimatedDelivery ?? '-')}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.batch.subtitle')}</CardDescription>
            <Button data-testid="button-new-batch">
              <Plus className="h-4 w-4 mr-2" />
              {t('wise.batch.new')}
            </Button>
          </div>

          {isLoadingBatchGroups ? (
            <Skeleton className="h-64" />
          ) : batchGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.batch.noBatches')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.batch.name')}</TableHead>
                    <TableHead>{t('wise.batch.status')}</TableHead>
                    <TableHead>{t('wise.recipients.currency')}</TableHead>
                    <TableHead>{t('wise.transfers.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchGroups.map((batch) => (
                    <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                      <TableCell className="font-mono">{batch.id}</TableCell>
                      <TableCell className="font-medium">{batch.name}</TableCell>
                      <TableCell>{getStatusBadge(batch.status)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{batch.sourceCurrency}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(batch.created, { locale, timeZone })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="statements" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.history.title')}</CardTitle>
              <CardDescription>{t('wise.history.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.history.balance')}</Label>
                  <Select
                    value={statementForm.balanceId}
                    onValueChange={(value: string) => setStatementForm((prev) => ({ ...prev, balanceId: value }))}
                  >
                    <SelectTrigger data-testid="select-statement-balance">
                      <SelectValue placeholder={t('wise.history.balancePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {balances.map((balance) => (
                        <SelectItem key={balance.id} value={String(balance.id)}>
                          {balance.currency} • {balance.type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.currency')}</Label>
                  <Select
                    value={statementForm.currency}
                    onValueChange={(value: string) => setStatementForm((prev) => ({ ...prev, currency: value }))}
                  >
                    <SelectTrigger data-testid="select-statement-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.start')}</Label>
                  <Input
                    type="date"
                    value={statementForm.intervalStart}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setStatementForm((prev) => ({ ...prev, intervalStart: event.target.value }))
                    }
                    data-testid="input-statement-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.end')}</Label>
                  <Input
                    type="date"
                    value={statementForm.intervalEnd}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setStatementForm((prev) => ({ ...prev, intervalEnd: event.target.value }))
                    }
                    data-testid="input-statement-end"
                  />
                </div>
              </div>
              <Button
                onClick={handleFetchStatement}
                disabled={statementMutation.isPending}
                data-testid="button-fetch-statement"
              >
                {statementMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <History className="h-4 w-4 mr-2" />
                )}
                {t('wise.history.fetch')}
              </Button>

              {statementData ? (
                statementData.transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('wise.history.noHistory')}</p>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('wise.history.date')}</TableHead>
                          <TableHead>{t('wise.history.type')}</TableHead>
                          <TableHead>{t('wise.history.amount')}</TableHead>
                          <TableHead>{t('wise.history.fees')}</TableHead>
                          <TableHead>{t('wise.history.reference')}</TableHead>
                          <TableHead>{t('wise.history.balanceAfter')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.transactions.map((row, index) => (
                          <TableRow key={`${row.date}-${index}`}>
                            <TableCell>{formatDate(row.date, { locale, timeZone })}</TableCell>
                            <TableCell>{row.type}</TableCell>
                            <TableCell>
                              {formatCurrency(row.amount.value, row.amount.currency, locale)}
                            </TableCell>
                            <TableCell>
                              {row.totalFees
                                ? formatCurrency(row.totalFees.value, row.totalFees.currency, locale)
                                : '-'}
                            </TableCell>
                            <TableCell>{row.reference || '-'}</TableCell>
                            <TableCell>
                              {row.runningBalance
                                ? formatCurrency(row.runningBalance.value, row.runningBalance.currency, locale)
                                : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )
              ) : (
                <p className="text-sm text-muted-foreground">{t('wise.history.noHistory')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

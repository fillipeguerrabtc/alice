/**
 * Integrations - Configuração e Status das Integrações
 * 
 * Página para visualizar status e configurar integrações:
 * Stripe, Wise, ERPNext, Twilio, Gmail SMTP, KuCoin Futures
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { motion } from 'framer-motion';
import {
  CreditCard,
  Building2,
  Send,
  MessageSquare,
  Mail,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Settings,
  Link,
  Globe,
  Shield,
  LineChart,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface IntegrationMetric {
  name: string;
  configured: boolean;
  operational: boolean;
}

interface IntegrationMetricsResponse {
  integrations: IntegrationMetric[];
  timestamp: string;
}

interface WiseStatusResponse {
  configured: boolean;
  sandbox: boolean;
  profileId: string | null;
  circuitBreaker: {
    state: string;
    stats: Record<string, number>;
  };
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  prices: Array<{
    id: string;
    currency: string;
    unit_amount: number;
    type: string;
    recurring?: {
      interval: string;
      interval_count: number;
    };
  }>;
}

interface StripeProductsResponse {
  products: StripeProduct[];
}

interface WiseBalance {
  id: number;
  currency: string;
  amount: {
    value: number;
    currency: string;
  };
}

interface WiseBalancesResponse {
  balances: WiseBalance[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
} as const;

interface IntegrationCardProps {
  name: string;
  description: string;
  icon: React.ElementType;
  status: { configured: boolean; operational: boolean };
  onConfigure?: () => void;
  onTest?: () => void;
  testLoading?: boolean;
  children?: React.ReactNode;
  t: TFunction;
}

function IntegrationCard({ 
  name, 
  description, 
  icon: Icon, 
  status, 
  onConfigure, 
  onTest, 
  testLoading,
  children,
  t
}: IntegrationCardProps) {
  const isOperational = status.operational;
  const isConfigured = status.configured;
  return (
    <motion.div variants={itemVariants}>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isOperational ? 'bg-green-500/10' : 'bg-muted'}`}>
                <Icon className={`h-6 w-6 ${isOperational ? 'text-green-600' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <CardTitle className="text-base">{name}</CardTitle>
                <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
              </div>
            </div>
            {isOperational ? (
              <Badge className="bg-green-500/10 text-green-600 shrink-0">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {t('common.active')}
              </Badge>
            ) : isConfigured ? (
              <Badge variant="outline" className="shrink-0">
                <AlertCircle className="h-3 w-3 mr-1" />
                {t('integrations.unhealthy')}
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">
                <XCircle className="h-3 w-3 mr-1" />
                {t('integrations.pending')}
              </Badge>
            )}
          </div>
        </CardHeader>

        {children && (
          <CardContent className="pt-0 pb-3">
            {children}
          </CardContent>
        )}

        <CardFooter className="gap-2 pt-3 border-t">
          {onConfigure && (
            <Button variant="outline" size="sm" onClick={onConfigure} data-testid={`button-config-${name.toLowerCase()}`}>
              <Settings className="h-3 w-3 mr-1" />
              {t('integrations.configure')}
            </Button>
          )}
          {onTest && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onTest} 
              disabled={!isConfigured || testLoading}
              data-testid={`button-test-${name.toLowerCase()}`}
            >
              {testLoading ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              {t('integrations.test')}
            </Button>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function StripeSection({
  status,
  t,
  locale,
}: {
  status: { configured: boolean; operational: boolean };
  t: TFunction;
  locale: string;
}) {
  const { data, isLoading } = useQuery<StripeProductsResponse>({
    queryKey: ['/api/integrations/stripe/products'],
    enabled: status.operational,
    staleTime: 1000 * 60 * 5,
  });

  if (!status.configured) {
    return (
      <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
        {t('integrations.stripe.configureHint')}
      </div>
    );
  }

  if (!status.operational) {
    return (
      <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
        {t('integrations.unhealthyHint', { name: 'Stripe' })}
      </div>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-20" />;
  }

  const products = data?.products || [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CreditCard className="h-3 w-3" />
        <span>{t('integrations.stripe.productsConfigured', { count: products.length })}</span>
      </div>
      {products.slice(0, 3).map((product) => (
        <div key={product.id} className="p-2 bg-muted/50 rounded text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{product.name}</span>
            {product.active ? (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">{t('common.active')}</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">{t('common.inactive')}</Badge>
            )}
          </div>
          {product.prices.length > 0 && (
            <div className="text-muted-foreground mt-1">
              {product.prices
                .map(
                  (p) =>
                    `${formatNumber(p.unit_amount / 100, locale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} ${p.currency.toUpperCase()}${p.recurring ? `/${p.recurring.interval}` : ''}`
                )
                .join(', ')}
            </div>
          )}
        </div>
      ))}
      {products.length > 3 && (
        <p className="text-xs text-muted-foreground">{t('integrations.stripe.moreProducts', { count: products.length - 3 })}</p>
      )}
    </div>
  );
}

function WiseSection({
  status: integrationStatus,
  t,
  locale,
}: {
  status: { configured: boolean; operational: boolean };
  t: TFunction;
  locale: string;
}) {
  const { data: status } = useQuery<WiseStatusResponse>({
    queryKey: ['/api/integrations/wise/status'],
    enabled: integrationStatus.operational,
    staleTime: 1000 * 30,
  });

  const { data: balances, isLoading } = useQuery<WiseBalancesResponse>({
    queryKey: ['/api/integrations/wise/balances'],
    enabled: integrationStatus.operational,
    staleTime: 1000 * 60,
  });

  if (!integrationStatus.configured) {
    return (
      <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
        {t('integrations.wise.configureHint')}
      </div>
    );
  }

  if (!integrationStatus.operational) {
    return (
      <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
        {t('integrations.unhealthyHint', { name: 'Wise' })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {status?.sandbox && (
          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600">
            <AlertCircle className="h-3 w-3 mr-1" />
            Sandbox
          </Badge>
        )}
        {status?.circuitBreaker && (
          <Badge variant="outline" className={`text-xs ${
            status.circuitBreaker.state === 'closed' 
              ? 'bg-green-500/10 text-green-600' 
              : 'bg-amber-500/10 text-amber-600'
          }`}>
            <Shield className="h-3 w-3 mr-1" />
            CB: {status.circuitBreaker.state}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(balances?.balances || []).slice(0, 4).map((balance) => (
            <div key={balance.id} className="p-2 bg-muted/50 rounded text-xs">
              <div className="text-muted-foreground">{balance.currency}</div>
              <div className="font-medium">
                {formatCurrency(balance.amount.value, balance.currency, locale)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Integrations() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState<string | null>(null);

  const { data: integrationMetrics, isLoading } = useQuery<IntegrationMetricsResponse>({
    queryKey: ['/api/observability/metrics/integrations'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const testErpnext = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/erpnext/test', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(t('integrations.errors.testFailed'));
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: t('integrations.success.connected', { name: 'ERPNext' }),
        description: `Versão: ${data.version || 'N/A'}`,
      });
    },
    onError: () => {
      toast({ 
        title: t('integrations.errors.connectionFailed', { name: 'ERPNext' }), 
        variant: 'destructive',
      });
    },
    onSettled: () => setTestingIntegration(null),
  });

  const integrationIds = ['stripe', 'wise', 'erpnext', 'twilio', 'email', 'trading', 'openai_vision'] as const;
  const integrationStatusMap = (integrationMetrics?.integrations ?? []).reduce<Record<string, IntegrationMetric>>((acc, integration) => {
    acc[integration.name] = integration;
    return acc;
  }, {});

  const getIntegrationStatus = (name: string) => {
    const status = integrationStatusMap[name];
    return status ? { configured: status.configured, operational: status.operational } : { configured: false, operational: false };
  };

  const services = {
    stripe: getIntegrationStatus('stripe'),
    wise: getIntegrationStatus('wise'),
    erpnext: getIntegrationStatus('erpnext'),
    twilio: getIntegrationStatus('twilio'),
    email: getIntegrationStatus('email'),
    trading: getIntegrationStatus('trading'),
    openaiVision: getIntegrationStatus('openai_vision'),
  };

  const activeCount = integrationIds.filter((name) => getIntegrationStatus(name).operational).length;
  const totalCount = integrationIds.length;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 border-b bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-integrations-title">
              {t('integrations.title')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('integrations.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">
              <Link className="h-3 w-3 mr-1" />
              {t('integrations.activeCount', { count: activeCount, total: totalCount })}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('integrations.stats.active')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-active">{activeCount}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('integrations.stats.payments')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-payments">
                    {services.stripe.operational ? 'EUR' : '-'}
                  </p>
                </div>
                <CreditCard className="h-8 w-8 text-purple-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('integrations.stats.currencies')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-transfers">
                    {services.wise.operational ? '50+' : '-'}
                  </p>
                </div>
                <Globe className="h-8 w-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('integrations.stats.communication')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-comms">
                    {(services.twilio.operational || services.email.operational) ? 'OK' : '-'}
                  </p>
                </div>
                <MessageSquare className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <ScrollArea className="flex-1 p-4">
        <Tabs defaultValue="payments" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="payments" data-testid="tab-payments">
              <CreditCard className="h-4 w-4 mr-2" />
              {t('integrations.tabs.payments')}
            </TabsTrigger>
            <TabsTrigger value="trading" data-testid="tab-trading">
              <LineChart className="h-4 w-4 mr-2" />
              {t('integrations.tabs.trading')}
            </TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai">
              <Eye className="h-4 w-4 mr-2" />
              {t('integrations.tabs.ai')}
            </TabsTrigger>
            <TabsTrigger value="erp" data-testid="tab-erp">
              <Building2 className="h-4 w-4 mr-2" />
              {t('integrations.tabs.erp')}
            </TabsTrigger>
            <TabsTrigger value="communication" data-testid="tab-communication">
              <MessageSquare className="h-4 w-4 mr-2" />
              {t('integrations.tabs.communication')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              <IntegrationCard
                name={t('integrations.stripe.title')}
                description={t('integrations.stripe.description')}
                icon={CreditCard}
                status={services.stripe}
                onConfigure={() => setShowConfigDialog('stripe')}
                t={t}
              >
                <StripeSection status={services.stripe} t={t} locale={locale} />
              </IntegrationCard>

              <IntegrationCard
                name={t('integrations.wise.title')}
                description={t('integrations.wise.description')}
                icon={Send}
                status={services.wise}
                onConfigure={() => setShowConfigDialog('wise')}
                t={t}
              >
                <WiseSection status={services.wise} t={t} locale={locale} />
              </IntegrationCard>
            </motion.div>
          </TabsContent>

          <TabsContent value="trading">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              <IntegrationCard
                name={t('integrations.trading.title')}
                description={t('integrations.trading.description')}
                icon={LineChart}
                status={services.trading}
                onConfigure={() => setShowConfigDialog('trading')}
                t={t}
              >
                {services.trading.configured && services.trading.operational ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <a 
                        href="/trading"
                        className="hover:underline"
                      >
                        {t('integrations.trading.activeHint')}
                      </a>
                    </div>
                  </div>
                ) : services.trading.configured ? (
                  <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
                    {t('integrations.unhealthyHint', { name: 'KuCoin Futures' })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    {t('integrations.trading.configureHint')}
                  </div>
                )}
              </IntegrationCard>
            </motion.div>
          </TabsContent>

          <TabsContent value="ai">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              <IntegrationCard
                name={t('integrations.openaiVision.title')}
                description={t('integrations.openaiVision.description')}
                icon={Eye}
                status={services.openaiVision}
                onConfigure={() => setShowConfigDialog('openai')}
                t={t}
              >
                {services.openaiVision.configured && services.openaiVision.operational ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span>{t('integrations.openaiVision.activeHint')}</span>
                    </div>
                  </div>
                ) : services.openaiVision.configured ? (
                  <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
                    {t('integrations.unhealthyHint', { name: 'OpenAI Vision' })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    {t('integrations.openaiVision.configureHint')}
                  </div>
                )}
              </IntegrationCard>
            </motion.div>
          </TabsContent>

          <TabsContent value="erp">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              <IntegrationCard
                name={t('integrations.erpnext.title')}
                description={t('integrations.erpnext.description')}
                icon={Building2}
                status={services.erpnext}
                onConfigure={() => setShowConfigDialog('erpnext')}
                onTest={() => {
                  setTestingIntegration('erpnext');
                  testErpnext.mutate();
                }}
                testLoading={testingIntegration === 'erpnext'}
                t={t}
              >
                {services.erpnext.configured && services.erpnext.operational ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <a 
                        href="https://erp.yesyoudeserve.duckdns.org" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {t('integrations.erpnext.access')}
                      </a>
                    </div>
                    <div className="p-2 bg-muted/50 rounded text-xs">
                      <div className="text-muted-foreground">{t('integrations.erpnext.sync')}</div>
                      <div className="font-medium">{t('integrations.erpnext.syncItems')}</div>
                    </div>
                  </div>
                ) : services.erpnext.configured ? (
                  <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
                    {t('integrations.unhealthyHint', { name: 'ERPNext' })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    {t('integrations.erpnext.configureHint')}
                  </div>
                )}
              </IntegrationCard>
            </motion.div>
          </TabsContent>

          <TabsContent value="communication">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              <IntegrationCard
                name={t('integrations.twilio.title')}
                description={t('integrations.twilio.description')}
                icon={MessageSquare}
                status={services.twilio}
                onConfigure={() => setShowConfigDialog('twilio')}
                t={t}
              >
                {services.twilio.configured && services.twilio.operational ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">WhatsApp</Badge>
                      <Badge variant="outline" className="text-xs">SMS</Badge>
                    </div>
                  </div>
                ) : services.twilio.configured ? (
                  <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
                    {t('integrations.unhealthyHint', { name: 'Twilio' })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    {t('integrations.twilio.configureHint')}
                  </div>
                )}
              </IntegrationCard>

              <IntegrationCard
                name={t('integrations.email.title')}
                description={t('integrations.email.description')}
                icon={Mail}
                status={services.email}
                onConfigure={() => setShowConfigDialog('email')}
                t={t}
              >
                {services.email.configured && services.email.operational ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <span>{t('integrations.email.smtpConfigured')}</span>
                    </div>
                  </div>
                ) : services.email.configured ? (
                  <div className="text-xs text-muted-foreground p-2 bg-amber-500/10 rounded">
                    {t('integrations.unhealthyHint', { name: 'Gmail SMTP' })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    {t('integrations.email.configureHint')}
                  </div>
                )}
              </IntegrationCard>
            </motion.div>
          </TabsContent>
        </Tabs>
      </ScrollArea>

      <Dialog open={!!showConfigDialog} onOpenChange={() => setShowConfigDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Configurar {showConfigDialog?.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              As credenciais são gerenciadas via variáveis de ambiente no servidor.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Variáveis Necessárias:</h4>
              <div className="space-y-1 text-xs font-mono text-muted-foreground">
                {showConfigDialog === 'stripe' && (
                  <>
                    <p>STRIPE_SECRET_KEY</p>
                    <p>STRIPE_WEBHOOK_SECRET</p>
                    <p>STRIPE_SUCCESS_URL</p>
                    <p>STRIPE_CANCEL_URL</p>
                  </>
                )}
                {showConfigDialog === 'wise' && (
                  <>
                    <p>WISE_API_KEY</p>
                    <p>WISE_PROFILE_ID</p>
                    <p>WISE_SANDBOX</p>
                    <p>WISE_WEBHOOK_PUBLIC_KEY (opcional)</p>
                  </>
                )}
                {showConfigDialog === 'erpnext' && (
                  <>
                    <p>ERPNEXT_URL</p>
                    <p>ERPNEXT_API_KEY</p>
                    <p>ERPNEXT_API_SECRET</p>
                  </>
                )}
                {showConfigDialog === 'twilio' && (
                  <>
                    <p>TWILIO_ACCOUNT_SID</p>
                    <p>TWILIO_AUTH_TOKEN</p>
                    <p>TWILIO_PHONE_NUMBER</p>
                    <p>TWILIO_WHATSAPP_NUMBER</p>
                  </>
                )}
                {showConfigDialog === 'email' && (
                  <>
                    <p>GMAIL_USER</p>
                    <p>GMAIL_APP_PASSWORD</p>
                  </>
                )}
                {showConfigDialog === 'openai' && (
                  <>
                    <p>OPENAI_API_KEY</p>
                  </>
                )}
                {showConfigDialog === 'trading' && (
                  <>
                    <p>KUCOIN_PRO_API_KEY</p>
                    <p>KUCOIN_PRO_API_SECRET</p>
                    <p>KUCOIN_PRO_API_PASSPHRASE</p>
                  </>
                )}
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 rounded-lg">
              <div className="flex gap-2 items-start">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  Configure estas variáveis no arquivo `.env` local ou nos GitHub Secrets para produção.
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfigDialog(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

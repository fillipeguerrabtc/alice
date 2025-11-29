/**
 * Portal de Observabilidade - Alice Enterprise Platform
 * 
 * Painel unificado de monitoramento com status de todos os serviços
 * de observabilidade: Prometheus, Grafana, Jaeger, Langfuse.
 * 
 * AMBIENTES:
 * - Desenvolvimento (Replit): Dados de preview via server/index-dev.ts
 * - Produção (Hetzner): API real via observability-service (porta 3007)
 * 
 * O frontend foi projetado para funcionar em ambos ambientes:
 * - Mostra estados de carregamento e erro apropriados
 * - Links externos funcionam independente da API
 * 
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Activity, 
  BarChart3, 
  Gauge, 
  Network,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Zap,
  Server,
  Database,
  RefreshCw,
  Brain,
  LineChart,
  Shield,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { queryClient } from '@/lib/queryClient';

interface ServiceStatus {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  lastCheck: string;
  error?: string;
}

interface StackHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
  uptimeSeconds: number;
}

interface ObservabilityUrls {
  prometheus: {
    internal: string;
    external: string;
    description: string;
  };
  grafana: {
    internal: string;
    external: string;
    description: string;
  };
  jaeger: {
    internal: string;
    external: string;
    description: string;
  };
  langfuse: {
    internal: string;
    external: string;
    description: string;
  };
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function StatusIcon({ status }: { status: 'healthy' | 'unhealthy' | 'unknown' | 'degraded' }) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'degraded':
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    case 'unhealthy':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

function ServiceIcon({ name }: { name: string }) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('prometheus')) {
    return <Gauge className="h-5 w-5" />;
  } else if (lowerName.includes('grafana')) {
    return <BarChart3 className="h-5 w-5" />;
  } else if (lowerName.includes('jaeger')) {
    return <Network className="h-5 w-5" />;
  } else if (lowerName.includes('langfuse')) {
    return <Brain className="h-5 w-5" />;
  }
  return <Server className="h-5 w-5" />;
}

function StackStatusCard({ health, isLoading, isError }: { health?: StackHealth; isLoading: boolean; isError?: boolean }) {
  const { t } = useTranslation();
  
  if (isLoading) {
    return (
      <Card data-testid="card-stack-status-loading">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-20" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError && !health) {
    return (
      <motion.div variants={item}>
        <Card data-testid="card-stack-status-error">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t('observability.stackStatus')}
            </CardTitle>
            <Badge variant="secondary" data-testid="badge-status-unknown">
              {t('observability.unknown')}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-3 w-3 rounded-full bg-muted-foreground/50" />
              <span className="text-sm text-muted-foreground" data-testid="text-status-unavailable">
                {t('observability.statusUnavailable')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('observability.useExternalLinks')}
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const statusColor = health?.status === 'healthy' ? 'bg-green-500' :
                      health?.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500';
  
  const healthyCount = health?.services?.filter(s => s.status === 'healthy').length || 0;
  const totalCount = health?.services?.length || 0;
  const healthPercentage = totalCount > 0 ? (healthyCount / totalCount) * 100 : 0;

  return (
    <motion.div variants={item}>
      <Card data-testid="card-stack-status">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {t('observability.stackStatus')}
          </CardTitle>
          <Badge 
            variant={health?.status === 'healthy' ? 'default' : 'destructive'}
            className={health?.status === 'healthy' ? 'bg-green-500' : undefined}
            data-testid={`badge-status-${health?.status || 'unknown'}`}
          >
            {health?.status === 'healthy' ? t('observability.healthy') :
             health?.status === 'degraded' ? t('observability.degraded') :
             t('observability.unhealthy')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className={`h-3 w-3 rounded-full ${statusColor} animate-pulse`} />
            <span className="text-sm text-muted-foreground" data-testid="text-services-count">
              {healthyCount}/{totalCount} {t('observability.servicesHealthy')}
            </span>
          </div>
          <Progress value={healthPercentage} className="h-2" data-testid="progress-health" />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-1" data-testid="text-uptime">
              <Clock className="h-4 w-4" />
              {t('observability.uptime')}: {formatUptime(health?.uptimeSeconds || 0)}
            </span>
            <span data-testid="text-last-check">
              {t('observability.lastCheck')}: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '-'}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ServiceCard({ 
  service, 
  externalUrl,
  description,
}: { 
  service: ServiceStatus; 
  externalUrl?: string;
  description?: string;
}) {
  const { t } = useTranslation();
  const serviceId = service.name.toLowerCase().replace(/\s+/g, '-');

  return (
    <motion.div variants={item}>
      <Card className="h-full" data-testid={`card-service-${serviceId}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <ServiceIcon name={service.name} />
            <div>
              <CardTitle className="text-base" data-testid={`text-service-name-${serviceId}`}>
                {service.name}
              </CardTitle>
              {description && (
                <CardDescription className="text-xs mt-1">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          <StatusIcon status={service.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('observability.latency')}</span>
            <span className="flex items-center gap-1 font-mono" data-testid={`text-latency-${serviceId}`}>
              <Zap className="h-3 w-3" />
              {service.latencyMs}ms
            </span>
          </div>
          
          {service.error && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 p-2 rounded" data-testid={`text-error-${serviceId}`}>
              {service.error}
            </div>
          )}
          
          {externalUrl && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              asChild
              data-testid={`button-open-${serviceId}`}
            >
              <a 
                href={externalUrl} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                {t('observability.openDashboard')}
                <ExternalLink className="h-3 w-3 ml-2" />
              </a>
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function QuickLinks({ urls }: { urls?: ObservabilityUrls }) {
  const { t } = useTranslation();
  
  const links = [
    {
      name: 'Grafana',
      url: urls?.grafana?.external || 'https://observabilidade.yesyoudeserve.duckdns.org',
      icon: BarChart3,
      description: t('observability.grafanaDesc'),
      color: 'text-orange-500',
    },
    {
      name: 'Prometheus',
      url: urls?.prometheus?.external || 'https://prometheus.yesyoudeserve.duckdns.org',
      icon: Gauge,
      description: t('observability.prometheusDesc'),
      color: 'text-red-500',
    },
    {
      name: 'Jaeger',
      url: urls?.jaeger?.external || 'https://tracing.yesyoudeserve.duckdns.org',
      icon: Network,
      description: t('observability.jaegerDesc'),
      color: 'text-blue-500',
    },
    {
      name: 'Langfuse',
      url: urls?.langfuse?.external || 'https://llm-metrics.yesyoudeserve.duckdns.org',
      icon: Brain,
      description: t('observability.langfuseDesc'),
      color: 'text-purple-500',
    },
  ];

  return (
    <motion.div variants={item}>
      <Card data-testid="card-quick-links">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            {t('observability.quickLinks')}
          </CardTitle>
          <CardDescription>
            {t('observability.quickLinksDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {links.map((link) => (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-md border hover-elevate active-elevate-2 transition-colors"
                data-testid={`link-quick-${link.name.toLowerCase()}`}
              >
                <link.icon className={`h-5 w-5 ${link.color}`} />
                <div className="flex-1">
                  <p className="font-medium text-sm" data-testid={`text-quick-name-${link.name.toLowerCase()}`}>{link.name}</p>
                  <p className="text-xs text-muted-foreground">{link.description}</p>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function MetricsOverview() {
  const { t } = useTranslation();
  
  const metrics = [
    {
      label: t('observability.metricsCollected'),
      value: '-',
      icon: LineChart,
      trend: '+12%',
      positive: true,
    },
    {
      label: t('observability.activeAlerts'),
      value: '-',
      icon: AlertCircle,
      trend: '0',
      positive: true,
    },
    {
      label: t('observability.tracesProcessed'),
      value: '-',
      icon: Network,
      trend: '+5%',
      positive: true,
    },
    {
      label: t('observability.llmRequests'),
      value: '-',
      icon: Brain,
      trend: '+8%',
      positive: true,
    },
  ];

  return (
    <motion.div variants={item}>
      <Card data-testid="card-metrics-overview">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            {t('observability.metricsOverview')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {metrics.map((metric, index) => (
              <div 
                key={metric.label}
                className="flex items-center gap-3 p-3 rounded-md bg-muted/50"
                data-testid={`card-metric-${index}`}
              >
                <metric.icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">{metric.label}</p>
                  <p className="text-lg font-semibold" data-testid={`text-metric-value-${index}`}>{metric.value}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            {t('observability.connectToGrafana')}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Observability() {
  const { t } = useTranslation();

  const { data: healthData, isLoading: healthLoading, isError: healthError, refetch } = useQuery<StackHealth>({
    queryKey: ['/api/observability/health'],
    refetchInterval: 30000,
    retry: 2,
  });

  const { data: urlsData, isError: urlsError } = useQuery<ObservabilityUrls>({
    queryKey: ['/api/observability/urls'],
    retry: 2,
  });

  const apiUnavailable = healthError && urlsError;

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['/api/observability'] });
  };

  const getExternalUrl = (serviceName: string): string | undefined => {
    const lowerName = serviceName.toLowerCase();
    if (lowerName.includes('prometheus')) return urlsData?.prometheus?.external;
    if (lowerName.includes('grafana')) return urlsData?.grafana?.external;
    if (lowerName.includes('jaeger')) return urlsData?.jaeger?.external;
    if (lowerName.includes('langfuse')) return urlsData?.langfuse?.external;
    return undefined;
  };

  const getServiceDescription = (serviceName: string): string | undefined => {
    const lowerName = serviceName.toLowerCase();
    if (lowerName.includes('prometheus')) return urlsData?.prometheus?.description;
    if (lowerName.includes('grafana')) return urlsData?.grafana?.description;
    if (lowerName.includes('jaeger')) return urlsData?.jaeger?.description;
    if (lowerName.includes('langfuse')) return urlsData?.langfuse?.description;
    return undefined;
  };

  return (
    <ScrollArea className="h-full">
      <motion.div 
        className="p-6 space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={item} className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              {t('observability.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('observability.description')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh') || 'Atualizar'}
          </Button>
        </motion.div>

        {apiUnavailable && (
          <motion.div variants={item}>
            <Card className="border-yellow-500/50 bg-yellow-500/5" data-testid="card-api-unavailable">
              <CardContent className="flex items-center gap-3 p-4">
                <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                <div>
                  <p className="font-medium" data-testid="text-api-unavailable">{t('observability.apiUnavailable')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('observability.apiUnavailableDesc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <StackStatusCard health={healthData} isLoading={healthLoading} isError={healthError} />
          <QuickLinks urls={urlsData} />
          <MetricsOverview />
        </div>

        <motion.div variants={item}>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2" data-testid="text-services-title">
            <Server className="h-5 w-5" />
            {t('observability.services')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="grid-services">
            {healthLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} data-testid={`card-service-loading-${i}`}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-8 w-full" />
                  </CardContent>
                </Card>
              ))
            ) : (
              healthData?.services?.map((service) => (
                <ServiceCard
                  key={service.name}
                  service={service}
                  externalUrl={getExternalUrl(service.name)}
                  description={getServiceDescription(service.name)}
                />
              ))
            )}
          </div>
        </motion.div>

        <motion.div variants={item}>
          <Card data-testid="card-security-info">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t('observability.securityInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2" data-testid="text-sso-status">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {t('observability.ssoEnabled')}
              </p>
              <p className="flex items-center gap-2" data-testid="text-tls-status">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {t('observability.tlsEnabled')}
              </p>
              <p className="flex items-center gap-2" data-testid="text-data-retention">
                <Database className="h-4 w-4" />
                {t('observability.dataRetention')}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </ScrollArea>
  );
}

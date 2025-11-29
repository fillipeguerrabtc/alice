/**
 * ServiceHealthCard - Card de status de saúde dos serviços
 * 
 * @module Dashboard/components/ServiceHealthCard
 */

import { motion } from 'framer-motion';
import { Server, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ServiceHealth, itemVariants } from './types';

interface ServiceHealthCardProps {
  services: ServiceHealth[];
  isLoading: boolean;
}

export function ServiceHealthCard({ services, isLoading }: ServiceHealthCardProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      ok: 'default',
      degraded: 'secondary',
      down: 'destructive',
    };
    const labels: Record<string, string> = {
      ok: 'Online',
      degraded: 'Degradado',
      down: 'Offline',
    };
    return (
      <Badge variant={variants[status] || 'outline'} className="text-xs">
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            {t('dashboard.serviceHealth') || 'Status dos Serviços'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {services.map((service) => (
              <div 
                key={service.service}
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  {statusIcon(service.status)}
                  <span className="text-sm font-medium">{service.service}</span>
                </div>
                <div className="flex items-center gap-2">
                  {service.latency && (
                    <span className="text-xs text-muted-foreground">
                      {service.latency}ms
                    </span>
                  )}
                  {statusBadge(service.status)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

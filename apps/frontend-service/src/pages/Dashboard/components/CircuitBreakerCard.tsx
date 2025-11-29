/**
 * CircuitBreakerCard - Card de status dos circuit breakers
 * 
 * @module Dashboard/components/CircuitBreakerCard
 */

import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CircuitBreakerStatus, itemVariants } from './types';

interface CircuitBreakerCardProps {
  breakers: CircuitBreakerStatus[];
  isLoading: boolean;
}

export function CircuitBreakerCard({ breakers, isLoading }: CircuitBreakerCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const statusColors: Record<string, string> = {
    closed: 'text-green-500',
    open: 'text-red-500',
    'half-open': 'text-yellow-500',
  };

  const statusLabels: Record<string, string> = {
    closed: 'Fechado',
    open: 'Aberto',
    'half-open': 'Semi-Aberto',
  };

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-orange-500/10">
            <Shield className="h-4 w-4 text-orange-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">Circuit Breakers</CardTitle>
            <CardDescription className="text-xs">Proteção contra falhas em cascata</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {breakers.map((breaker) => (
            <div 
              key={breaker.name}
              className="flex items-center justify-between p-2 rounded-md bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${breaker.status === 'closed' ? 'bg-green-500' : breaker.status === 'open' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                <span className="text-sm font-medium">{breaker.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {breaker.successRate}%
                </span>
                <Badge variant="outline" className={`text-xs ${statusColors[breaker.status]}`}>
                  {statusLabels[breaker.status]}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

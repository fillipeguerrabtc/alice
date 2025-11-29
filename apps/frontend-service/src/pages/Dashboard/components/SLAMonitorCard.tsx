/**
 * SLAMonitorCard - Card de monitoramento de SLA
 * 
 * @module Dashboard/components/SLAMonitorCard
 */

import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { SLAMetrics, ConversationBreakdown, itemVariants } from './types';

interface SLAMonitorCardProps {
  metrics: SLAMetrics;
  isLoading: boolean;
}

export function SLAMonitorCard({ metrics, isLoading }: SLAMonitorCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const total = metrics.breachedCount + metrics.atRiskCount + metrics.onTrackCount;
  const slaData: ConversationBreakdown[] = [
    { name: 'On Track', value: metrics.onTrackCount, color: '#10b981' },
    { name: 'At Risk', value: metrics.atRiskCount, color: '#f59e0b' },
    { name: 'Breached', value: metrics.breachedCount, color: '#ef4444' },
  ].filter(d => d.value > 0);

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-blue-500/10">
            <Clock className="h-4 w-4 text-blue-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">SLA Monitoring</CardTitle>
            <CardDescription className="text-xs">Acordos de nível de serviço</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {total > 0 ? (
            <>
              <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slaData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {slaData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend 
                      verticalAlign="bottom" 
                      height={24}
                      formatter={(value: string) => <span className="text-xs">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">1ª Resposta</span>
                  <span className="font-medium">{Math.round(metrics.avgFirstResponseTime / 60)}min</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Resolução</span>
                  <span className="font-medium">{Math.round(metrics.avgResolutionTime / 60)}min</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[150px] text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Sem dados de SLA</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

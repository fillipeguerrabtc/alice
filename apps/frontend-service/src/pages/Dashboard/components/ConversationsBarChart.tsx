/**
 * ConversationsBarChart - Gráfico de barras de conversas
 * 
 * @module Dashboard/components/ConversationsBarChart
 */

import { motion } from 'framer-motion';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { itemVariants } from './types';

interface ConversationsBarChartProps {
  data: { name: string; ai: number; human: number }[];
  isLoading: boolean;
}

export function ConversationsBarChart({ data, isLoading }: ConversationsBarChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Conversas por Período
          </CardTitle>
          <CardDescription>Resoluções IA vs Humano nos últimos 7 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                    }}
                  />
                  <Legend 
                    formatter={(value: string) => <span className="text-xs">{value}</span>}
                  />
                  <Bar dataKey="ai" name="IA" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="human" name="Humano" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Sem dados de conversas</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

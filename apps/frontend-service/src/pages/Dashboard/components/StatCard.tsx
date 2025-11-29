/**
 * StatCard - Card de estatística com ícone e trend
 * 
 * @module Dashboard/components/StatCard
 */

import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { itemVariants } from './types';

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  trend?: number;
  isLoading?: boolean;
  accent?: 'default' | 'success' | 'warning' | 'danger';
}

export function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend, 
  isLoading,
  accent = 'default',
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  const accentColors = {
    default: 'text-muted-foreground',
    success: 'text-green-500 dark:text-green-400',
    warning: 'text-yellow-500 dark:text-yellow-400',
    danger: 'text-red-500 dark:text-red-400',
  };

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className={`p-2 rounded-md bg-muted ${accentColors[accent]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid={`stat-value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {trend !== undefined && trend !== 0 && (
              <span className={trend > 0 ? 'text-green-500 flex items-center' : 'text-red-500 flex items-center'}>
                {trend > 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {Math.abs(trend)}%
              </span>
            )}
            <span>{description}</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

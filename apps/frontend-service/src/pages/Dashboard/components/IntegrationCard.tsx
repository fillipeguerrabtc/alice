/**
 * IntegrationCard - Card de integração (Stripe, Wise)
 * 
 * @module Dashboard/components/IntegrationCard
 */

import type { KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { itemVariants } from './types';

interface IntegrationCardProps {
  title: string;
  icon: LucideIcon;
  stats: React.ReactNode;
  isLoading: boolean;
  onClick?: () => void;
}

export function IntegrationCard({ 
  title, 
  icon: Icon, 
  stats, 
  isLoading,
  onClick,
}: IntegrationCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <motion.div variants={itemVariants}>
      <Card
        className={`hover-elevate ${onClick ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60' : ''}`}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>{stats}</CardContent>
      </Card>
    </motion.div>
  );
}


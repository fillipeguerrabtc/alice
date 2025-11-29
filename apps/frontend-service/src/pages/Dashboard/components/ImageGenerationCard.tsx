/**
 * ImageGenerationCard - Card de estatísticas de geração de imagens
 * 
 * @module Dashboard/components/ImageGenerationCard
 */

import { motion } from 'framer-motion';
import { Image, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageGenerationStats, itemVariants } from './types';

interface ImageGenerationCardProps {
  stats: ImageGenerationStats;
  isLoading: boolean;
}

export function ImageGenerationCard({ stats, isLoading }: ImageGenerationCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const approvalRate = stats.totalGenerated > 0 
    ? Math.round((stats.approved / stats.totalGenerated) * 100) 
    : 0;

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-purple-500/10">
            <Image className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">Geração de Imagens</CardTitle>
            <CardDescription className="text-xs">FLUX.1 + Training RLHF</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Geradas</span>
            <span className="font-semibold" data-testid="stat-total-images">
              {stats.totalGenerated}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Taxa Aprovação</span>
              <span className="font-medium">{approvalRate}%</span>
            </div>
            <Progress value={approvalRate} className="h-1.5" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Rating Médio</span>
            </div>
            <span className="font-semibold">{stats.avgRating.toFixed(1)}/5</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Em Training</span>
            <Badge variant="secondary">{stats.inTraining}</Badge>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

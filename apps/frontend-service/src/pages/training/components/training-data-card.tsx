import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Folder,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, formatDateTime } from '@/lib/utils';

type TrainingDataCardEntry = {
  id: string;
  source: string;
  sourceType?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  messages: Array<{ role: string; content: string }>;
  qualityScore?: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'reserved' | 'used';
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  similarityScore: number | null;
  profileVersion?: number | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  criadoEm: string;
  namespaceId?: string | null;
  inferredDomain?: string | null;
  inferenceConfidence?: number | null;
  needsHumanReview?: boolean | null;
  quarantineReason?: string | null;
};

type TrainingDataCardProps = {
  data: TrainingDataCardEntry;
  isPending: boolean;
  isSelected?: boolean;
  locale: string;
  namespaceName?: string | null;
  onApprove: () => void;
  onReject: () => void;
  onResolveScope: () => void;
  onSelectionChange?: (checked: boolean) => void;
  selectionDisabled?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
  variants: {
    hidden: { opacity: number; y: number };
    visible: {
      opacity: number;
      y: number;
      transition: { type: 'spring'; stiffness: number; damping: number };
    };
  };
};

function getStatusBadge(
  status: TrainingDataCardEntry['status'],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.pending')}</Badge>;
    case 'approved':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.approved')}</Badge>;
    case 'rejected':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-red-500/10 text-red-600"><XCircle className="h-3 w-3 mr-1" />{t('training.status.rejected')}</Badge>;
    case 'used':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-blue-500/10 text-blue-600"><Zap className="h-3 w-3 mr-1" />{t('training.status.used')}</Badge>;
    default:
      return null;
  }
}

export function TrainingDataCard({
  data,
  isPending,
  isSelected,
  locale,
  namespaceName,
  onApprove,
  onReject,
  onResolveScope,
  onSelectionChange,
  selectionDisabled,
  t,
  timeZone,
  variants,
}: TrainingDataCardProps) {
  const [expanded, setExpanded] = useState(false);
  const privacySummary = data.sourceMetadata?.['privacySummary'];
  const canRelinkScope = data.status === 'pending' || data.status === 'approved';

  return (
    <motion.div variants={variants}>
      <Card className="h-full hover-elevate">
        <CardHeader className="pb-2">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {data.status === 'pending' && onSelectionChange && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelectionChange(Boolean(checked))}
                  disabled={selectionDisabled || isPending}
                  aria-label={`Selecionar dataset ${data.id}`}
                />
              )}
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="max-w-full truncate text-sm font-medium">{data.source}</span>
              {data.sourceType && (
                <Badge variant="outline" className="max-w-full text-xs">
                  {data.sourceType}
                </Badge>
              )}
              {namespaceName && (
                <Badge variant="secondary" className="max-w-full text-xs">
                  {namespaceName}
                </Badge>
              )}
              {data.needsHumanReview && (
                <Badge variant="destructive" className="max-w-full text-xs">
                  Quarentena de escopo
                </Badge>
              )}
            </div>
            <div className="w-full sm:w-auto">
              {getStatusBadge(data.status, t)}
            </div>
          </div>
          <CardDescription className="text-xs">
            {formatDateTime(data.criadoEm, { locale, timeZone })}
            {data.qualityScore !== null && data.qualityScore !== undefined && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {t('training.data.quality', { percent: Math.round(data.qualityScore * 100) })}
              </Badge>
            )}
            {data.isDuplicate && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {t('training.data.duplicate', { percent: Math.round((data.similarityScore || 0) * 100) })}
              </Badge>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-2">
          <div className="space-y-2">
            {data.messages.slice(0, expanded ? undefined : 2).map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  'text-xs p-2 rounded',
                  msg.role === 'user' ? 'bg-muted' : 'bg-primary/5',
                )}
              >
                <span className="font-medium capitalize">{msg.role}:</span>{' '}
                <span className="text-muted-foreground">{msg.content.slice(0, 100)}{msg.content.length > 100 ? '...' : ''}</span>
              </div>
            ))}
            {data.messages.length > 2 && !expanded && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => setExpanded(true)}
              >
                {t('training.data.viewMore', { count: data.messages.length - 2 })}
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
            {(data.inferredDomain || data.inferenceConfidence !== null && data.inferenceConfidence !== undefined) && (
              <div className="text-xs text-muted-foreground">
                {data.inferredDomain && (
                  <span>Domínio inferido: {data.inferredDomain}</span>
                )}
                {data.inferenceConfidence !== null && data.inferenceConfidence !== undefined && (
                  <span className="ml-2">Confiança: {Math.round(data.inferenceConfidence * 100)}%</span>
                )}
              </div>
            )}
            {data.quarantineReason && (
              <div className="text-xs text-red-600">
                {data.quarantineReason}
              </div>
            )}
            {typeof data.profileVersion === 'number' && (
              <div className="text-xs text-muted-foreground">
                Profile version: {data.profileVersion}
              </div>
            )}
            {privacySummary !== undefined && (
              <div className="text-xs text-muted-foreground">
                Privacy summary: {JSON.stringify(privacySummary)}
              </div>
            )}
            {data.isDuplicate && data.duplicateOfId ? (
              <div className="text-xs text-muted-foreground">
                Duplicate of: {data.duplicateOfId}
              </div>
            ) : null}
            {data.reviewedAt && (
              <div className="text-xs text-muted-foreground">
                {t('training.data.reviewedAt', { date: formatDateTime(data.reviewedAt, { locale, timeZone }) })}
                {data.reviewedBy && (
                  <span className="ml-2">{t('training.data.reviewedBy', { userId: data.reviewedBy })}</span>
                )}
                {data.reviewNotes && (
                  <span className="ml-2">{t('training.data.reviewNotes', { notes: data.reviewNotes })}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>

        {canRelinkScope && (
          <CardFooter className="pt-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className={data.status === 'approved' ? 'w-full' : 'flex-1'}
              onClick={onResolveScope}
              disabled={isPending}
            >
              <Folder className="h-3 w-3 mr-1" />
              {data.needsHumanReview
                ? t('training.resolveScope.resolveAction')
                : t('training.resolveScope.changeNamespaceAction')}
            </Button>
            {data.status === 'pending' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-green-600"
                  onClick={onApprove}
                  disabled={isPending || !!data.needsHumanReview}
                  data-testid={`button-approve-${data.id}`}
                >
                  <ThumbsUp className="h-3 w-3 mr-1" />
                  {t('training.data.approve')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-red-600"
                  onClick={onReject}
                  disabled={isPending}
                  data-testid={`button-reject-${data.id}`}
                >
                  <ThumbsDown className="h-3 w-3 mr-1" />
                  {t('training.data.reject')}
                </Button>
              </>
            )}
          </CardFooter>
        )}
      </Card>
    </motion.div>
  );
}

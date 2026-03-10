import { motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  FileType,
  GraduationCap,
  Layers,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatDate } from '@/lib/utils';

type DocumentProcessingStatus = 'pending' | 'processing' | 'failed' | 'completed';

type DocumentCardDocument = {
  conteudo: string;
  criadoEm: string;
  id: string;
  metadata?: {
    processingError?: string | null;
    processingStatus?: 'pending' | 'processing' | 'failed' | 'completed';
  } | null;
  namespaceId: string | null;
  processado: boolean;
  sentToTrainingAt?: string | null;
  tipo: string | null;
  titulo: string;
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10 },
} as const;

function getDocumentProcessingStatus(document: DocumentCardDocument): DocumentProcessingStatus {
  const metadataStatus = document.metadata?.processingStatus;
  if (document.processado) {
    return 'completed';
  }
  if (
    metadataStatus === 'pending' ||
    metadataStatus === 'processing' ||
    metadataStatus === 'failed' ||
    metadataStatus === 'completed'
  ) {
    return metadataStatus;
  }
  return 'pending';
}

function getDocumentProcessingError(document: DocumentCardDocument): string | null {
  const error = document.metadata?.processingError;
  return typeof error === 'string' && error.trim().length > 0 ? error : null;
}

export function DocumentCard({
  document,
  isReprocessing,
  isSendingToTraining,
  locale,
  namespaceName,
  onDelete,
  onReprocess,
  onSendToTraining,
  onView,
  t,
  timeZone,
  viewMode,
}: {
  document: DocumentCardDocument;
  isReprocessing: boolean;
  isSendingToTraining: boolean;
  locale: string;
  namespaceName?: string;
  onDelete: () => void;
  onReprocess?: () => void;
  onSendToTraining?: () => void;
  onView: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
  viewMode: 'grid' | 'list';
}) {
  const getFileIcon = (tipo: string | null) => {
    if (!tipo) return FileText;
    if (tipo.includes('pdf')) return FileType;
    return FileText;
  };

  const FileIcon = getFileIcon(document.tipo);
  const truncatedContent = document.conteudo?.slice(0, 150) + (document.conteudo?.length > 150 ? '...' : '') || '';
  const processingStatus = getDocumentProcessingStatus(document);
  const processingError = getDocumentProcessingError(document);
  const canProcess = Boolean(onReprocess) && (processingStatus === 'pending' || processingStatus === 'failed');
  const processActionLabel = processingStatus === 'pending'
    ? t('documents.actions.processNow')
    : t('documents.actions.reprocess');
  const canSendToTraining = document.processado && !document.sentToTrainingAt && Boolean(onSendToTraining);
  const statusConfig = (() => {
    if (processingStatus === 'processing') {
      return {
        icon: Loader2,
        label: t('documents.status.processing'),
        className: 'bg-blue-500/10 text-blue-600',
      };
    }
    if (processingStatus === 'failed') {
      return {
        icon: AlertCircle,
        label: t('documents.status.failed'),
        className: 'bg-red-500/10 text-red-600',
      };
    }
    if (processingStatus === 'completed') {
      return {
        icon: CheckCircle2,
        label: t('documents.status.completed'),
        className: 'bg-green-500/10 text-green-600',
      };
    }
    return {
      icon: Clock,
      label: t('documents.status.waiting'),
      className: 'bg-amber-500/10 text-amber-600',
    };
  })();
  const StatusIcon = statusConfig.icon;
  const statusBadge = (
    <Badge variant="outline" className={cn('shrink-0', statusConfig.className)}>
      <StatusIcon
        className={cn(
          'h-3 w-3 mr-1',
          processingStatus === 'processing' && 'animate-spin'
        )}
      />
      {statusConfig.label}
    </Badge>
  );
  const statusBadgeWithError = processingStatus === 'failed' && processingError ? (
    <Tooltip>
      <TooltipTrigger asChild>{statusBadge}</TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{processingError}</TooltipContent>
    </Tooltip>
  ) : statusBadge;

  if (viewMode === 'list') {
    return (
      <motion.div variants={itemVariants}>
        <Card className="hover-elevate transition-all">
          <div className="flex items-center gap-4 p-4">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium truncate">{document.titulo}</h3>
                {statusBadgeWithError}
                {document.sentToTrainingAt && (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600 shrink-0">
                    {t('documents.media.sentToTraining')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{truncatedContent}</p>
              {namespaceName && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('documents.namespace.label')}: {namespaceName}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              {canProcess && onReprocess && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReprocess}
                  disabled={isReprocessing}
                  data-testid={`button-reprocess-doc-${document.id}`}
                >
                  {isReprocessing ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3 mr-1" />
                  )}
                  {processActionLabel}
                </Button>
              )}
              {canSendToTraining && onSendToTraining && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={onSendToTraining}
                  disabled={isSendingToTraining}
                  data-testid={`button-send-to-training-doc-${document.id}`}
                >
                  {isSendingToTraining ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <GraduationCap className="h-3 w-3 mr-1" />
                  )}
                  {t('documents.media.sendToTraining')}
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onView} data-testid={`button-view-doc-${document.id}`}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('documents.actions.view')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-doc-${document.id}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('documents.actions.delete')}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate transition-all h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {statusBadgeWithError}
              {document.sentToTrainingAt && (
                <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                  {t('documents.media.sentToTraining')}
                </Badge>
              )}
            </div>
          </div>
          <CardTitle className="text-base mt-3 line-clamp-1">{document.titulo}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs">{truncatedContent}</CardDescription>
        </CardHeader>

        <CardContent className="flex-1 pb-2">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(document.criadoEm, { locale, timeZone })}
            </span>
            {document.tipo && (
              <span className="flex items-center gap-1">
                <FileType className="h-3 w-3" />
                {document.tipo.split('/').pop()}
              </span>
            )}
            {namespaceName && (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {namespaceName}
              </span>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-2 gap-1 flex-wrap">
          {canProcess && onReprocess && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onReprocess}
              disabled={isReprocessing}
              data-testid={`button-reprocess-doc-${document.id}`}
            >
              {isReprocessing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3 mr-1" />
              )}
              {processActionLabel}
            </Button>
          )}
          {canSendToTraining && onSendToTraining && (
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={onSendToTraining}
              disabled={isSendingToTraining}
              data-testid={`button-send-to-training-doc-${document.id}`}
            >
              {isSendingToTraining ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <GraduationCap className="h-3 w-3 mr-1" />
              )}
              {t('documents.media.sendToTraining')}
            </Button>
          )}
          <Button variant="outline" size="sm" className="flex-1" onClick={onView} data-testid={`button-view-doc-${document.id}`}>
            <Eye className="h-3 w-3 mr-1" />
            {t('documents.actions.view')}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-doc-${document.id}`}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

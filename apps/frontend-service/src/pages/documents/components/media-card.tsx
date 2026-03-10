import { motion } from 'framer-motion';
import {
  Calendar,
  Eye,
  ExternalLink,
  FileAudio,
  GraduationCap,
  ImageIcon,
  Layers,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatDate } from '@/lib/utils';

type MediaUploadCardData = {
  approvedForTraining?: boolean | null;
  criadoEm: string;
  fileUrl: string | null;
  id: string;
  llmDescription?: string | null;
  mediaType: 'image' | 'audio';
  namespaceId: string | null;
  originalFilename: string;
  processingStatus: string;
  transcription?: string | null;
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

export function MediaCard({
  canPromote,
  isSending,
  locale,
  media,
  namespaceName,
  onDelete,
  onSendToTraining,
  onView,
  t,
  timeZone,
  viewMode,
}: {
  canPromote: boolean;
  isSending: boolean;
  locale: string;
  media: MediaUploadCardData;
  namespaceName?: string;
  onDelete: () => void;
  onSendToTraining?: () => void;
  onView: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
  viewMode: 'grid' | 'list';
}) {
  const statusKey =
    media.processingStatus === 'completed'
      ? 'documents.media.statusProcessed'
      : media.processingStatus === 'failed'
        ? 'documents.media.statusError'
        : 'documents.media.statusPending';
  const MediaIcon = media.mediaType === 'image' ? ImageIcon : FileAudio;

  if (viewMode === 'list') {
    return (
      <motion.div variants={itemVariants}>
        <Card className="hover-elevate transition-all">
          <div className="flex items-center gap-4 p-4">
            <div
              className={cn(
                'p-2 rounded-lg shrink-0',
                media.mediaType === 'image' && 'bg-blue-500/10',
                media.mediaType === 'audio' && 'bg-green-500/10'
              )}
            >
              <MediaIcon
                className={media.mediaType === 'image' ? 'h-5 w-5 text-blue-500' : 'h-5 w-5 text-green-500'}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium truncate">{media.originalFilename}</h3>
                {media.approvedForTraining && (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600 shrink-0">
                    {t('documents.media.sentToTraining')}
                  </Badge>
                )}
                <Badge variant="outline" className="shrink-0">
                  {t(statusKey)}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                {namespaceName && (
                  <span className="flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {namespaceName}
                  </span>
                )}
                <span>{formatDate(media.criadoEm, { locale, timeZone })}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canPromote && onSendToTraining && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={onSendToTraining}
                      disabled={isSending}
                      data-testid={`button-send-to-training-media-${media.id}`}
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <GraduationCap className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('documents.media.sendToTraining')}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onView} data-testid={`button-view-media-${media.id}`}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('documents.actions.view')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-media-${media.id}`}>
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
            <div
              className={cn(
                'p-2 rounded-lg',
                media.mediaType === 'image' && 'bg-blue-500/10',
                media.mediaType === 'audio' && 'bg-green-500/10'
              )}
            >
              <MediaIcon
                className={media.mediaType === 'image' ? 'h-5 w-5 text-blue-500' : 'h-5 w-5 text-green-500'}
              />
            </div>
            <div className="flex items-center gap-1">
              {media.approvedForTraining && (
                <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                  {t('documents.media.sentToTraining')}
                </Badge>
              )}
              <Badge variant="outline">{t(statusKey)}</Badge>
            </div>
          </div>
          <CardTitle className="text-base mt-3 line-clamp-1">{media.originalFilename}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs">
            {media.mediaType === 'image'
              ? (media.llmDescription?.slice(0, 100) ?? '') + ((media.llmDescription?.length ?? 0) > 100 ? '...' : '')
              : (media.transcription?.slice(0, 100) ?? '') + ((media.transcription?.length ?? 0) > 100 ? '...' : '') || '-'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-2">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(media.criadoEm, { locale, timeZone })}
            </span>
            {namespaceName && (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {namespaceName}
              </span>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-2 gap-1">
          {canPromote && onSendToTraining && (
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={onSendToTraining}
              disabled={isSending}
              data-testid={`button-send-to-training-media-${media.id}`}
            >
              {isSending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <GraduationCap className="h-3 w-3 mr-1" />
              )}
              {t('documents.media.sendToTraining')}
            </Button>
          )}
          {media.approvedForTraining && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-600 shrink-0">
              {t('documents.media.sentToTraining')}
            </Badge>
          )}
          <Button variant="outline" size="sm" className="flex-1" onClick={onView} data-testid={`button-view-media-${media.id}`}>
            <ExternalLink className="h-3 w-3 mr-1" />
            {t('documents.actions.view')}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-media-${media.id}`}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

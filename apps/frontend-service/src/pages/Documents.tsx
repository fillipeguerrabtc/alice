/**
 * Documents - Gestão de Documentos RAG
 *
 * Página unificada para upload, visualização e gestão de documentos e mídia
 * para o sistema de Retrieval-Augmented Generation.
 *
 * Plano RAG Multimodal Enterprise Fase 3: Documentos + Mídia em visão única.
 *
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 *
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Upload,
  Search,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  Filter,
  Grid,
  List,
  Loader2,
  FileType,
  Calendar,
  Layers,
  ImageIcon,
  FileAudio,
  ExternalLink,
  GraduationCap,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/queryClient';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';

interface Document {
  id: string;
  titulo: string;
  conteudo: string;
  tipo: string | null;
  fonte: string | null;
  urlOrigem: string | null;
  processado: boolean;
  criadoEm: string;
  atualizadoEm?: string;
  namespaceId: string | null;
  sentToTrainingAt?: string | null;
  metadata?: {
    processingStatus?: 'pending' | 'processing' | 'failed' | 'completed';
    processingError?: string | null;
    processedAt?: string | null;
    chunksCount?: number | null;
    sourceType?: string;
    originalFilename?: string;
    uploadedAt?: string;
    uploadedByUserId?: string | null;
  } | null;
}

interface DocumentsResponse {
  documents: Document[];
}

interface Namespace {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
}

interface MediaUpload {
  id: string;
  mediaType: 'image' | 'audio';
  originalFilename: string;
  fileUrl: string | null;
  processingStatus: string;
  namespaceId: string | null;
  criadoEm: string;
  llmDescription?: string | null;
  transcription?: string | null;
  approvedForTraining?: boolean | null;
}

interface MediaUploadsResponse {
  uploads: MediaUpload[];
  pagination: { limit: number; offset: number; total: number };
}

type DocumentProcessingStatus = 'pending' | 'processing' | 'failed' | 'completed';

function getDocumentProcessingStatus(document: Document): DocumentProcessingStatus {
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

function getDocumentProcessingError(document: Document): string | null {
  const error = document.metadata?.processingError;
  return typeof error === 'string' && error.trim().length > 0 ? error : null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10 },
} as const;

function DocumentCard({ 
  document, 
  onView, 
  onDelete,
  onReprocess,
  onSendToTraining,
  isReprocessing,
  isSendingToTraining,
  viewMode,
  namespaceName,
  t,
  locale,
  timeZone,
}: { 
  document: Document;
  onView: () => void;
  onDelete: () => void;
  onReprocess?: () => void;
  onSendToTraining?: () => void;
  isReprocessing: boolean;
  isSendingToTraining: boolean;
  viewMode: 'grid' | 'list';
  namespaceName?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
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
  const canReprocess = processingStatus === 'failed' && Boolean(onReprocess);
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
              {canReprocess && onReprocess && (
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
                  {t('documents.actions.reprocess')}
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
          {canReprocess && onReprocess && (
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
              {t('documents.actions.reprocess')}
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

function UploadZone({
  onUpload,
  isUploading,
  disabled,
  t,
}: {
  onUpload: (file: File) => void;
  isUploading: boolean;
  disabled: boolean;
  t: (key: string) => string;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'border-2 border-dashed rounded-lg p-5 sm:p-6 text-center transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
        (isUploading || disabled) && 'opacity-50 pointer-events-none'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        onChange={handleFileChange}
        accept=".txt,.md,.pdf,.docx,.csv,.json"
        disabled={isUploading || disabled}
      />
      <label htmlFor="file-upload" className="cursor-pointer">
        <div className="flex flex-col items-center gap-3">
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : disabled ? (
            <div className="p-3 rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
          ) : (
            <div className="p-3 rounded-full bg-primary/10">
              <Upload className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">
              {isUploading
                ? t('documents.uploadZone.sending')
                : disabled
                  ? t('documents.uploadZone.selectNamespaceFirst')
                  : t('documents.uploadZone.dragOrClick')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('documents.uploadZone.supportedTypes')}
            </p>
          </div>
        </div>
      </label>
    </motion.div>
  );
}

function DocumentViewer({
  document,
  onClose,
  t,
  locale,
  timeZone,
}: {
  document: Document;
  onClose: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
}) {
  const formattedDate = formatDateTime(document.criadoEm, { locale, timeZone });
  const processingStatus = getDocumentProcessingStatus(document);
  const processingError = getDocumentProcessingError(document);
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
  
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl h-[80vh] overflow-hidden flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {document.titulo}
          </DialogTitle>
          <DialogDescription>
            {t('documents.viewer.createdAt', { date: formattedDate })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 flex-wrap">
          <Badge className={statusConfig.className}>
            <StatusIcon className={cn('h-3 w-3 mr-1', processingStatus === 'processing' && 'animate-spin')} />
            {statusConfig.label}
          </Badge>
          {document.sentToTrainingAt && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-600">
              {t('documents.media.sentToTraining')}
            </Badge>
          )}
          {document.tipo && (
            <Badge variant="outline">
              <FileType className="h-3 w-3 mr-1" />
              {document.tipo}
            </Badge>
          )}
          {document.fonte && (
            <Badge variant="outline">
              {t('documents.viewer.source', { source: document.fonte })}
            </Badge>
          )}
        </div>
        {processingStatus === 'failed' && processingError && (
          <p className="text-sm text-red-600 break-words">
            {processingError}
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-auto border rounded-lg p-4 bg-muted/30">
          <pre className="whitespace-pre-wrap text-sm font-mono">{document.conteudo}</pre>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-viewer">
            {t('documents.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaCard({
  media,
  namespaceName,
  onView,
  onDelete,
  onSendToTraining,
  canPromote,
  isSending,
  viewMode,
  t,
  locale,
  timeZone,
}: {
  media: MediaUpload;
  namespaceName?: string;
  onView: () => void;
  onDelete: () => void;
  onSendToTraining?: () => void;
  canPromote: boolean;
  isSending: boolean;
  viewMode: 'grid' | 'list';
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
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

export default function Documents() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  
  const [activeTab, setActiveTab] = useState<'documents' | 'media'>('documents');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [filterStatus, setFilterStatus] = useState<'all' | 'processed' | 'pending'>('all');
  const [filterMediaType, setFilterMediaType] = useState<'all' | 'image' | 'audio'>('all');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<Document | null>(null);
  const [_selectedMedia, setSelectedMedia] = useState<MediaUpload | null>(null);
  const [deleteMedia, setDeleteMedia] = useState<MediaUpload | null>(null);
  const [selectedNamespaceId, setSelectedNamespaceId] = useState<string>('');
  const [sendTrainingDialogOpen, setSendTrainingDialogOpen] = useState(false);
  const [selectedMediaForTraining, setSelectedMediaForTraining] = useState<MediaUpload | null>(null);
  const [selectedTrainingNamespaceId, setSelectedTrainingNamespaceId] = useState<string>('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const { data, isLoading, error } = useQuery<DocumentsResponse>({
    queryKey: ['/api/rag/documents'],
    staleTime: 1000 * 60,
    enabled: !!user, // Só executar após autenticação
  });

  const { data: namespaces, isLoading: isLoadingNamespaces } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    enabled: !!user,
    staleTime: 1000 * 60,
  });

  const mediaQueryParams = new URLSearchParams();
  mediaQueryParams.set('limit', '100');
  if (filterMediaType !== 'all') mediaQueryParams.set('mediaType', filterMediaType);
  if (selectedNamespaceId) mediaQueryParams.set('namespaceId', selectedNamespaceId);

  const { data: mediaData, isLoading: isLoadingMedia, error: mediaError } = useQuery<MediaUploadsResponse>({
    queryKey: ['/api/media/uploads', mediaQueryParams.toString()],
    enabled: activeTab === 'media' && !!user,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/media/uploads?${mediaQueryParams.toString()}`);
      return response.json() as Promise<MediaUploadsResponse>;
    },
  });

  const activeNamespaces = (namespaces ?? []).filter((namespace) => namespace.ativo);
  const namespaceMap = new Map((namespaces ?? []).map((namespace) => [namespace.id, namespace.nome]));

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedNamespaceId) {
        throw new Error(t('documents.errors.namespaceRequired'));
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('titulo', file.name);
      formData.append('namespaceId', selectedNamespaceId);

      const response = await fetch('/api/rag/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('documents.errors.uploadFailed'));
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      setUploadDialogOpen(false);
      toast({ title: t('documents.success.uploaded') });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.uploadFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/rag/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      setDeleteDocument(null);
      toast({ title: t('documents.success.deleted') });
    },
    onError: () => {
      toast({ title: t('documents.errors.deleteFailed'), variant: 'destructive' });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/media/uploads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setDeleteMedia(null);
      toast({ title: t('documents.success.deleted') });
    },
    onError: () => {
      toast({ title: t('documents.media.loadFailed'), variant: 'destructive' });
    },
  });

  const sendToTrainingMutation = useMutation({
    mutationFn: async (params: { mediaUploadId: string; namespaceId: string }) => {
      const response = await apiRequest('POST', `/api/media/uploads/${params.mediaUploadId}/send-to-training`, {
        namespaceId: params.namespaceId,
      });
      return response.json() as Promise<{ success: boolean; data?: { trainingDataId?: string } }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setSendTrainingDialogOpen(false);
      setSelectedMediaForTraining(null);
      setSelectedTrainingNamespaceId('');
      toast({ title: t('documents.media.sentToTraining') });
    },
    onError: (err: Error & { response?: { json?: () => Promise<{ error?: string }> } }) => {
      const message = err?.message ?? t('documents.media.loadFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const reprocessDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest('POST', `/api/rag/documents/${documentId}/reprocess`, {});
      return response.json() as Promise<{ jobId: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: t('documents.success.reprocessQueued') });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.reprocessFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const sendDocumentToTrainingMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest('POST', `/api/rag/documents/${documentId}/send-to-training`, {});
      return response.json() as Promise<{ success: boolean; message?: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({
        title: t('documents.success.sentToTraining'),
        description: result.message,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.sendToTrainingFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const documents = data?.documents || [];
  
  const filteredDocuments = documents.filter(doc => {
    const processingStatus = getDocumentProcessingStatus(doc);
    const matchesSearch = doc.titulo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (doc.conteudo?.toLowerCase().includes(searchQuery.toLowerCase()) || false);
    
    const matchesStatus = filterStatus === 'all' ||
                          (filterStatus === 'processed' && processingStatus === 'completed') ||
                          (filterStatus === 'pending' && processingStatus !== 'completed');
    
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: documents.length,
    processed: documents.filter((document) => getDocumentProcessingStatus(document) === 'completed').length,
    pending: documents.filter((document) => getDocumentProcessingStatus(document) !== 'completed').length,
  };
  const isNamespaceReady = selectedNamespaceId !== '' && activeNamespaces.length > 0;

  const mediaUploads = (mediaData?.uploads ?? []).filter(
    (u): u is MediaUpload => (u.mediaType === 'image' || u.mediaType === 'audio')
  );
  const filteredMediaUploads = mediaUploads.filter((media) => {
    if (!mediaSearchQuery.trim()) return true;
    const search = mediaSearchQuery.toLowerCase();
    return (
      media.originalFilename.toLowerCase().includes(search) ||
      (media.llmDescription?.toLowerCase().includes(search) ?? false) ||
      (media.transcription?.toLowerCase().includes(search) ?? false)
    );
  });
  const mediaStats = { total: mediaUploads.length };

  const handleViewMedia = useCallback((media: MediaUpload) => {
    if (media.fileUrl) {
      const url = media.fileUrl.startsWith('http') ? media.fileUrl : `${window.location.origin}${media.fileUrl.startsWith('/') ? '' : '/'}${media.fileUrl}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setSelectedMedia(media);
    }
  }, []);

  const openSendToTrainingDialog = useCallback((media: MediaUpload) => {
    setSelectedMediaForTraining(media);
    setSelectedTrainingNamespaceId(media.namespaceId ?? '');
    setSendTrainingDialogOpen(true);
  }, []);

  if (error && activeTab === 'documents') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">{t('documents.errors.loadFailed')}</h2>
        <p className="text-muted-foreground text-center max-w-md">
          {t('documents.errors.loadFailedDesc')}
        </p>
        <Button 
          className="mt-4" 
          onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] })}
          data-testid="button-retry-load"
        >
          {t('documents.actions.retry')}
        </Button>
      </div>
    );
  }

  if (mediaError && activeTab === 'media') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">{t('documents.media.loadFailed')}</h2>
        <Button 
          className="mt-4" 
          onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] })}
          data-testid="button-retry-media"
        >
          {t('documents.actions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'documents' | 'media')}
        className="flex flex-1 min-h-0 flex-col overflow-hidden"
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 border-b bg-background/95 p-4 backdrop-blur"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-documents-title">
                {t('documents.title')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('documents.subtitle')}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeTab === 'documents' && (
                <>
                  <Badge variant="secondary" className="gap-1">
                    <Layers className="h-3 w-3" />
                    {t('documents.stats.documentsCount', { count: stats.total })}
                  </Badge>
                  <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('documents.stats.processedCount', { count: stats.processed })}
                  </Badge>
                </>
              )}
              {activeTab === 'media' && (
                <Badge variant="secondary" className="gap-1">
                  {t('documents.media.statsCount', { count: mediaStats.total })}
                </Badge>
              )}
            </div>
          </div>

          <TabsList className="grid w-full max-w-[280px] grid-cols-2">
            <TabsTrigger value="documents" data-testid="tab-documents">
              {t('documents.tabs.documents')}
            </TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">
              {t('documents.tabs.media')}
            </TabsTrigger>
          </TabsList>
        </motion.div>

        <TabsContent
          value="documents"
          className="mt-0 h-full flex-1 min-h-0 overflow-hidden p-4 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="flex min-h-0 min-w-0 flex-col gap-4">
              <Card className="min-w-0">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t('documents.uploadDocument')}</CardTitle>
                  <CardDescription>{t('documents.namespace.helper')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{t('documents.namespace.label')}</span>
                    </div>
                    <Select
                      value={selectedNamespaceId}
                      onValueChange={setSelectedNamespaceId}
                      disabled={isLoadingNamespaces || activeNamespaces.length === 0}
                    >
                      <SelectTrigger className="w-full" data-testid="select-namespace">
                        <SelectValue
                          placeholder={
                            activeNamespaces.length === 0
                              ? t('documents.namespace.empty')
                              : t('documents.namespace.placeholder')
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {activeNamespaces.map((namespace) => (
                          <SelectItem key={namespace.id} value={namespace.id}>
                            {namespace.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => setUploadDialogOpen(true)}
                      disabled={!isNamespaceReady || uploadMutation.isPending}
                      data-testid="button-open-upload-dialog"
                    >
                      {uploadMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {t('documents.uploadDocument')}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {selectedNamespaceId
                        ? `${t('documents.namespace.label')}: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
                        : t('documents.uploadZone.selectNamespaceFirst')}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('documents.stats.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{t('documents.stats.processed')}</span>
                    <span className="font-medium">
                      {stats.processed}/{stats.total}
                    </span>
                  </div>
                  <Progress value={(stats.processed / Math.max(stats.total, 1)) * 100} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t('documents.stats.pendingCount', { count: stats.pending })}</span>
                    <span>{Math.round((stats.processed / Math.max(stats.total, 1)) * 100)}%</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <Card className="flex min-h-[320px] min-w-0 flex-1 flex-col lg:min-h-0">
                <CardHeader className="shrink-0 gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[200px] flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={t('documents.search.placeholder')}
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-documents"
                      />
                    </div>

                    <Select value={filterStatus} onValueChange={(v: string) => setFilterStatus(v as typeof filterStatus)}>
                      <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
                        <Filter className="mr-2 h-4 w-4" />
                        <SelectValue placeholder={t('documents.search.filter')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('documents.search.all')}</SelectItem>
                        <SelectItem value="processed">{t('documents.search.processed')}</SelectItem>
                        <SelectItem value="pending">{t('documents.search.pending')}</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="flex rounded-lg border">
                      <Button
                        variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => setViewMode('grid')}
                        data-testid="button-view-grid"
                      >
                        <Grid className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => setViewMode('list')}
                        data-testid="button-view-list"
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                  {isLoading ? (
                    <div
                      className={cn(
                        'gap-4',
                        viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                      )}
                    >
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className={viewMode === 'grid' ? 'h-48' : 'h-20'} />
                      ))}
                    </div>
                  ) : filteredDocuments.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex h-64 flex-col items-center justify-center text-center"
                    >
                      <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
                      <h3 className="mb-1 font-medium">
                        {searchQuery ? t('documents.empty.noResults') : t('documents.empty.noDocuments')}
                      </h3>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {searchQuery ? t('documents.empty.tryOtherTerms') : t('documents.empty.uploadToStart')}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className={cn(
                        'gap-4',
                        viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                      )}
                    >
                      <AnimatePresence>
                        {filteredDocuments.map((doc) => (
                          <DocumentCard
                            key={doc.id}
                            document={doc}
                            viewMode={viewMode}
                            namespaceName={doc.namespaceId ? namespaceMap.get(doc.namespaceId) : undefined}
                            onView={() => setSelectedDocument(doc)}
                            onDelete={() => setDeleteDocument(doc)}
                            onReprocess={() => reprocessDocumentMutation.mutate(doc.id)}
                            onSendToTraining={() => sendDocumentToTrainingMutation.mutate(doc.id)}
                            isReprocessing={
                              reprocessDocumentMutation.isPending &&
                              reprocessDocumentMutation.variables === doc.id
                            }
                            isSendingToTraining={
                              sendDocumentToTrainingMutation.isPending &&
                              sendDocumentToTrainingMutation.variables === doc.id
                            }
                            t={t}
                            locale={locale}
                            timeZone={timeZone}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="media"
          className="mt-0 h-full flex-1 min-h-0 overflow-hidden p-4 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-4 h-full min-h-0">
            <div className="flex min-h-0 min-w-0 flex-col gap-4">
              <Card className="min-w-0">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t('documents.namespace.label')}</CardTitle>
                  <CardDescription>{t('documents.namespace.helper')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select
                    value={selectedNamespaceId || '__all__'}
                    onValueChange={(v) => setSelectedNamespaceId(v === '__all__' ? '' : v)}
                    disabled={isLoadingNamespaces || activeNamespaces.length === 0}
                  >
                    <SelectTrigger className="w-full" data-testid="select-media-namespace">
                      <SelectValue placeholder={t('documents.namespace.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t('documents.search.all')}</SelectItem>
                      {activeNamespaces.map((ns) => (
                        <SelectItem key={ns.id} value={ns.id}>
                          {ns.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('documents.stats.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{t('documents.media.statsCount', { count: mediaStats.total })}</span>
                    <span className="font-medium">{mediaStats.total}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedNamespaceId
                      ? t('documents.namespace.label') + `: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
                      : t('documents.search.all')}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col min-h-0 min-w-0">
              <Card className="flex min-h-[320px] min-w-0 flex-1 flex-col lg:min-h-0">
                <CardHeader className="shrink-0 gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[200px] flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={t('documents.search.placeholder')}
                        value={mediaSearchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMediaSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-media"
                      />
                    </div>

                    <Select
                      value={filterMediaType}
                      onValueChange={(v: string) => setFilterMediaType(v as typeof filterMediaType)}
                    >
                      <SelectTrigger className="w-[160px]" data-testid="select-media-type">
                        <Filter className="mr-2 h-4 w-4" />
                        <SelectValue placeholder={t('documents.media.filterType')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('documents.media.filterAll')}</SelectItem>
                        <SelectItem value="image">{t('documents.media.filterImage')}</SelectItem>
                        <SelectItem value="audio">{t('documents.media.filterAudio')}</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="flex rounded-lg border">
                      <Button
                        variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => setViewMode('grid')}
                        data-testid="button-view-media-grid"
                      >
                        <Grid className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => setViewMode('list')}
                        data-testid="button-view-media-list"
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 min-h-0 overflow-y-auto">
                  {isLoadingMedia ? (
                    <div
                      className={cn(
                        'gap-4',
                        viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                      )}
                    >
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className={viewMode === 'grid' ? 'h-48' : 'h-20'} />
                      ))}
                    </div>
                  ) : filteredMediaUploads.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex h-64 flex-col items-center justify-center text-center"
                    >
                      <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground/50" />
                      <h3 className="mb-1 font-medium">
                        {mediaSearchQuery ? t('documents.empty.noResults') : t('documents.media.empty')}
                      </h3>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {mediaSearchQuery ? t('documents.empty.tryOtherTerms') : t('documents.media.emptyDesc')}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className={cn(
                        'gap-4',
                        viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                      )}
                    >
                      <AnimatePresence>
                        {filteredMediaUploads.map((media) => {
                          const canPromote =
                            media.processingStatus === 'completed' &&
                            Boolean(media.namespaceId) &&
                            !media.approvedForTraining;
                          return (
                            <MediaCard
                              key={media.id}
                              media={media}
                              viewMode={viewMode}
                              namespaceName={media.namespaceId ? namespaceMap.get(media.namespaceId) : undefined}
                              onView={() => handleViewMedia(media)}
                              onDelete={() => setDeleteMedia(media)}
                              onSendToTraining={canPromote ? () => openSendToTrainingDialog(media) : undefined}
                              canPromote={canPromote}
                              isSending={
                                sendToTrainingMutation.isPending &&
                                sendToTrainingMutation.variables?.mediaUploadId === media.id
                              }
                              t={t}
                              locale={locale}
                              timeZone={timeZone}
                            />
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('documents.uploadDocument')}</DialogTitle>
            <DialogDescription>{t('documents.uploadZone.supportedTypes')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {selectedNamespaceId
                ? `${t('documents.namespace.label')}: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
                : t('documents.uploadZone.selectNamespaceFirst')}
            </p>
            <UploadZone
              onUpload={(file) => uploadMutation.mutate(file)}
              isUploading={uploadMutation.isPending}
              disabled={!isNamespaceReady}
              t={t}
            />
          </div>
        </DialogContent>
      </Dialog>

      {selectedDocument && (
        <DocumentViewer 
          document={selectedDocument} 
          onClose={() => setSelectedDocument(null)}
          t={t}
          locale={locale}
          timeZone={timeZone}
        />
      )}

      {deleteDocument && (
        <Dialog open onOpenChange={() => setDeleteDocument(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('documents.delete.title')}</DialogTitle>
              <DialogDescription>
                {t('documents.delete.description', { title: deleteDocument.titulo })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDocument(null)} data-testid="button-cancel-delete">
                {t('documents.actions.cancel')}
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteMutation.mutate(deleteDocument.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t('documents.actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteMedia && (
        <Dialog open onOpenChange={() => setDeleteMedia(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('documents.delete.title')}</DialogTitle>
              <DialogDescription>
                {t('documents.delete.description', { title: deleteMedia.originalFilename })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteMedia(null)} data-testid="button-cancel-delete-media">
                {t('documents.actions.cancel')}
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteMediaMutation.mutate(deleteMedia.id)}
                disabled={deleteMediaMutation.isPending}
                data-testid="button-confirm-delete-media"
              >
                {deleteMediaMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t('documents.actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={sendTrainingDialogOpen}
        onOpenChange={(open) => {
          setSendTrainingDialogOpen(open);
          if (!open) {
            setSelectedMediaForTraining(null);
            setSelectedTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar para Treinamento</DialogTitle>
            <DialogDescription>
              Selecione o namespace de destino para gerar o dataset dessa mídia.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Select value={selectedTrainingNamespaceId} onValueChange={setSelectedTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {activeNamespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSendTrainingDialogOpen(false);
                setSelectedMediaForTraining(null);
                setSelectedTrainingNamespaceId('');
              }}
            >
              {t('documents.actions.cancel')}
            </Button>
            <Button
              disabled={!selectedMediaForTraining || !selectedTrainingNamespaceId || sendToTrainingMutation.isPending}
              onClick={() => {
                if (!selectedMediaForTraining || !selectedTrainingNamespaceId) {
                  toast({ title: 'Namespace obrigatório', variant: 'destructive' });
                  return;
                }
                sendToTrainingMutation.mutate({
                  mediaUploadId: selectedMediaForTraining.id,
                  namespaceId: selectedTrainingNamespaceId,
                });
              }}
            >
              {sendToTrainingMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Confirmar envio'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

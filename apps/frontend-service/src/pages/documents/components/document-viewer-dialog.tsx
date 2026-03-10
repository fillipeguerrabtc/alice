import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock, FileText, FileType, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { cn, formatDateTime } from '@/lib/utils';

type DocumentProcessingStatus = 'pending' | 'processing' | 'failed' | 'completed';

type ViewerDocument = {
  conteudo: string;
  criadoEm: string;
  fonte: string | null;
  id: string;
  metadata?: {
    processingError?: string | null;
    processingStatus?: DocumentProcessingStatus;
  } | null;
  processado: boolean;
  sentToTrainingAt?: string | null;
  tipo: string | null;
  titulo: string;
};

type DocumentViewerDialogProps = {
  document: ViewerDocument;
  locale: string;
  onClose: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
};

function getDocumentProcessingStatus(document: ViewerDocument): DocumentProcessingStatus {
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

function getDocumentProcessingError(document: ViewerDocument): string | null {
  const error = document.metadata?.processingError;
  return typeof error === 'string' && error.trim().length > 0 ? error : null;
}

export function DocumentViewerDialog({
  document,
  locale,
  onClose,
  t,
  timeZone,
}: DocumentViewerDialogProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(document.titulo);
  const [editedContent, setEditedContent] = useState(document.conteudo ?? '');
  const formattedDate = formatDateTime(document.criadoEm, { locale, timeZone });
  const processingStatus = getDocumentProcessingStatus(document);
  const processingError = getDocumentProcessingError(document);
  const canSave = editedTitle.trim().length > 0 && editedContent.trim().length > 0;

  useEffect(() => {
    setIsEditing(false);
    setEditedTitle(document.titulo);
    setEditedContent(document.conteudo ?? '');
  }, [document.conteudo, document.id, document.titulo]);

  const saveDocumentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('PATCH', `/api/rag/documents/${document.id}`, {
        titulo: editedTitle.trim(),
        conteudo: editedContent,
      });
      return response.json() as Promise<{ documentId: string; jobId: string }>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: t('documents.success.savedQueued') });
      onClose();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.saveFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditedTitle(document.titulo);
    setEditedContent(document.conteudo ?? '');
  };

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

        {isEditing ? (
          <div className="flex-1 min-h-0 overflow-auto border rounded-lg p-4 bg-muted/30 space-y-3">
            <Input
              value={editedTitle}
              onChange={(event) => setEditedTitle(event.target.value)}
              disabled={saveDocumentMutation.isPending}
              data-testid={`input-edit-document-title-${document.id}`}
            />
            <Textarea
              value={editedContent}
              onChange={(event) => setEditedContent(event.target.value)}
              className="min-h-[420px] resize-y font-mono text-sm"
              disabled={saveDocumentMutation.isPending}
              data-testid={`textarea-edit-document-content-${document.id}`}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto border rounded-lg p-4 bg-muted/30">
            <pre className="whitespace-pre-wrap text-sm font-mono">{document.conteudo}</pre>
          </div>
        )}

        <DialogFooter className="gap-2">
          {isEditing ? (
            <>
              <Button
                variant="outline"
                onClick={handleCancelEditing}
                disabled={saveDocumentMutation.isPending}
                data-testid={`button-cancel-edit-document-${document.id}`}
              >
                {t('documents.actions.cancel')}
              </Button>
              <Button
                onClick={() => saveDocumentMutation.mutate()}
                disabled={!canSave || saveDocumentMutation.isPending}
                data-testid={`button-save-document-${document.id}`}
              >
                {saveDocumentMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {t('documents.actions.save')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => setIsEditing(true)}
              data-testid={`button-edit-document-${document.id}`}
            >
              {t('documents.actions.edit')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} data-testid="button-close-viewer">
            {t('documents.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

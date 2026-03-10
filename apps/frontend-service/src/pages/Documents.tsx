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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { DocumentsTabContent } from '@/pages/documents/components/documents-tab-content';
import { MediaTabContent } from '@/pages/documents/components/media-tab-content';
import { UploadDialog } from '@/pages/documents/components/upload-dialog';
import { DeleteConfirmDialog } from '@/pages/documents/components/delete-confirm-dialog';
import { MediaSendTrainingDialog } from '@/pages/documents/components/media-send-training-dialog';
import { UploadZone } from '@/pages/documents/components/upload-zone';
import { DocumentViewerDialog } from '@/pages/documents/components/document-viewer-dialog';
import { DocumentCard } from '@/pages/documents/components/document-card';
import { MediaCard } from '@/pages/documents/components/media-card';
import { DocumentsWorkspaceHeader } from '@/pages/documents/components/documents-workspace-header';
import {
  DOCUMENTS_TAB_CONFIG,
  DOCUMENTS_WORKSPACE_OPTIONS,
  getDocumentProcessingStatus,
} from '@/pages/documents/config';
import { useDocumentsDialogOrchestration } from '@/pages/documents/hooks/use-documents-dialog-orchestration';
import { useDocumentsDerivedState } from '@/pages/documents/hooks/use-documents-derived-state';
import { useDocumentsMutations } from '@/pages/documents/hooks/use-documents-mutations';
import type {
  Document,
  DocumentsResponse,
  DocumentsTabId,
  DocumentsWorkspaceId,
  MediaUpload,
  MediaUploadsResponse,
  Namespace,
} from '@/pages/documents/types';

export default function Documents() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  
  const [activeTab, setActiveTab] = useState<DocumentsTabId>('documents');
  const [activeWorkspace, setActiveWorkspace] = useState<DocumentsWorkspaceId>('all');
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

  const visibleTabConfig = activeWorkspace === 'all'
    ? DOCUMENTS_TAB_CONFIG
    : DOCUMENTS_TAB_CONFIG.filter((tab) => tab.workspace === activeWorkspace);

  const handleWorkspaceChange = (workspace: DocumentsWorkspaceId) => {
    setActiveWorkspace(workspace);
    const candidateTabs = workspace === 'all'
      ? DOCUMENTS_TAB_CONFIG
      : DOCUMENTS_TAB_CONFIG.filter((tab) => tab.workspace === workspace);
    if (!candidateTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(candidateTabs[0]?.id ?? 'documents');
    }
  };

  const { data, isLoading, error } = useQuery<DocumentsResponse>({
    queryKey: ['/api/rag/documents'],
    staleTime: 1000 * 60,
    refetchInterval: (query) => {
      const documentsData = (query.state.data as DocumentsResponse | undefined)?.documents ?? [];
      const hasPendingDocuments = documentsData.some((document) => getDocumentProcessingStatus(document) !== 'completed');
      return hasPendingDocuments ? 3000 : false;
    },
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

  const {
    deleteMediaMutation,
    deleteMutation,
    reprocessDocumentMutation,
    sendDocumentToTrainingMutation,
    sendToTrainingMutation,
    uploadMutation,
  } = useDocumentsMutations({
    queryClient,
    selectedNamespaceId,
    setDeleteDocument,
    setDeleteMedia,
    setSelectedMediaForTraining,
    setSelectedTrainingNamespaceId,
    setSendTrainingDialogOpen,
    setUploadDialogOpen,
    t,
  });

  const documents = data?.documents || [];
  const {
    activeNamespaces,
    filteredDocuments,
    filteredMediaUploads,
    isNamespaceReady,
    mediaStats,
    namespaceMap,
    stats,
  } = useDocumentsDerivedState({
    documents,
    filterStatus,
    mediaData,
    mediaSearchQuery,
    namespaces,
    searchQuery,
    selectedNamespaceId,
  });

  const handleViewMedia = useCallback((media: MediaUpload) => {
    if (media.fileUrl) {
      const url = media.fileUrl.startsWith('http') ? media.fileUrl : `${window.location.origin}${media.fileUrl.startsWith('/') ? '' : '/'}${media.fileUrl}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setSelectedMedia(media);
    }
  }, []);

  const renderDocumentCard = useCallback((doc: Document) => (
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
  ), [
    locale,
    namespaceMap,
    reprocessDocumentMutation,
    sendDocumentToTrainingMutation,
    t,
    timeZone,
    viewMode,
  ]);

  const {
    handleConfirmDeleteDocument,
    handleConfirmDeleteMedia,
    handleConfirmSendToTraining,
    handleDeleteDocumentDialogOpenChange,
    handleDeleteMediaDialogOpenChange,
    handleSendTrainingDialogClose,
    handleSendTrainingDialogOpenChange,
    openSendToTrainingDialog,
    uploadNamespaceHelperText,
  } = useDocumentsDialogOrchestration({
    deleteDocument,
    deleteMedia,
    deleteMediaMutation,
    deleteMutation,
    namespaceMap,
    selectedMediaForTraining,
    selectedNamespaceId,
    selectedTrainingNamespaceId,
    sendToTrainingMutation,
    setDeleteDocument,
    setDeleteMedia,
    setSelectedMediaForTraining,
    setSelectedTrainingNamespaceId,
    setSendTrainingDialogOpen,
    t,
  });

  const renderMediaCard = useCallback((media: MediaUpload) => {
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
  }, [
    handleViewMedia,
    locale,
    namespaceMap,
    openSendToTrainingDialog,
    sendToTrainingMutation,
    t,
    timeZone,
    viewMode,
  ]);

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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as DocumentsTabId)}
        className="flex flex-1 min-h-0 flex-col"
      >
        <DocumentsWorkspaceHeader
          activeTab={activeTab}
          activeWorkspace={activeWorkspace}
          mediaTotal={mediaStats.total}
          onWorkspaceChange={handleWorkspaceChange}
          stats={stats}
          t={t}
          tabs={visibleTabConfig}
          workspaceOptions={DOCUMENTS_WORKSPACE_OPTIONS}
        />

        <DocumentsTabContent
          activeNamespaces={activeNamespaces}
          filterStatus={filterStatus}
          filteredDocuments={filteredDocuments}
          isLoading={isLoading}
          isLoadingNamespaces={isLoadingNamespaces}
          isNamespaceReady={isNamespaceReady}
          namespaceMap={namespaceMap}
          onFilterStatusChange={setFilterStatus}
          onOpenUploadDialog={() => setUploadDialogOpen(true)}
          onSearchChange={setSearchQuery}
          onSelectedNamespaceChange={setSelectedNamespaceId}
          onViewModeChange={setViewMode}
          renderDocumentCard={renderDocumentCard}
          searchQuery={searchQuery}
          selectedNamespaceId={selectedNamespaceId}
          stats={stats}
          t={t}
          uploadPending={uploadMutation.isPending}
          viewMode={viewMode}
        />

        <MediaTabContent
          activeNamespaces={activeNamespaces}
          filterMediaType={filterMediaType}
          filteredMediaUploads={filteredMediaUploads}
          isLoadingMedia={isLoadingMedia}
          isLoadingNamespaces={isLoadingNamespaces}
          mediaSearchQuery={mediaSearchQuery}
          mediaStats={mediaStats}
          namespaceMap={namespaceMap}
          onFilterMediaTypeChange={setFilterMediaType}
          onMediaSearchChange={setMediaSearchQuery}
          onSelectedNamespaceChange={(value) => setSelectedNamespaceId(value === '__all__' ? '' : value)}
          onViewModeChange={setViewMode}
          renderMediaCard={renderMediaCard}
          selectedNamespaceId={selectedNamespaceId}
          t={t}
          viewMode={viewMode}
        />
      </Tabs>

      <UploadDialog
        namespaceHelperText={uploadNamespaceHelperText}
        onOpenChange={setUploadDialogOpen}
        open={uploadDialogOpen}
        t={t}
        uploadZone={(
          <UploadZone
            onUpload={(file) => uploadMutation.mutate(file)}
            isUploading={uploadMutation.isPending}
            disabled={!isNamespaceReady}
            t={t}
          />
        )}
      />

      {selectedDocument && (
        <DocumentViewerDialog
          document={selectedDocument} 
          onClose={() => setSelectedDocument(null)}
          t={t}
          locale={locale}
          timeZone={timeZone}
        />
      )}

      {deleteDocument && (
        <DeleteConfirmDialog
          cancelLabel={t('documents.actions.cancel')}
          cancelTestId="button-cancel-delete"
          confirmLabel={t('documents.actions.delete')}
          confirmTestId="button-confirm-delete"
          description={t('documents.delete.description', { title: deleteDocument.titulo })}
          isPending={deleteMutation.isPending}
          onConfirm={handleConfirmDeleteDocument}
          onOpenChange={handleDeleteDocumentDialogOpenChange}
          open
          title={t('documents.delete.title')}
        />
      )}

      {deleteMedia && (
        <DeleteConfirmDialog
          cancelLabel={t('documents.actions.cancel')}
          cancelTestId="button-cancel-delete-media"
          confirmLabel={t('documents.actions.delete')}
          confirmTestId="button-confirm-delete-media"
          description={t('documents.delete.description', { title: deleteMedia.originalFilename })}
          isPending={deleteMediaMutation.isPending}
          onConfirm={handleConfirmDeleteMedia}
          onOpenChange={handleDeleteMediaDialogOpenChange}
          open
          title={t('documents.delete.title')}
        />
      )}

      <MediaSendTrainingDialog
        activeNamespaces={activeNamespaces}
        cancelLabel={t('documents.actions.cancel')}
        canSubmit={Boolean(selectedMediaForTraining) && Boolean(selectedTrainingNamespaceId)}
        confirmLabel="Confirmar envio"
        confirmLoadingLabel="Enviando..."
        isPending={sendToTrainingMutation.isPending}
        onCancel={handleSendTrainingDialogClose}
        onConfirm={handleConfirmSendToTraining}
        onNamespaceChange={setSelectedTrainingNamespaceId}
        onOpenChange={handleSendTrainingDialogOpenChange}
        open={sendTrainingDialogOpen}
        selectedNamespaceId={selectedTrainingNamespaceId}
      />
    </div>
  );
}

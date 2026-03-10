import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileAudio,
  FileCheck,
  Folder,
  Image,
  ImageIcon,
  Info,
  Loader2,
  Mic,
  RefreshCw,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';
import { apiRequest } from '@/lib/queryClient';
import { cn, formatDate } from '@/lib/utils';

interface Namespace {
  id: string;
  nome: string;
  slug: string;
}

interface MediaUpload {
  id: string;
  file: File;
  type: 'image' | 'audio';
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  uploadId?: string;
}

interface MediaUploadResult {
  id: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  processedAt?: string;
}

interface RagDocumentItem {
  id: string;
  namespaceId?: string | null;
  titulo: string;
  tipo?: string | null;
  processado: boolean;
  sentToTrainingAt?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export function TrainingMultimodalTabContent({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<MediaUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [description, setDescription] = useState('');
  const [namespaceId, setNamespaceId] = useState<string>('');
  const [promotingDocumentId, setPromotingDocumentId] = useState<string | null>(null);
  const [promotingMediaId, setPromotingMediaId] = useState<string | null>(null);
  const [documentTrainingDialogOpen, setDocumentTrainingDialogOpen] = useState(false);
  const [selectedDocumentForTraining, setSelectedDocumentForTraining] = useState<{ documentId: string; maxSamples?: number } | null>(null);
  const [documentTrainingNamespaceId, setDocumentTrainingNamespaceId] = useState<string>('');
  const [mediaTrainingDialogOpen, setMediaTrainingDialogOpen] = useState(false);
  const [selectedMediaForTraining, setSelectedMediaForTraining] = useState<string | null>(null);
  const [mediaTrainingNamespaceId, setMediaTrainingNamespaceId] = useState<string>('');

  const { data: namespacesData } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });
  const namespaces = namespacesData ?? [];

  const {
    data: ragDocumentsData,
    isLoading: isLoadingRagDocuments,
    refetch: refetchRagDocuments,
  } = useQuery<{ documents: RagDocumentItem[] }>({
    queryKey: ['/api/rag/documents'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/rag/documents');
      return response.json();
    },
  });

  const ragDocuments = ragDocumentsData?.documents ?? [];

  const {
    data: mediaUploadsData,
    isLoading: isLoadingMediaUploads,
    refetch: refetchMediaUploads,
  } = useQuery<{ uploads: Array<{
    id: string;
    mediaType: string;
    originalFilename: string;
    processingStatus: string;
    namespaceId: string | null;
    approvedForTraining: boolean | null;
    llmDescription?: string | null;
    transcription?: string | null;
    criadoEm: string;
  }> }>({
    queryKey: ['/api/media/uploads', { limit: 100 }],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/media/uploads?limit=100');
      return response.json();
    },
  });

  const mediaUploads = (mediaUploadsData?.uploads ?? []).filter(
    (u) => (u.mediaType === 'image' || u.mediaType === 'audio') && u.processingStatus === 'completed'
  );

  const [bookModeByDocument, setBookModeByDocument] = useState<Record<string, boolean>>({});

  const promoteDocumentToTraining = useMutation({
    mutationFn: async (params: { documentId: string; maxSamples?: number; namespaceId: string }) => {
      const body = {
        ...(params.maxSamples ? { maxSamples: params.maxSamples } : {}),
        scope: { namespaceId: params.namespaceId },
      };
      const response = await apiRequest('POST', `/api/rag/documents/${params.documentId}/send-to-training`, body);
      return response.json() as Promise<{
        success: boolean;
        data?: { attempted: number; sent: number; failed: number };
        message?: string;
      }>;
    },
    onMutate: (params) => {
      setPromotingDocumentId(params.documentId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      setDocumentTrainingDialogOpen(false);
      setSelectedDocumentForTraining(null);
      setDocumentTrainingNamespaceId('');
      toast({
        title: t('training.multimodal.promoteDocument.success'),
        description: result?.message ?? t('training.multimodal.promoteDocument.successDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Falha ao promover documento',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPromotingDocumentId(null);
      refetchRagDocuments();
    },
  });

  const promoteMediaToTraining = useMutation({
    mutationFn: async (params: { mediaUploadId: string; namespaceId: string }) => {
      const response = await apiRequest('POST', `/api/media/uploads/${params.mediaUploadId}/send-to-training`, {
        namespaceId: params.namespaceId,
      });
      return response.json() as Promise<{
        success: boolean;
        data?: { mediaUploadId: string; trainingDataId?: string };
        message?: string;
      }>;
    },
    onMutate: (params) => {
      setPromotingMediaId(params.mediaUploadId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setMediaTrainingDialogOpen(false);
      setSelectedMediaForTraining(null);
      setMediaTrainingNamespaceId('');
      toast({
        title: t('training.multimodal.promoteMedia.success'),
        description: result?.message ?? t('training.multimodal.promoteMedia.successDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('training.multimodal.promoteMedia.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPromotingMediaId(null);
      refetchMediaUploads();
    },
  });

  // Tipos de arquivo aceitos para cada categoria
  // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
  const acceptedTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'],
  } as const;

  const allAccepted = [
    ...acceptedTypes.image,
    ...acceptedTypes.audio,
  ].join(',');

  // Determinar tipo de mídia baseado no MIME type
  // BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
  // MIME types são case-insensitive segundo RFC 2045, mas podem vir com variações (ex: "Image/JPEG", "Audio/MPEG")
  // .toLowerCase() e .trim() garantem matching correto mesmo com variações
  // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais (ex: "audio/mpeg; codecs=mp3")
  // Consistente com normalização em rag-service, chat-service e integrations-service para evitar rejeição de tipos legítimos
  // BUG FIX 23/12/2025: Type assertion segura seguindo padrão da plataforma (chat-service, rag-service)
  // includes() faz validação real em runtime, type assertion apenas informa TypeScript sobre tipos possíveis
  const getMediaType = (mimeType: string): 'image' | 'audio' | null => {
    const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
    if (acceptedTypes.image.includes(normalizedMimeType as typeof acceptedTypes.image[number])) return 'image';
    if (acceptedTypes.audio.includes(normalizedMimeType as typeof acceptedTypes.audio[number])) return 'audio';
    return null;
  };

  // Handler para drag & drop
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
    
    const files = Array.from(e.dataTransfer.files);
    addFilesToQueue(files);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    addFilesToQueue(files);
    e.target.value = ''; // Reset input para permitir re-seleção do mesmo arquivo
  };

  // Limites de arquivo por tipo de mídia (consistente com Chat e RAG service)
  // CORREÇÃO 23/12/2025: Removido limite fixo de 100MB (vídeo) - agora usa limites por tipo
  // BUG FIX 23/12/2025: Tipo explícito garante que todas as chaves de MediaType existam
  // Isso previne acesso a undefined e NaN em cálculos de limite
  // REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
  const FILE_LIMITS: Record<'image' | 'audio', number> = {
    image: 10 * 1024 * 1024,  // 10MB para imagens
    audio: 25 * 1024 * 1024,  // 25MB para áudio
  } as const;

  // Adicionar arquivos à fila de upload
  const addFilesToQueue = (files: File[]) => {
    const newUploads: MediaUpload[] = [];

    for (const file of files) {
      // Validar tipo primeiro (necessário para determinar limite)
      const mediaType = getMediaType(file.type);
      if (!mediaType) {
        toast({
          title: t('training.multimodal.errors.unsupportedType'),
          description: file.name,
          variant: 'destructive',
        });
        continue;
      }

      // BUG FIX 23/12/2025: Type narrowing explícito após validação para garantir type safety
      // TypeScript não faz narrowing automático após continue, então precisamos garantir que mediaType não é null
      // Após o early return acima, sabemos que mediaType é 'image' | 'audio', mas TypeScript não infere isso
      // Criar variável não-nullable para garantir type safety em todas as operações subsequentes
      const validatedMediaType: 'image' | 'audio' = mediaType;

      // Validar tamanho baseado no tipo de mídia
      // BUG FIX 23/12/2025: Usar validatedMediaType para garantir type safety
      const limit = FILE_LIMITS[validatedMediaType];
      if (!limit) {
        toast({
          title: t('training.multimodal.errors.unsupportedType'),
          description: `${file.name} - tipo de mídia não suportado: ${validatedMediaType}`,
          variant: 'destructive',
        });
        continue;
      }
      if (file.size > limit) {
        const limitMB = limit / (1024 * 1024);
        toast({
          title: t('training.multimodal.errors.fileTooLarge'),
          description: `${file.name} (máx ${limitMB}MB para ${validatedMediaType === 'image' ? 'imagens' : 'áudio'})`,
          variant: 'destructive',
        });
        continue;
      }

      newUploads.push({
        id: crypto.randomUUID(),
        file,
        type: validatedMediaType,
        progress: 0,
        status: 'pending',
      });
    }

    if (newUploads.length > 0) {
      setUploads(prev => [...prev, ...newUploads]);
    }
  };

  // Upload individual de arquivo
  const uploadFile = async (upload: MediaUpload) => {
    setUploads(prev => prev.map(u => 
      u.id === upload.id ? { ...u, status: 'uploading' as const, progress: 10 } : u
    ));

    try {
      const formData = new FormData();
      formData.append('file', upload.file);
      if (description) {
        formData.append('description', description);
      }
      if (namespaceId) {
        formData.append('namespaceId', namespaceId);
      }

      // Simular progresso durante upload (real progress seria via XHR)
      const progressInterval = setInterval(() => {
        setUploads(prev => prev.map(u => 
          u.id === upload.id && u.progress < 90 
            ? { ...u, progress: Math.min(90, u.progress + 10) } 
            : u
        ));
      }, 300);

      try {
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Erro ${response.status}`);
        }

        const result = await response.json() as MediaUploadResult;

        setUploads(prev => prev.map(u => 
          u.id === upload.id 
            ? { ...u, status: 'processing' as const, progress: 100, uploadId: result.id } 
            : u
        ));

        // Marcar como completado após pequeno delay (processamento assíncrono no backend)
        setTimeout(() => {
          setUploads(prev => prev.map(u => 
            u.id === upload.id ? { ...u, status: 'completed' as const } : u
          ));
          // Invalidar queries para atualizar lista de uploads
          queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
        }, 2000);

      } finally {
        // Sempre limpar interval (sucesso ou erro)
        clearInterval(progressInterval);
      }

    } catch (error) {
      frontendLogger.error('Erro ao fazer upload de mídia', {
        error: error instanceof Error ? error.message : String(error),
        fileName: upload.file.name,
        fileType: upload.file.type,
        fileSize: upload.file.size,
      });

      setUploads(prev => prev.map(u => 
        u.id === upload.id 
          ? { ...u, status: 'error' as const, error: error instanceof Error ? error.message : 'Erro desconhecido' } 
          : u
      ));
    }
  };

  // Upload de todos os arquivos pendentes
  const uploadAllPending = async () => {
    const pendingUploads = uploads.filter(u => u.status === 'pending');
    for (const upload of pendingUploads) {
      await uploadFile(upload);
    }
  };

  // Remover upload da fila
  const removeUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id));
  };

  // Limpar todos os completados
  const clearCompleted = () => {
    setUploads(prev => prev.filter(u => u.status !== 'completed'));
  };

  // Ícone baseado no tipo de mídia
  // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
  // BUG FIX 23/12/2025: Tipo restrito garante que apenas tipos válidos sejam aceitos
  // TypeScript garante type safety - não há necessidade de default case se tipo está correto
  // Mas mantemos default como proteção defensiva para casos extremos (type narrowing failure)
  const getMediaIcon = (type: 'image' | 'audio'): typeof ImageIcon | typeof FileAudio => {
    switch (type) {
      case 'image': return ImageIcon;
      case 'audio': return FileAudio;
      default: {
        // BUG FIX 23/12/2025: Log de erro para identificar type narrowing failures
        // Este caso nunca deveria ocorrer se type está correto, mas serve como proteção defensiva
        // REGRA 8: Usar frontendLogger estruturado ao invés de console.error
        frontendLogger.error('getMediaIcon recebeu tipo inesperado', { type });
        return FileAudio; // Fallback seguro para tipos inesperados
      }
    }
  };

  const pendingCount = uploads.filter(u => u.status === 'pending').length;
  const completedCount = uploads.filter(u => u.status === 'completed').length;

  return (
    <div className="flex-1 p-4 space-y-6">
      {/* Header com descrição */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            {t('training.multimodal.title')}
          </CardTitle>
          <CardDescription>
            {t('training.multimodal.subtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Descrição opcional para todos os uploads */}
          <div className="space-y-2">
            <Label htmlFor="media-description">{t('training.multimodal.descriptionLabel')}</Label>
            <Input
              id="media-description"
              placeholder={t('training.multimodal.descriptionPlaceholder')}
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Namespace opcional (Plano RAG Multimodal Enterprise Fase 2 - 11/02/2026) */}
          <div className="space-y-2">
            <Label htmlFor="media-namespace">{t('training.multimodal.namespaceLabel')}</Label>
            <Select value={namespaceId || '__none__'} onValueChange={(v) => setNamespaceId(v === '__none__' ? '' : v)}>
              <SelectTrigger id="media-namespace" data-testid="multimodal-namespace-select">
                <SelectValue placeholder={t('training.multimodal.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('training.multimodal.namespacePlaceholder')}</SelectItem>
                {namespaces.map((ns) => (
                  <SelectItem key={ns.id} value={ns.id}>
                    {ns.nome || ns.slug || ns.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('training.multimodal.namespaceHelp')}</p>
          </div>

          {/* Zona de Drop */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
              isDragging 
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : "border-muted-foreground/25 hover:border-primary hover:bg-muted/50"
            )}
            onClick={() => document.getElementById('multimodal-upload-input')?.click()}
          >
            <input
              id="multimodal-upload-input"
              type="file"
              accept={allAccepted}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />

            <div className="space-y-3">
              <div className="flex justify-center gap-4">
                <div className="p-3 rounded-full bg-blue-500/10">
                  <ImageIcon className="h-6 w-6 text-blue-500" />
                </div>
                <div className="p-3 rounded-full bg-green-500/10">
                  <Mic className="h-6 w-6 text-green-500" />
                </div>
                {/* REMOVIDO 23/12/2025: Vídeo desabilitado (muito pesado para GPU) */}
              </div>
              <div>
                <p className="font-medium">
                  {t('training.multimodal.dragDrop')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('training.multimodal.supportedTypes')}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Uploads */}
      {uploads.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {t('training.multimodal.queueTitle')}
              </CardTitle>
              <div className="flex gap-2">
                {completedCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearCompleted}>
                    {t('training.multimodal.clearCompleted')}
                  </Button>
                )}
                {pendingCount > 0 && (
                  <Button size="sm" onClick={uploadAllPending}>
                    <Upload className="h-4 w-4 mr-2" />
                    {t('training.multimodal.uploadAll', { count: pendingCount })}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {uploads.map((upload) => {
                  const MediaIcon = getMediaIcon(upload.type);
                  return (
                    <div
                      key={upload.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
                    >
                      <div className={cn(
                        "p-2 rounded-lg",
                        upload.type === 'image' && "bg-blue-500/10",
                        upload.type === 'audio' && "bg-green-500/10"
                      )}>
                        <MediaIcon className={cn(
                          "h-4 w-4",
                          upload.type === 'image' && "text-blue-500",
                          upload.type === 'audio' && "text-green-500"
                        )} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{upload.file.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</span>
                          <span>•</span>
                          <span className="capitalize">{upload.type}</span>
                        </div>
                        {(upload.status === 'uploading' || upload.status === 'processing') && (
                          <Progress value={upload.progress} className="h-1 mt-2" />
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {upload.status === 'pending' && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                            <Clock className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.pending')}
                          </Badge>
                        )}
                        {upload.status === 'uploading' && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {t('training.multimodal.status.uploading')}
                          </Badge>
                        )}
                        {upload.status === 'processing' && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {t('training.multimodal.status.processing')}
                          </Badge>
                        )}
                        {upload.status === 'completed' && (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.completed')}
                          </Badge>
                        )}
                        {upload.status === 'error' && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.error')}
                          </Badge>
                        )}
                        
                        {(upload.status === 'pending' || upload.status === 'error') && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => removeUpload(upload.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Lista de documentos RAG com promoção explícita para treinamento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Folder className="h-4 w-4 text-primary" />
                Documentos da RAG
              </CardTitle>
              <CardDescription>
                RAG e Treinamento são separados. A promoção para dataset de treinamento é explícita e auditável por documento.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchRagDocuments()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingRagDocuments ? (
            <Skeleton className="h-24" />
          ) : ragDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento RAG encontrado.</p>
          ) : (
            <div className="space-y-3">
              {ragDocuments.map((doc) => {
                const canPromote = doc.processado && Boolean(doc.namespaceId) && !doc.sentToTrainingAt;
                const isPromoting = promotingDocumentId === doc.id && promoteDocumentToTraining.isPending;

                return (
                  <div key={doc.id} className="rounded-lg border p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.titulo}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{doc.tipo ?? 'documento'}</Badge>
                        <Badge variant={doc.processado ? 'default' : 'secondary'}>
                          {doc.processado ? 'processado' : 'processando'}
                        </Badge>
                        {!doc.namespaceId && (
                          <Badge variant="destructive">sem namespace</Badge>
                        )}
                        {doc.sentToTrainingAt && (
                          <Badge variant="default" className="bg-green-500/10 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            enviado para treinamento
                          </Badge>
                        )}
                        <span>Atualizado em {formatDate(doc.atualizadoEm)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`book-mode-${doc.id}`}
                          checked={bookModeByDocument[doc.id] ?? false}
                          onCheckedChange={(checked) =>
                            setBookModeByDocument((prev) => ({ ...prev, [doc.id]: checked }))
                          }
                        />
                        <Label htmlFor={`book-mode-${doc.id}`} className="text-xs cursor-pointer">
                          {t('training.promoteDocument.bookMode')}
                        </Label>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canPromote || isPromoting}
                        onClick={() => {
                          const maxSamples = (bookModeByDocument[doc.id] ?? false) ? 100 : undefined;
                          setSelectedDocumentForTraining({
                            documentId: doc.id,
                            maxSamples,
                          });
                          setDocumentTrainingNamespaceId(doc.namespaceId ?? '');
                          setDocumentTrainingDialogOpen(true);
                        }}
                      >
                      {isPromoting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          Enviar para Treinamento
                        </>
                      )}
                    </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mídia Processada - Promoção para treinamento (Plano RAG Multimodal Fase 4) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                {t('training.multimodal.mediaProcessed.title')}
              </CardTitle>
              <CardDescription>
                {t('training.multimodal.mediaProcessed.subtitle')}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchMediaUploads()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingMediaUploads ? (
            <Skeleton className="h-24" />
          ) : mediaUploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('training.multimodal.mediaProcessed.empty')}</p>
          ) : (
            <div className="space-y-3">
              {mediaUploads.map((media) => {
                const canPromote = Boolean(media.namespaceId) && !media.approvedForTraining;
                const hasContent = (media.mediaType === 'image' && media.llmDescription) || (media.mediaType === 'audio' && media.transcription);
                const isPromoting = promotingMediaId === media.id && promoteMediaToTraining.isPending;

                return (
                  <div key={media.id} className="rounded-lg border p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 min-w-0 flex items-center gap-3">
                      <div className={cn(
                        'p-2 rounded-lg shrink-0',
                        media.mediaType === 'image' && 'bg-blue-500/10',
                        media.mediaType === 'audio' && 'bg-green-500/10'
                      )}>
                        {media.mediaType === 'image' ? (
                          <ImageIcon className="h-4 w-4 text-blue-500" />
                        ) : (
                          <FileAudio className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium truncate">{media.originalFilename}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{media.mediaType}</Badge>
                          {media.approvedForTraining && (
                            <Badge variant="default" className="bg-green-500/10 text-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {t('training.multimodal.mediaProcessed.sent')}
                            </Badge>
                          )}
                          {!media.namespaceId && (
                            <Badge variant="destructive">{t('training.multimodal.mediaProcessed.noNamespace')}</Badge>
                          )}
                          <span>{formatDate(media.criadoEm)}</span>
                        </div>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canPromote || !hasContent || isPromoting}
                      onClick={() => {
                        setSelectedMediaForTraining(media.id);
                        setMediaTrainingNamespaceId(media.namespaceId ?? '');
                        setMediaTrainingDialogOpen(true);
                      }}
                    >
                      {isPromoting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('training.multimodal.mediaProcessed.sending')}
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          {t('training.multimodal.mediaProcessed.sendToTraining')}
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={documentTrainingDialogOpen}
        onOpenChange={(open) => {
          setDocumentTrainingDialogOpen(open);
          if (!open) {
            setSelectedDocumentForTraining(null);
            setDocumentTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar documento para treinamento</DialogTitle>
            <DialogDescription>
              Selecione o namespace de destino para gerar o dataset do documento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Select value={documentTrainingNamespaceId} onValueChange={setDocumentTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentTrainingDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!selectedDocumentForTraining || !documentTrainingNamespaceId || promoteDocumentToTraining.isPending}
              onClick={() => {
                if (!selectedDocumentForTraining || !documentTrainingNamespaceId) {
                  toast({ title: 'Namespace obrigatório', variant: 'destructive' });
                  return;
                }
                promoteDocumentToTraining.mutate({
                  documentId: selectedDocumentForTraining.documentId,
                  maxSamples: selectedDocumentForTraining.maxSamples,
                  namespaceId: documentTrainingNamespaceId,
                });
              }}
            >
              {promoteDocumentToTraining.isPending ? (
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

      <Dialog
        open={mediaTrainingDialogOpen}
        onOpenChange={(open) => {
          setMediaTrainingDialogOpen(open);
          if (!open) {
            setSelectedMediaForTraining(null);
            setMediaTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar mídia para treinamento</DialogTitle>
            <DialogDescription>
              Selecione o namespace de destino para gerar o dataset da mídia.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Select value={mediaTrainingNamespaceId} onValueChange={setMediaTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMediaTrainingDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!selectedMediaForTraining || !mediaTrainingNamespaceId || promoteMediaToTraining.isPending}
              onClick={() => {
                if (!selectedMediaForTraining || !mediaTrainingNamespaceId) {
                  toast({ title: 'Namespace obrigatório', variant: 'destructive' });
                  return;
                }
                promoteMediaToTraining.mutate({
                  mediaUploadId: selectedMediaForTraining,
                  namespaceId: mediaTrainingNamespaceId,
                });
              }}
            >
              {promoteMediaToTraining.isPending ? (
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

      {/* Informações sobre processamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            {t('training.multimodal.info.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-5 w-5 text-blue-500" />
                <p className="font-medium text-blue-600">{t('training.multimodal.info.images.title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('training.multimodal.info.images.desc')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                JPEG, PNG, WebP, GIF (máx 10MB)
              </p>
            </div>
            
            <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Mic className="h-5 w-5 text-green-500" />
                <p className="font-medium text-green-600">{t('training.multimodal.info.audio.title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('training.multimodal.info.audio.desc')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                MP3, WAV, WebM, OGG, M4A (máx 25MB)
              </p>
            </div>
            
            {/* REMOVIDO 23/12/2025: Seção de vídeo desabilitada (muito pesado para GPU) */}
          </div>

          <Alert>
            <Zap className="h-4 w-4" />
            <AlertTitle>{t('training.multimodal.info.gpu.title')}</AlertTitle>
            <AlertDescription>
              {t('training.multimodal.info.gpu.desc')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

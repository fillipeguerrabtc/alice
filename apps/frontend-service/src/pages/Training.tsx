/**
 * Training - Gestão de Fine-tuning
 * 
 * Página para gerenciar dados de treinamento e jobs de fine-tuning
 * na Salad Cloud para o modelo Mixtral 8x7B.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { z } from 'zod';
import {
  Brain,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  RefreshCw,
  MessageSquare,
  Database,
  Zap,
  ChevronRight,
  Filter,
  TrendingUp,
  Upload,
  FileJson,
  Info,
  FileCheck,
  AlertTriangle,
  Eye,
  Image,
  Mic,
  X,
  FileAudio,
  ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';

interface TrainingData {
  id: string;
  source: string;
  messages: Array<{ role: string; content: string }>;
  rating: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'used';
  isDuplicate: boolean;
  similarityScore: number | null;
  criadoEm: string;
}

interface FineTuningJob {
  id: string;
  name: string;
  baseModel: string;
  status: 'pending' | 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  trainingDataCount: number;
  hyperparameters: {
    epochs: number;
    learningRate: number;
    batchSize: number;
  };
  progress: number | null;
  metrics: Record<string, number> | null;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  criadoEm: string;
}

interface TrainingDataResponse {
  trainingData: TrainingData[];
}

interface JobsResponse {
  jobs: FineTuningJob[];
}

interface BulkImportEntry {
  messages: Array<{ role: string; content: string }>;
  rating?: number;
}

interface BulkImportData {
  data?: BulkImportEntry[];
  // JSONL é parseado linha por linha para array
}

interface BulkImportResult {
  imported: number;
  duplicates: number;
  errors: Array<{ index: number; error: string }>;
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
} as const;

function getStatusBadge(status: TrainingData['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.pending')}</Badge>;
    case 'approved':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.approved')}</Badge>;
    case 'rejected':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600"><XCircle className="h-3 w-3 mr-1" />{t('training.status.rejected')}</Badge>;
    case 'used':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600"><Zap className="h-3 w-3 mr-1" />{t('training.status.used')}</Badge>;
    default:
      return null;
  }
}

function getJobStatusBadge(status: FineTuningJob['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.queued')}</Badge>;
    case 'preparing':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />{t('training.status.preparing')}</Badge>;
    case 'running':
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-600"><Play className="h-3 w-3 mr-1" />{t('training.status.running')}</Badge>;
    case 'completed':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.completed')}</Badge>;
    case 'failed':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600"><AlertCircle className="h-3 w-3 mr-1" />{t('training.status.failed')}</Badge>;
    case 'cancelled':
      return <Badge variant="outline" className="bg-gray-500/10 text-gray-600"><Pause className="h-3 w-3 mr-1" />{t('training.status.cancelled')}</Badge>;
    default:
      return null;
  }
}

function TrainingDataCard({ data, onApprove, onReject, isPending, t }: { 
  data: TrainingData; 
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{data.source}</span>
            </div>
            {getStatusBadge(data.status, t)}
          </div>
          <CardDescription className="text-xs">
            {new Date(data.criadoEm).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
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
                  msg.role === 'user' ? 'bg-muted' : 'bg-primary/5'
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
          </div>
        </CardContent>

        {data.status === 'pending' && (
          <CardFooter className="pt-2 gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 text-green-600"
              onClick={onApprove}
              disabled={isPending}
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
          </CardFooter>
        )}
      </Card>
    </motion.div>
  );
}

function JobCard({ job, t }: { job: FineTuningJob; t: (key: string, options?: Record<string, unknown>) => string }) {
  const hyperparameters = job.hyperparameters || { epochs: 3, learningRate: 0.0001, batchSize: 4 };
  
  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{job.name}</CardTitle>
            </div>
            {getJobStatusBadge(job.status, t)}
          </div>
          <CardDescription>
            {t('training.job.baseModel', { model: job.baseModel, count: job.trainingDataCount })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {(job.status === 'running' || job.status === 'preparing') && job.progress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('training.job.progress')}</span>
                <span>{job.progress}%</span>
              </div>
              <Progress value={job.progress} className="h-2" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters.epochs}</div>
              <div className="text-muted-foreground">{t('training.job.epochs')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters.batchSize}</div>
              <div className="text-muted-foreground">{t('training.job.batch')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters.learningRate}</div>
              <div className="text-muted-foreground">{t('training.job.lr')}</div>
            </div>
          </div>

          {job.metrics && Object.keys(job.metrics).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(job.metrics).map(([key, value]) => (
                <Badge key={key} variant="secondary" className="text-xs">
                  {key}: {typeof value === 'number' ? value.toFixed(4) : value}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-2 text-xs text-muted-foreground">
          <div className="flex justify-between w-full">
            <span>{t('training.job.created', { date: new Date(job.criadoEm).toLocaleDateString('pt-BR') })}</span>
            {job.finalizadoEm && (
              <span>{t('training.job.finished', { date: new Date(job.finalizadoEm).toLocaleDateString('pt-BR') })}</span>
            )}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function CreateJobDialog({ open, onClose, approvedCount, t }: { 
  open: boolean; 
  onClose: () => void;
  approvedCount: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [epochs, setEpochs] = useState(3);
  const [batchSize, setBatchSize] = useState(4);
  const [learningRate, setLearningRate] = useState(0.0001);

  const createJob = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/training/jobs', {
        name,
        hyperparameters: { epochs, batchSize, learningRate },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: t('training.success.jobCreated') });
      onClose();
      setName('');
    },
    onError: () => {
      toast({ title: t('training.errors.createJob'), variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {t('training.createJob.title')}
          </DialogTitle>
          <DialogDescription>
            {t('training.createJob.description')}
            {approvedCount < 10 && (
              <span className="block mt-2 text-amber-600">
                {t('training.createJob.minDataWarning', { count: approvedCount })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('training.createJob.nameLabel')}</Label>
            <Input
              id="name"
              placeholder={t('training.createJob.namePlaceholder')}
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              data-testid="input-job-name"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="epochs">{t('training.createJob.epochs')}</Label>
              <Input
                id="epochs"
                type="number"
                min={1}
                max={10}
                value={epochs}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEpochs(Number(e.target.value))}
                data-testid="input-epochs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batchSize">{t('training.createJob.batchSize')}</Label>
              <Input
                id="batchSize"
                type="number"
                min={1}
                max={32}
                value={batchSize}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBatchSize(Number(e.target.value))}
                data-testid="input-batch-size"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lr">{t('training.createJob.learningRate')}</Label>
              <Input
                id="lr"
                type="number"
                step={0.00001}
                min={0.00001}
                max={0.01}
                value={learningRate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLearningRate(Number(e.target.value))}
                data-testid="input-learning-rate"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              <span>{t('training.createJob.approvedData', { count: approvedCount })}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-job">
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={() => createJob.mutate()}
            disabled={!name || approvedCount < 10 || createJob.isPending}
            data-testid="button-create-job"
          >
            {createJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {t('training.createJob.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// COMPONENTE: MultimodalUploadTab - Upload de mídia multimodal para RAG
// ARQUITETURA 100% GPU (15/12/2025):
// - Imagens: OpenCLIP ViT-H/14 embeddings (1024 dim)
// - Áudios: Whisper large-v3 transcrição + Qwen3-Embedding-8B embeddings (4096 dim)
// - Vídeos: Frames OpenCLIP + transcrição Qwen3-Embedding-8B
// REGRA 8: TypeScript strict, zero any
// REGRA 16: Validação client-side, error handling, UX feedback
// ============================================================================

// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
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

function MultimodalUploadTab({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<MediaUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [description, setDescription] = useState('');

  // Tipos de arquivo aceitos para cada categoria
  // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
  const acceptedTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'],
  };

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
  const getMediaType = (mimeType: string): 'image' | 'audio' | null => {
    const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
    if (acceptedTypes.image.includes(normalizedMimeType)) return 'image';
    if (acceptedTypes.audio.includes(normalizedMimeType)) return 'audio';
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

// ============================================================================
// COMPONENTE: BulkImportTab - Upload em massa de dados de treinamento
// REGRA 8: TypeScript strict, zero any, validação Zod enterprise
// REGRA 16: Validação client-side, error handling, UX feedback
// ============================================================================
function BulkImportTab({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<BulkImportEntry[]>([]);
  const [source, setSource] = useState('bulk-import');
  const [autoApprove, setAutoApprove] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Schema Zod para validação enterprise (Regra 8)
  const BulkImportEntrySchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1),
      })
    ).min(1),
    rating: z.number().int().min(1).max(5).optional(),
  });

  const BulkImportSchema = z.array(BulkImportEntrySchema).max(1000);

  const bulkImport = useMutation({
    mutationFn: async (): Promise<BulkImportResult> => {
      // REGRA 8: apiRequest retorna Response, precisa fazer .json() para parsear
      // Segue padrão usado em Namespaces.tsx, Agents.tsx, BackupAdmin.tsx
      const res = await apiRequest('POST', '/api/training/bulk-import', {
        data: parsedData,
        source: source || 'bulk-import',
        autoApprove,
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ 
        title: t('training.bulkImport.success.fullSuccess', { 
          imported: result.imported,
          duplicates: result.duplicates,
        }),
      });
      // Limpar formulário após sucesso
      setFile(null);
      setParsedData([]);
      setSource('bulk-import');
      setAutoApprove(false);
    },
    onError: (error) => {
      // REGRA 8: Logger estruturado enviado para observability stack
      frontendLogger.error('Erro ao importar dados de treinamento em massa', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        source,
        autoApprove,
        entriesCount: parsedData.length,
      });
      toast({ 
        title: t('training.bulkImport.errors.importFailed'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    },
  });

  // Handler para drag & drop (UX enterprise - Regra 16)
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
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  // Validação e parse do arquivo (Enterprise error handling - Regra 8)
  const handleFileSelect = async (selectedFile: File) => {
    setValidationError(null);
    setParsedData([]);

    // BUG FIX 23/12/2025: Validação de tamanho RESTAURADA - necessário para segurança e DoS prevention
    // Backend limita payload JSON a 10MB (express.json({ limit: '10mb' }))
    // Validação frontend previne upload de arquivos grandes e dá feedback imediato ao usuário
    // Consistente com limite do backend para evitar tentativas de upload que falhariam
    // Previne memory exhaustion quando arquivo é parseado com selectedFile.text()
    const BULK_IMPORT_MAX_SIZE = 10 * 1024 * 1024; // 10MB - mesmo limite do backend
    if (selectedFile.size > BULK_IMPORT_MAX_SIZE) {
      setValidationError(t('training.bulkImport.validation.fileTooLargeDesc'));
      return;
    }

    // Validação 2: Extensão do arquivo
    const validExtensions = ['.json', '.jsonl'];
    const fileExtension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExtension)) {
      setValidationError(t('training.bulkImport.validation.invalidFormatDesc'));
      return;
    }

    try {
      const text = await selectedFile.text();
      let entries: BulkImportEntry[] = [];

      // Parse JSON ou JSONL
      // REGRA 8: Error handling enterprise com logging estruturado e feedback detalhado
      if (fileExtension === '.json') {
        const parsed = JSON.parse(text) as BulkImportData;
        entries = parsed.data || (Array.isArray(parsed) ? parsed : []);
      } else if (fileExtension === '.jsonl') {
        const lines = text.split('\n');
        const parsedEntries: BulkImportEntry[] = [];
        const errors: Array<{ lineNumber: number; error: string }> = [];
        
        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return; // Ignorar linhas vazias
          
          const lineNumber = index + 1; // Linhas começam em 1 para usuário
          try {
            const parsed = JSON.parse(trimmedLine) as BulkImportEntry;
            parsedEntries.push(parsed);
          } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            errors.push({ lineNumber, error: errorMessage });
            
            // REGRA 8: Logger estruturado para observability stack
            frontendLogger.error('Erro ao fazer parse de linha JSONL', {
              lineNumber,
              lineContent: trimmedLine.substring(0, 100), // Primeiros 100 chars para não logar dados sensíveis
              error: errorMessage,
              fileName: selectedFile.name,
            });
          }
        });
        
        // Se houver erros, mostrar feedback detalhado ao usuário
        if (errors.length > 0) {
          const firstError = errors[0];
          setValidationError(
            t('training.bulkImport.errors.jsonlParseErrorDesc', {
              lineNumber: firstError.lineNumber,
              error: firstError.error,
            })
          );
          
          // Log completo para observability
          frontendLogger.error('Falha ao processar arquivo JSONL - múltiplas linhas com erro', {
            totalErrors: errors.length,
            errors: errors.map(e => ({ line: e.lineNumber, error: e.error })),
            fileName: selectedFile.name,
            totalLines: lines.length,
            successfulParses: parsedEntries.length,
          });
          
          return;
        }
        
        entries = parsedEntries;
      }

      // Validação 3: Máximo 1000 entradas
      if (entries.length > 1000) {
        setValidationError(t('training.bulkImport.validation.tooManyEntriesDesc'));
        return;
      }

      // Validação 4: Schema Zod
      const validationResult = BulkImportSchema.safeParse(entries);
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        setValidationError(firstError?.message || t('training.bulkImport.validation.missingMessagesDesc'));
        return;
      }

      // Sucesso - salvar dados parseados
      setFile(selectedFile);
      setParsedData(entries);
    } catch (error) {
      // REGRA 8: Logger estruturado enviado para observability stack
      frontendLogger.error('Erro ao fazer parse do arquivo de bulk import', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      });
      setValidationError(t('training.bulkImport.errors.parseError'));
    }
  };

  const handleClearFile = () => {
    setFile(null);
    setParsedData([]);
    setValidationError(null);
  };

  return (
    <div className="flex-1 p-4 space-y-6">
      {/* Zona de Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t('training.bulkImport.title')}
          </CardTitle>
          <CardDescription>
            {t('training.bulkImport.subtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
              isDragging 
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : file 
                  ? "border-green-500 bg-green-500/5"
                  : "border-muted-foreground/25 hover:border-primary hover:bg-muted/50"
            )}
            onClick={() => document.getElementById('bulk-import-file')?.click()}
          >
            <input
              id="bulk-import-file"
              type="file"
              accept=".json,.jsonl"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {file ? (
              <div className="space-y-2">
                <FileCheck className="h-12 w-12 text-green-500 mx-auto" />
                <div>
                  <p className="font-medium text-green-600">
                    {t('training.bulkImport.fileSelected')}
                  </p>
                  <p className="text-sm text-muted-foreground">{file.name}</p>
                  <Badge variant="outline" className="mt-2 bg-green-500/10 text-green-600">
                    {t('training.bulkImport.entries', { count: parsedData.length })}
                  </Badge>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearFile();
                  }}
                  className="mt-2"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <FileJson className={cn(
                  "h-12 w-12 mx-auto transition-colors",
                  isDragging ? "text-primary" : "text-muted-foreground/50"
                )} />
                <div>
                  <p className="font-medium">
                    {t('training.bulkImport.dragDrop')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('training.bulkImport.or')} {t('training.bulkImport.browse')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('training.bulkImport.supportedFormats')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Erro de Validação */}
          {validationError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('training.bulkImport.validation.invalidFormat')}</AlertTitle>
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Configurações de Import */}
          {parsedData.length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="import-source">{t('training.bulkImport.source')}</Label>
                <Input
                  id="import-source"
                  placeholder={t('training.bulkImport.sourcePlaceholder')}
                  value={source}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)}
                  maxLength={50}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-approve" className="font-medium">
                    {t('training.bulkImport.autoApprove')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('training.bulkImport.autoApproveDesc')}
                  </p>
                </div>
                <Switch
                  id="auto-approve"
                  checked={autoApprove}
                  onCheckedChange={setAutoApprove}
                />
              </div>
            </div>
          )}
        </CardContent>

        {parsedData.length > 0 && (
          <CardFooter className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={handleClearFile}
              disabled={bulkImport.isPending}
            >
              {t('training.bulkImport.cancel')}
            </Button>
            <Button 
              onClick={() => bulkImport.mutate()}
              disabled={bulkImport.isPending || parsedData.length === 0}
            >
              {bulkImport.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('training.bulkImport.importing')}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  {t('training.bulkImport.import', { count: parsedData.length })}
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Preview dos Dados */}
      {parsedData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              {t('training.bulkImport.preview')}
            </CardTitle>
            <CardDescription>
              {t('training.bulkImport.showingFirst', { 
                count: Math.min(5, parsedData.length),
                total: parsedData.length 
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {parsedData.slice(0, 5).map((entry, idx) => (
                  <Card key={idx} className="bg-muted/30">
                    <CardContent className="p-3 space-y-2">
                      {entry.messages.map((msg, msgIdx) => (
                        <div 
                          key={msgIdx}
                          className={cn(
                            'text-xs p-2 rounded',
                            msg.role === 'user' ? 'bg-background' : 'bg-primary/5'
                          )}
                        >
                          <span className="font-medium capitalize">{msg.role}:</span>{' '}
                          <span className="text-muted-foreground">
                            {msg.content.slice(0, 200)}
                            {msg.content.length > 200 ? '...' : ''}
                          </span>
                        </div>
                      ))}
                      {entry.rating && (
                        <Badge variant="secondary" className="text-xs">
                          Rating: {entry.rating}/5
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {parsedData.length > 5 && (
                  <p className="text-center text-sm text-muted-foreground">
                    +{parsedData.length - 5} {t('training.bulkImport.entries', { count: parsedData.length - 5 })}
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Ajuda - Formato do Arquivo */}
      {parsedData.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              {t('training.bulkImport.help.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">
                {t('training.bulkImport.help.jsonExample')}
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{
  "data": [
    {
      "messages": [
        {"role": "user", "content": "Como funciona X?"},
        {"role": "assistant", "content": "X funciona..."}
      ],
      "rating": 5
    }
  ]
}`}
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                {t('training.bulkImport.help.jsonlExample')}
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{"messages": [{"role": "user", "content": "Pergunta 1"}, {"role": "assistant", "content": "Resposta 1"}], "rating": 5}
{"messages": [{"role": "user", "content": "Pergunta 2"}, {"role": "assistant", "content": "Resposta 2"}], "rating": 4}`}
              </pre>
            </div>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium mb-1">
                  {t('training.bulkImport.help.requiredFields')}
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>{t('training.bulkImport.help.messagesField')}</li>
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">
                  {t('training.bulkImport.help.optionalFields')}
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>{t('training.bulkImport.help.ratingField')}</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function Training() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateJob, setShowCreateJob] = useState(false);

  const { data: trainingData, isLoading: dataLoading } = useQuery<TrainingDataResponse>({
    queryKey: ['/api/training/data'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobsResponse>({
    queryKey: ['/api/training/jobs'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest('PATCH', `/api/training/data/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: t('training.success.statusUpdated') });
    },
    onError: () => {
      toast({ title: t('training.errors.updateStatus'), variant: 'destructive' });
    },
  });

  const allData = trainingData?.trainingData || [];
  const allJobs = jobs?.jobs || [];

  const filteredData = statusFilter === 'all' 
    ? allData 
    : allData.filter(d => d.status === statusFilter);

  const stats = {
    total: allData.length,
    pending: allData.filter(d => d.status === 'pending').length,
    approved: allData.filter(d => d.status === 'approved').length,
    rejected: allData.filter(d => d.status === 'rejected').length,
    used: allData.filter(d => d.status === 'used').length,
  };

  const jobStats = {
    total: allJobs.length,
    running: allJobs.filter(j => j.status === 'running' || j.status === 'preparing').length,
    completed: allJobs.filter(j => j.status === 'completed').length,
    failed: allJobs.filter(j => j.status === 'failed').length,
  };

  return (
    <div className="flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 border-b bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-training-title">
              {t('training.title')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('training.subtitle')}
            </p>
          </div>

          <Button onClick={() => setShowCreateJob(true)} data-testid="button-new-job">
            <Brain className="h-4 w-4 mr-2" />
            {t('training.newJob')}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.pending')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-pending">{stats.pending}</p>
                </div>
                <Clock className="h-8 w-8 text-amber-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.approved')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-approved">{stats.approved}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.activeJobs')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-running">{jobStats.running}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-purple-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.completed')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-completed">{jobStats.completed}</p>
                </div>
                <Zap className="h-8 w-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <Tabs defaultValue="data" className="flex-1 flex flex-col">
        <div className="px-4 pt-2 border-b">
          <TabsList>
            <TabsTrigger value="data" data-testid="tab-training-data">
              <Database className="h-4 w-4 mr-2" />
              {t('training.tabs.data', { count: stats.total })}
            </TabsTrigger>
            <TabsTrigger value="jobs" data-testid="tab-jobs">
              <Brain className="h-4 w-4 mr-2" />
              {t('training.tabs.jobs', { count: allJobs.length })}
            </TabsTrigger>
            <TabsTrigger value="bulk-import" data-testid="tab-bulk-import">
              <Upload className="h-4 w-4 mr-2" />
              {t('training.bulkImport.title')}
            </TabsTrigger>
            <TabsTrigger value="multimodal" data-testid="tab-multimodal">
              <Image className="h-4 w-4 mr-2" />
              {t('training.multimodal.tabTitle')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="data" className="flex-1 m-0">
          <div className="p-4 border-b flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('training.filter.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('training.filter.all')}</SelectItem>
                <SelectItem value="pending">{t('training.filter.pending')}</SelectItem>
                <SelectItem value="approved">{t('training.filter.approved')}</SelectItem>
                <SelectItem value="rejected">{t('training.filter.rejected')}</SelectItem>
                <SelectItem value="used">{t('training.filter.used')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {t('training.filter.results', { count: filteredData.length })}
            </span>
          </div>

          <ScrollArea className="flex-1 p-4">
            {dataLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : filteredData.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 text-center"
              >
                <Database className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-1">{t('training.empty.noData')}</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('training.empty.noDataDesc')}
                </p>
              </motion.div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
              >
                {filteredData.map((data) => (
                  <TrainingDataCard
                    key={data.id}
                    data={data}
                    isPending={updateStatus.isPending}
                    onApprove={() => updateStatus.mutate({ id: data.id, status: 'approved' })}
                    onReject={() => updateStatus.mutate({ id: data.id, status: 'rejected' })}
                    t={t}
                  />
                ))}
              </motion.div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="jobs" className="flex-1 m-0">
          <ScrollArea className="flex-1 p-4">
            {jobsLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : allJobs.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 text-center"
              >
                <Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-1">{t('training.empty.noJobs')}</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('training.empty.noJobsDesc')}
                </p>
                <Button 
                  className="mt-4" 
                  onClick={() => setShowCreateJob(true)}
                  disabled={stats.approved < 10}
                  data-testid="button-create-first-job"
                >
                  <Brain className="h-4 w-4 mr-2" />
                  {t('training.empty.createFirstJob')}
                </Button>
              </motion.div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-4 md:grid-cols-2"
              >
                {allJobs.map((job) => (
                  <JobCard key={job.id} job={job} t={t} />
                ))}
              </motion.div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="bulk-import" className="flex-1 m-0">
          <BulkImportTab t={t} />
        </TabsContent>

        <TabsContent value="multimodal" className="flex-1 m-0">
          <MultimodalUploadTab t={t} />
        </TabsContent>
      </Tabs>

      <CreateJobDialog
        open={showCreateJob}
        onClose={() => setShowCreateJob(false)}
        approvedCount={stats.approved}
        t={t}
      />
    </div>
  );
}

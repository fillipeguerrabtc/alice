/**
 * Painel de Backup & Restore - Alice Enterprise Platform
 * 
 * Dashboard administrativo unificado para backup e restore de toda a plataforma.
 * Integra com o Backup Orchestrator do observability-service.
 * 
 * Funcionalidades:
 * - Backup Full/Incremental com um clique
 * - Restore com seleção de ponto no tempo
 * - Histórico de backups com manifestos
 * - Status em tempo real durante operações
 * 
 * AMBIENTES:
 * - Desenvolvimento (Cursor IDE): Dados de preview via server/index-dev.ts
 * - Produção (Hetzner): API real via observability-service
 * 
 * Regra 8 - TypeScript strict
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  HardDrive,
  Database,
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Play,
  History,
  Shield,
  Server,
  FileJson,
  Loader2,
  Archive,
  RotateCcw,
  Calendar,
  Settings,
  Bell,
  Save,
  Trash2,
  Eraser,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface ComponentStatus {
  status: 'completed' | 'failed' | 'skipped';
  lsn?: string;
  backupSet?: string;
  gtid?: string;
  binlogPosition?: string;
  rdbChecksum?: string;
  filesCount?: number;
  size?: string;
}

/**
 * Interface do manifesto de backup
 * ATUALIZADO: 05/12/2025 - Migrado de offsite/S3 para storage local (Volume Hetzner)
 * Alinhado com BackupManifestData em packages/shared/src/schema.ts
 */
interface BackupManifest {
  id: string;
  type: 'full' | 'incremental' | 'differential';
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number;
  totalSize?: string;
  components: {
    postgresql?: ComponentStatus;
    mariadb?: ComponentStatus;
    redis?: ComponentStatus;
  };
  storage: {
    type: 'local';
    path: string;
    volumeName: string;
  };
  encryption: {
    enabled: boolean;
    algorithm?: string;
  };
  createdBy?: string;
  notes?: string;
}

interface BackupJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'idle';
  progress: number;
  currentComponent?: string;
  components: Array<{
    component: string;
    status: string;
    durationSeconds?: number;
  }>;
  manifest?: BackupManifest;
  startedAt?: string;
  message?: string;
}

interface BackupHistory {
  manifests: BackupManifest[];
  totalCount: number;
  lastSuccessful?: BackupManifest;
  lastFailed?: BackupManifest;
}

/**
 * Interface de configuração de agendamento de backup
 * ATUALIZADO: 05/12/2025 - Migrado de offsite para storage local (Volume Hetzner)
 */
interface BackupSchedule {
  enabled: boolean;
  fullBackup: {
    enabled: boolean;
    cronExpression: string;
    description: string;
  };
  incrementalBackup: {
    enabled: boolean;
    cronExpression: string;
    description: string;
  };
  retention: {
    fullBackupDays: number;
    incrementalBackupDays: number;
    archiveDays: number;
  };
  storage: {
    type: 'local';
    path: string;
    volumeName: string;
  };
  notifications: {
    onSuccess: boolean;
    onFailure: boolean;
    webhookUrl?: string;
  };
  lastModified: string;
  modifiedBy?: string;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" data-testid="icon-status-completed" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" data-testid="icon-status-failed" />;
    case 'partial':
      return <AlertCircle className="h-5 w-5 text-yellow-500" data-testid="icon-status-partial" />;
    case 'running':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" data-testid="icon-status-running" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" data-testid="icon-status-unknown" />;
  }
}

function ComponentIcon({ component }: { component: string }) {
  switch (component) {
    case 'postgresql':
      return <Database className="h-4 w-4" />;
    case 'mariadb':
      return <Server className="h-4 w-4" />;
    case 'redis':
      return <HardDrive className="h-4 w-4" />;
    case 'uploads':
      return <Upload className="h-4 w-4" />;
    default:
      return <Archive className="h-4 w-4" />;
  }
}

export default function BackupAdmin() {
  useTranslation();
  const { toast } = useToast();
  const [backupType, setBackupType] = useState<'full' | 'incremental'>('full');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [showManifestDialog, setShowManifestDialog] = useState(false);
  const [selectedManifest, setSelectedManifest] = useState<BackupManifest | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<Partial<BackupSchedule>>({});

  const { data: jobStatus, isLoading: isLoadingStatus } = useQuery<BackupJobStatus>({
    queryKey: ['/api/backup/status'],
    refetchInterval: (query) => {
      const data = query.state.data as BackupJobStatus | undefined;
      return data?.status === 'running' ? 2000 : 10000;
    },
  });

  const { data: history, isLoading: isLoadingHistory } = useQuery<BackupHistory>({
    queryKey: ['/api/backup/history'],
    refetchInterval: 30000,
  });

  const { data: schedule, isLoading: isLoadingSchedule } = useQuery<BackupSchedule>({
    queryKey: ['/api/backup/schedule'],
  });

  const runBackupMutation = useMutation({
    mutationFn: async (type: 'full' | 'incremental') => {
      return apiRequest('POST', '/api/backup/run', { type });
    },
    onSuccess: () => {
      toast({
        title: 'Backup iniciado',
        description: `Backup ${backupType} iniciado com sucesso.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/backup/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/backup/history'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao iniciar backup',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest('POST', '/api/backup/restore', { backupId, confirm: true });
    },
    onSuccess: () => {
      toast({
        title: 'Restore concluído',
        description: 'Todos os componentes foram restaurados com sucesso.',
      });
      setShowRestoreDialog(false);
      setShowConfirmRestore(false);
      queryClient.invalidateQueries({ queryKey: ['/api/backup/status'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao restaurar',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest('POST', `/api/backup/verify/${backupId}`);
    },
    onSuccess: () => {
      toast({
        title: 'Verificação concluída',
        description: 'Integridade do backup confirmada.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro na verificação',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest('DELETE', `/api/backup/${backupId}?confirm=true`);
    },
    onSuccess: () => {
      toast({
        title: 'Backup excluído',
        description: 'Manifesto do backup excluído com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/backup/history'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao excluir',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async (): Promise<{ deletedManifests: number }> => {
      const res = await apiRequest('POST', '/api/backup/cleanup');
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Limpeza concluída',
        description: `${data.deletedManifests} backups antigos removidos.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/backup/history'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro na limpeza',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async (scheduleData: Partial<BackupSchedule>) => {
      return apiRequest('PUT', '/api/backup/schedule', scheduleData);
    },
    onSuccess: () => {
      toast({
        title: 'Schedule atualizado',
        description: 'Configuração de backups automáticos salva com sucesso.',
      });
      setShowScheduleDialog(false);
      queryClient.invalidateQueries({ queryKey: ['/api/backup/schedule'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao atualizar schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleStartBackup = () => {
    runBackupMutation.mutate(backupType);
  };

  const handleRestore = () => {
    if (selectedBackupId) {
      restoreMutation.mutate(selectedBackupId);
    }
  };

  const handleVerify = (backupId: string) => {
    verifyMutation.mutate(backupId);
  };

  const handleViewManifest = (manifest: BackupManifest) => {
    setSelectedManifest(manifest);
    setShowManifestDialog(true);
  };

  const handleOpenSchedule = () => {
    if (schedule) {
      setScheduleForm(schedule);
    }
    setShowScheduleDialog(true);
  };

  const validateScheduleForm = (): string | null => {
    if (scheduleForm.fullBackup?.enabled && !scheduleForm.fullBackup?.cronExpression?.trim()) {
      return 'Expressão cron do backup full é obrigatória';
    }
    if (scheduleForm.incrementalBackup?.enabled && !scheduleForm.incrementalBackup?.cronExpression?.trim()) {
      return 'Expressão cron do backup incremental é obrigatória';
    }
    if (scheduleForm.retention?.fullBackupDays && scheduleForm.retention.fullBackupDays < 1) {
      return 'Retenção de backup full deve ser pelo menos 1 dia';
    }
    if (scheduleForm.retention?.incrementalBackupDays && scheduleForm.retention.incrementalBackupDays < 1) {
      return 'Retenção de backup incremental deve ser pelo menos 1 dia';
    }
    if (scheduleForm.retention?.archiveDays && scheduleForm.retention.archiveDays < 7) {
      return 'Retenção de arquivo deve ser pelo menos 7 dias';
    }
    return null;
  };

  const handleSaveSchedule = () => {
    const validationError = validateScheduleForm();
    if (validationError) {
      toast({
        title: 'Erro de validação',
        description: validationError,
        variant: 'destructive',
      });
      return;
    }
    updateScheduleMutation.mutate(scheduleForm);
  };

  const isBackupRunning = jobStatus?.status === 'running';

  return (
    <ScrollArea className="h-full">
      <motion.div
        className="p-6 space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={item}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">
                Backup & Restore
              </h1>
              <p className="text-muted-foreground">
                Sistema unificado de backup para toda a plataforma Alice
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['/api/backup/status'] });
                queryClient.invalidateQueries({ queryKey: ['/api/backup/history'] });
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div variants={item} className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5" />
                  Executar Backup
                </CardTitle>
                <CardDescription>
                  Backup unificado de PostgreSQL, MariaDB, Redis e uploads
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <Select
                    value={backupType}
                    onValueChange={(value: 'full' | 'incremental') => setBackupType(value)}
                    disabled={isBackupRunning}
                  >
                    <SelectTrigger className="w-48" data-testid="select-backup-type">
                      <SelectValue placeholder="Tipo de backup" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Backup Full</SelectItem>
                      <SelectItem value="incremental">Backup Incremental</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button
                    onClick={handleStartBackup}
                    disabled={isBackupRunning || runBackupMutation.isPending}
                    data-testid="button-start-backup"
                  >
                    {runBackupMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4 mr-2" />
                    )}
                    {isBackupRunning ? 'Backup em andamento...' : 'Iniciar Backup'}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setShowRestoreDialog(true)}
                    disabled={isBackupRunning || !history?.manifests.length}
                    data-testid="button-restore"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Restaurar
                  </Button>
                </div>

                {isBackupRunning && jobStatus && (
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {jobStatus.currentComponent 
                          ? `Processando: ${jobStatus.currentComponent}`
                          : 'Preparando backup...'}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {jobStatus.progress}%
                      </span>
                    </div>
                    <Progress value={jobStatus.progress} className="h-2" />
                    <div className="flex gap-2 flex-wrap">
                      {jobStatus.components?.map((comp) => (
                        <Badge
                          key={comp.component}
                          variant={comp.status === 'completed' ? 'default' : 
                                  comp.status === 'failed' ? 'destructive' : 'secondary'}
                          className="gap-1"
                        >
                          <ComponentIcon component={comp.component} />
                          {comp.component}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {isLoadingStatus && (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Último Backup
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingHistory ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : history?.lastSuccessful ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={history.lastSuccessful.status} />
                      <span className="font-medium">{history.lastSuccessful.type.toUpperCase()}</span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p className="flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {formatDate(history.lastSuccessful.startedAt)}
                      </p>
                      {history.lastSuccessful.durationSeconds && (
                        <p>
                          Duração: {formatDuration(history.lastSuccessful.durationSeconds)}
                        </p>
                      )}
                      {history.lastSuccessful.totalSize && (
                        <p>Tamanho: {history.lastSuccessful.totalSize}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Badge variant="outline" className="gap-1">
                        <Archive className="h-3 w-3" />
                        Local
                      </Badge>
                      {history.lastSuccessful.encryption.enabled && (
                        <Badge variant="outline" className="gap-1">
                          <Shield className="h-3 w-3" />
                          Criptografado
                        </Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Nenhum backup realizado ainda.
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <motion.div variants={item}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Histórico de Backups
                  </CardTitle>
                  <CardDescription>
                    {history?.totalCount || 0} backups registrados
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cleanupMutation.mutate()}
                  disabled={cleanupMutation.isPending}
                  data-testid="button-cleanup"
                >
                  {cleanupMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eraser className="h-4 w-4 mr-2" />
                  )}
                  Limpar Antigos
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : history?.manifests.length ? (
                <div className="space-y-2">
                  {history.manifests.slice(0, 10).map((manifest) => (
                    <div
                      key={manifest.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover-elevate"
                      data-testid={`backup-item-${manifest.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <StatusIcon status={manifest.status} />
                        <div>
                          <p className="font-medium text-sm">{manifest.id}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(manifest.startedAt)} | {manifest.type.toUpperCase()}
                            {manifest.durationSeconds && ` | ${formatDuration(manifest.durationSeconds)}`}
                            {manifest.totalSize && ` | ${manifest.totalSize}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {Object.entries(manifest.components).map(([key, comp]) => (
                            <Badge
                              key={key}
                              variant={comp?.status === 'completed' ? 'default' : 
                                      comp?.status === 'failed' ? 'destructive' : 'secondary'}
                              className="gap-1 text-xs"
                            >
                              <ComponentIcon component={key} />
                            </Badge>
                          ))}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewManifest(manifest)}
                          data-testid={`button-view-manifest-${manifest.id}`}
                        >
                          <FileJson className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleVerify(manifest.id)}
                          disabled={verifyMutation.isPending}
                          data-testid={`button-verify-${manifest.id}`}
                        >
                          <Shield className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (window.confirm(`Excluir backup ${manifest.id}? Esta ação é irreversível.`)) {
                              deleteMutation.mutate(manifest.id);
                            }
                          }}
                          disabled={deleteMutation.isPending || manifest.status === 'running'}
                          data-testid={`button-delete-${manifest.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Archive className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhum backup encontrado</p>
                  <p className="text-sm">Execute seu primeiro backup para começar</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule de Backups Automáticos
              </CardTitle>
              <CardDescription>
                Configure horários e retenção de backups automáticos
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingSchedule ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : schedule ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${schedule.enabled ? 'bg-green-500' : 'bg-muted'}`} />
                      <span className="font-medium">
                        {schedule.enabled ? 'Backups automáticos ativos' : 'Backups automáticos desativados'}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenSchedule}
                      data-testid="button-configure-schedule"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Configurar
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Archive className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-sm">Backup Full</span>
                        <Badge variant={schedule.fullBackup.enabled ? 'default' : 'secondary'} className="text-xs">
                          {schedule.fullBackup.enabled ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{schedule.fullBackup.description}</p>
                      <p className="text-xs font-mono mt-1">{schedule.fullBackup.cronExpression}</p>
                    </div>
                    
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <RefreshCw className="h-4 w-4 text-green-500" />
                        <span className="font-medium text-sm">Backup Incremental</span>
                        <Badge variant={schedule.incrementalBackup.enabled ? 'default' : 'secondary'} className="text-xs">
                          {schedule.incrementalBackup.enabled ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{schedule.incrementalBackup.description}</p>
                      <p className="text-xs font-mono mt-1">{schedule.incrementalBackup.cronExpression}</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Retenção: Full {schedule.retention.fullBackupDays}d</span>
                    <span>|</span>
                    <span>Incremental {schedule.retention.incrementalBackupDays}d</span>
                    <span>|</span>
                    <span>Arquivo {schedule.retention.archiveDays}d</span>
                    <span>|</span>
                    <span className="flex items-center gap-1">
                      <Archive className="h-3 w-3" />
                      Volume Local
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Carregando configuração de schedule...
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Componentes Monitorados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { name: 'PostgreSQL', icon: Database, desc: 'pgBackRest + WAL + PITR', color: 'text-blue-500' },
                  { name: 'MariaDB', icon: Server, desc: 'Mariabackup + GTID', color: 'text-orange-500' },
                  { name: 'Redis', icon: HardDrive, desc: 'RDB Snapshot', color: 'text-red-500' },
                  { name: 'Volume Local', icon: Archive, desc: '/opt/alice/backups', color: 'text-green-500' },
                ].map((comp) => (
                  <div
                    key={comp.name}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
                    data-testid={`component-${comp.name.toLowerCase()}`}
                  >
                    <comp.icon className={`h-8 w-8 ${comp.color}`} />
                    <div>
                      <p className="font-medium text-sm">{comp.name}</p>
                      <p className="text-xs text-muted-foreground">{comp.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restaurar Backup</DialogTitle>
              <DialogDescription>
                Selecione o backup que deseja restaurar. Esta operação irá substituir todos os dados atuais.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Select
                value={selectedBackupId || ''}
                onValueChange={setSelectedBackupId}
              >
                <SelectTrigger data-testid="select-restore-backup">
                  <SelectValue placeholder="Selecione um backup" />
                </SelectTrigger>
                <SelectContent>
                  {history?.manifests
                    .filter(m => m.status === 'completed' || m.status === 'partial')
                    .map((manifest) => (
                      <SelectItem key={manifest.id} value={manifest.id}>
                        {manifest.id} ({formatDate(manifest.startedAt)})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRestoreDialog(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowConfirmRestore(true)}
                disabled={!selectedBackupId}
                data-testid="button-confirm-restore-dialog"
              >
                Restaurar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showConfirmRestore} onOpenChange={setShowConfirmRestore}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar Restauração</AlertDialogTitle>
              <AlertDialogDescription>
                ATENÇÃO: Esta ação irá substituir TODOS os dados atuais pelos dados do backup selecionado.
                Esta operação é IRREVERSÍVEL. Tem certeza que deseja continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRestore}
                className="bg-destructive text-destructive-foreground"
                data-testid="button-final-confirm-restore"
              >
                {restoreMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Sim, Restaurar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={showManifestDialog} onOpenChange={setShowManifestDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manifesto do Backup</DialogTitle>
              <DialogDescription>
                {selectedManifest?.id}
              </DialogDescription>
            </DialogHeader>
            {selectedManifest && (
              <ScrollArea className="max-h-96">
                <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
                  {JSON.stringify(selectedManifest, null, 2)}
                </pre>
              </ScrollArea>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowManifestDialog(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configurar Schedule de Backups
              </DialogTitle>
              <DialogDescription>
                Configure horários, retenção e notificações para backups automáticos
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-6 pr-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="schedule-enabled" className="font-medium">Backups Automáticos</Label>
                    <p className="text-xs text-muted-foreground">Ativar/desativar todos os backups automáticos</p>
                  </div>
                  <Switch
                    id="schedule-enabled"
                    checked={scheduleForm.enabled ?? true}
                    onCheckedChange={(checked) => setScheduleForm(prev => ({ ...prev, enabled: checked }))}
                    data-testid="switch-schedule-enabled"
                  />
                </div>

                <div className="space-y-4 p-4 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4 text-blue-500" />
                      <Label className="font-medium">Backup Full</Label>
                    </div>
                    <Switch
                      checked={scheduleForm.fullBackup?.enabled ?? true}
                      onCheckedChange={(checked) => setScheduleForm(prev => ({
                        ...prev,
                        fullBackup: { ...prev.fullBackup!, enabled: checked }
                      }))}
                      data-testid="switch-full-backup-enabled"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="full-cron" className="text-sm">Expressão Cron</Label>
                      <Input
                        id="full-cron"
                        value={scheduleForm.fullBackup?.cronExpression ?? '0 3 * * 0'}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          fullBackup: { ...prev.fullBackup!, cronExpression: e.target.value }
                        }))}
                        placeholder="0 3 * * 0"
                        className="font-mono text-sm"
                        data-testid="input-full-cron"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="full-desc" className="text-sm">Descrição</Label>
                      <Input
                        id="full-desc"
                        value={scheduleForm.fullBackup?.description ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          fullBackup: { ...prev.fullBackup!, description: e.target.value }
                        }))}
                        placeholder="Backup full aos domingos às 03:00"
                        data-testid="input-full-description"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-green-500" />
                      <Label className="font-medium">Backup Incremental</Label>
                    </div>
                    <Switch
                      checked={scheduleForm.incrementalBackup?.enabled ?? true}
                      onCheckedChange={(checked) => setScheduleForm(prev => ({
                        ...prev,
                        incrementalBackup: { ...prev.incrementalBackup!, enabled: checked }
                      }))}
                      data-testid="switch-incremental-backup-enabled"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="incr-cron" className="text-sm">Expressão Cron</Label>
                      <Input
                        id="incr-cron"
                        value={scheduleForm.incrementalBackup?.cronExpression ?? '0 3 * * 1-6'}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          incrementalBackup: { ...prev.incrementalBackup!, cronExpression: e.target.value }
                        }))}
                        placeholder="0 3 * * 1-6"
                        className="font-mono text-sm"
                        data-testid="input-incremental-cron"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="incr-desc" className="text-sm">Descrição</Label>
                      <Input
                        id="incr-desc"
                        value={scheduleForm.incrementalBackup?.description ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          incrementalBackup: { ...prev.incrementalBackup!, description: e.target.value }
                        }))}
                        placeholder="Backup incremental de seg a sáb"
                        data-testid="input-incremental-description"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <Label className="font-medium">Retenção de Backups</Label>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ret-full" className="text-sm">Full (dias)</Label>
                      <Input
                        id="ret-full"
                        type="number"
                        min={1}
                        max={365}
                        value={scheduleForm.retention?.fullBackupDays ?? 30}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          retention: { ...prev.retention!, fullBackupDays: parseInt(e.target.value) || 30 }
                        }))}
                        data-testid="input-retention-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ret-incr" className="text-sm">Incremental (dias)</Label>
                      <Input
                        id="ret-incr"
                        type="number"
                        min={1}
                        max={30}
                        value={scheduleForm.retention?.incrementalBackupDays ?? 7}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          retention: { ...prev.retention!, incrementalBackupDays: parseInt(e.target.value) || 7 }
                        }))}
                        data-testid="input-retention-incremental"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ret-archive" className="text-sm">Arquivo (dias)</Label>
                      <Input
                        id="ret-archive"
                        type="number"
                        min={7}
                        max={3650}
                        value={scheduleForm.retention?.archiveDays ?? 90}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleForm(prev => ({
                          ...prev,
                          retention: { ...prev.retention!, archiveDays: parseInt(e.target.value) || 90 }
                        }))}
                        data-testid="input-retention-archive"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    <Label className="font-medium">Notificações</Label>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="notify-success" className="text-sm">Notificar em sucesso</Label>
                      <Switch
                        id="notify-success"
                        checked={scheduleForm.notifications?.onSuccess ?? false}
                        onCheckedChange={(checked) => setScheduleForm(prev => ({
                          ...prev,
                          notifications: { ...prev.notifications!, onSuccess: checked }
                        }))}
                        data-testid="switch-notify-success"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="notify-failure" className="text-sm">Notificar em falha</Label>
                      <Switch
                        id="notify-failure"
                        checked={scheduleForm.notifications?.onFailure ?? true}
                        onCheckedChange={(checked) => setScheduleForm(prev => ({
                          ...prev,
                          notifications: { ...prev.notifications!, onFailure: checked }
                        }))}
                        data-testid="switch-notify-failure"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Archive className="h-4 w-4 text-green-500" />
                    <Label className="font-medium">Storage Local</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Backups são armazenados 100% localmente no Volume Hetzner (/opt/alice/backups).
                    Para backups offsite, faça download manual ou configure rsync externo.
                  </p>
                </div>
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveSchedule}
                disabled={updateScheduleMutation.isPending}
                data-testid="button-save-schedule"
              >
                {updateScheduleMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar Configuração
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </motion.div>
    </ScrollArea>
  );
}

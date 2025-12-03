/**
 * Training - Gestão de Fine-tuning
 * 
 * Página para gerenciar dados de treinamento e jobs de fine-tuning
 * na Salad Cloud para o modelo Llama 4 Maverick.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
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
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
};

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

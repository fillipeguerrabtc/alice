import { useQuery, useMutation } from '@tanstack/react-query';
import { Brain, Check, X, Loader2, Play, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/utils';

interface TrainingData {
  id: string;
  source: string;
  status: 'pending' | 'approved' | 'rejected' | 'used';
  isDuplicate: boolean;
  similarityScore?: number;
  criadoEm: string;
  messages: Array<{ role: string; content: string }>;
}

interface FineTuningJob {
  id: string;
  name: string;
  status: string;
  progress?: number;
  trainingDataCount: number;
  criadoEm: string;
  completadoEm?: string;
}

interface TrainingStats {
  trainingData: {
    pending: number;
    approved: number;
    duplicatesFiltered: number;
  };
  jobs: {
    completed: number;
  };
}

export default function Training() {
  const { data: trainingData, isLoading: isLoadingData } = useQuery<{ trainingData: TrainingData[] }>({
    queryKey: ['/api/training/data'],
  });

  const { data: jobs, isLoading: isLoadingJobs } = useQuery<{ jobs: FineTuningJob[] }>({
    queryKey: ['/api/training/jobs'],
  });

  const { data: stats } = useQuery<TrainingStats>({
    queryKey: ['/api/training/stats'],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      await apiRequest('PATCH', `/api/training/data/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/stats'] });
      toast({ title: 'Status atualizado com sucesso' });
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar status', variant: 'destructive' });
    },
  });

  const createJobMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/training/jobs', {
        name: `Fine-tuning ${new Date().toISOString()}`,
        baseModel: 'llama4-maverick',
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: 'Job de fine-tuning iniciado' });
    },
    onError: (error: Error) => {
      toast({ title: error.message || 'Erro ao criar job', variant: 'destructive' });
    },
  });

  const pendingData = trainingData?.trainingData.filter((d) => d.status === 'pending') || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Auto-Evolution Training
          </h1>
          <p className="text-muted-foreground">
            Sistema de fine-tuning automático com deduplicação SemHash
          </p>
        </div>
        <Button
          onClick={() => createJobMutation.mutate()}
          disabled={createJobMutation.isPending || (stats?.trainingData.approved || 0) < 10}
          data-testid="button-start-training"
        >
          {createJobMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Iniciar Fine-tuning
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pendentes</CardDescription>
            <CardTitle className="text-2xl" data-testid="stat-pending">
              {stats?.trainingData.pending || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aprovados</CardDescription>
            <CardTitle className="text-2xl" data-testid="stat-approved">
              {stats?.trainingData.approved || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duplicados Filtrados</CardDescription>
            <CardTitle className="text-2xl" data-testid="stat-duplicates">
              {stats?.trainingData.duplicatesFiltered || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Jobs Concluídos</CardDescription>
            <CardTitle className="text-2xl" data-testid="stat-jobs">
              {stats?.jobs.completed || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Dados para Revisão
            </CardTitle>
            <CardDescription>
              Aprove ou rejeite exemplos de treinamento coletados
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : pendingData.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                Nenhum dado pendente de revisão
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-auto">
                {pendingData.slice(0, 10).map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-md p-3 space-y-2"
                    data-testid={`training-data-${item.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {item.source} • {formatDateTime(item.criadoEm)}
                      </span>
                      {item.isDuplicate && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded dark:bg-yellow-900 dark:text-yellow-300">
                          Similar {((item.similarityScore || 0) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="text-sm line-clamp-3">
                      {item.messages[0]?.content}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateStatusMutation.mutate({ id: item.id, status: 'rejected' })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-reject-${item.id}`}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Rejeitar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate({ id: item.id, status: 'approved' })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-approve-${item.id}`}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Aprovar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Jobs de Fine-tuning
            </CardTitle>
            <CardDescription>
              Histórico de jobs de treinamento
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingJobs ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (jobs?.jobs || []).length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                Nenhum job de fine-tuning executado
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-auto">
                {jobs?.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="border rounded-md p-3 space-y-2"
                    data-testid={`job-${job.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{job.name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          job.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : job.status === 'training'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {job.trainingDataCount} exemplos • {formatDateTime(job.criadoEm)}
                    </div>
                    {job.progress !== undefined && job.status === 'training' && (
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

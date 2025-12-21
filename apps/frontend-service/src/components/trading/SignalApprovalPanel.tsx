/**
 * Signal Approval Panel - Painel de Aprovação de Sinais
 * 
 * Permite aprovar ou rejeitar sinais de trading antes da execução.
 * Mostra validação cruzada (se LLM citou valores corretos).
 * 
 * MODOS DE OPERAÇÃO:
 * 1. MANUAL: Todos os sinais precisam de aprovação humana
 * 2. ALICE (Automático): Alice executa se confiança >= threshold
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 * Regra 6: Dados reais, sem mocks
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Brain,
  Shield,
  Eye,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

// ============================================================================
// TIPOS
// ============================================================================

interface TradingSignal {
  id: string;
  tenantId: string;
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol: string;
  confidence: number;
  reasoning: string | null;
  sourceModel: string;
  suggestedPrice?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
  suggestedSize?: number;
  metadata: {
    technicalIndicators?: Record<string, number>;
    validationStatus?: 'pending' | 'validated' | 'failed';
    validationId?: string;
  };
  isActive: boolean;
  criadoEm: string;
}

interface ValidationStats {
  total: number;
  passed: number;
  failed: number;
  accuracyRate: number;
}

interface SignalApprovalPanelProps {
  controlMode: 'manual' | 'alice';
  minConfidenceToExecute: number;
  onModeChange?: (mode: 'manual' | 'alice') => void;
}

// ============================================================================
// HELPERS
// ============================================================================

const getSignalTypeInfo = (type: TradingSignal['signalType']) => {
  switch (type) {
    case 'entry_long':
      return { label: 'COMPRA', icon: TrendingUp, color: 'text-green-500 bg-green-50 border-green-200' };
    case 'entry_short':
      return { label: 'VENDA', icon: TrendingDown, color: 'text-red-500 bg-red-50 border-red-200' };
    case 'exit':
      return { label: 'SAIR', icon: XCircle, color: 'text-yellow-500 bg-yellow-50 border-yellow-200' };
    case 'adjust_sl':
      return { label: 'AJUSTAR SL', icon: Shield, color: 'text-blue-500 bg-blue-50 border-blue-200' };
    case 'adjust_tp':
      return { label: 'AJUSTAR TP', icon: TrendingUp, color: 'text-purple-500 bg-purple-50 border-purple-200' };
    case 'hold':
      return { label: 'MANTER', icon: Clock, color: 'text-gray-500 bg-gray-50 border-gray-200' };
    case 'neutral':
      return { label: 'NEUTRO', icon: AlertCircle, color: 'text-gray-500 bg-gray-50 border-gray-200' };
    default:
      return { label: type, icon: AlertCircle, color: 'text-gray-500 bg-gray-50 border-gray-200' };
  }
};

// ============================================================================
// COMPONENTE DE SINAL INDIVIDUAL
// ============================================================================

function SignalCard({
  signal,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  signal: TradingSignal;
  onApprove: (signalId: string, reason: string) => void;
  onReject: (signalId: string, reason: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [reason, setReason] = useState('');

  const typeInfo = getSignalTypeInfo(signal.signalType);
  const TypeIcon = typeInfo.icon;
  const confidencePercent = Math.round(signal.confidence * 100);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <Card className={`border-l-4 ${typeInfo.color}`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className={`p-2 rounded-lg ${typeInfo.color}`}>
                  <TypeIcon className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{typeInfo.label}</span>
                    <Badge variant="outline">{signal.symbol}</Badge>
                    <Badge variant="secondary" className="text-xs">
                      {signal.sourceModel}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Confiança:</span>
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${confidencePercent >= 80 ? 'bg-green-500' : confidencePercent >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${confidencePercent}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono">{confidencePercent}%</span>
                    </div>
                    {signal.metadata?.validationStatus && (
                      <Badge
                        variant={signal.metadata.validationStatus === 'validated' ? 'default' : 
                                signal.metadata.validationStatus === 'failed' ? 'destructive' : 'secondary'}
                      >
                        {signal.metadata.validationStatus === 'validated' && (
                          <>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Validado
                          </>
                        )}
                        {signal.metadata.validationStatus === 'failed' && (
                          <>
                            <XCircle className="h-3 w-3 mr-1" />
                            Falhou Validação
                          </>
                        )}
                        {signal.metadata.validationStatus === 'pending' && (
                          <>
                            <Clock className="h-3 w-3 mr-1" />
                            Pendente
                          </>
                        )}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(signal.criadoEm).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-green-600 border-green-600 hover:bg-green-50"
                  onClick={() => setShowApproveDialog(true)}
                  disabled={isApproving || isRejecting}
                >
                  {isApproving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Aprovar
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-600 hover:bg-red-50"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={isApproving || isRejecting}
                >
                  {isRejecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 mr-1" />
                      Rejeitar
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Detalhes Expansíveis */}
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-2 w-full">
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-2" />
                      Ocultar Detalhes
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Separator className="my-3" />
                <div className="space-y-3">
                  {/* Reasoning */}
                  {signal.reasoning && (
                    <div>
                      <p className="text-sm font-medium mb-1">Raciocínio da IA:</p>
                      <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                        {signal.reasoning}
                      </p>
                    </div>
                  )}

                  {/* Valores Sugeridos */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {signal.suggestedPrice && (
                      <div className="bg-muted p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Preço Sugerido</p>
                        <p className="font-mono font-bold">${signal.suggestedPrice.toLocaleString()}</p>
                      </div>
                    )}
                    {signal.suggestedStopLoss && (
                      <div className="bg-red-50 p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Stop Loss</p>
                        <p className="font-mono font-bold text-red-600">${signal.suggestedStopLoss.toLocaleString()}</p>
                      </div>
                    )}
                    {signal.suggestedTakeProfit && (
                      <div className="bg-green-50 p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Take Profit</p>
                        <p className="font-mono font-bold text-green-600">${signal.suggestedTakeProfit.toLocaleString()}</p>
                      </div>
                    )}
                    {signal.suggestedSize && (
                      <div className="bg-muted p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Tamanho (%)</p>
                        <p className="font-mono font-bold">{(signal.suggestedSize * 100).toFixed(1)}%</p>
                      </div>
                    )}
                  </div>

                  {/* Indicadores Técnicos */}
                  {signal.metadata?.technicalIndicators && Object.keys(signal.metadata.technicalIndicators).length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Indicadores Técnicos Usados:</p>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {Object.entries(signal.metadata.technicalIndicators).map(([key, value]) => (
                          <div key={key} className="bg-muted p-2 rounded text-center">
                            <p className="text-xs text-muted-foreground uppercase">{key}</p>
                            <p className="font-mono text-sm">{typeof value === 'number' ? value.toFixed(2) : value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </motion.div>

      {/* Dialog de Aprovação */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Aprovar Sinal de Trading
            </DialogTitle>
            <DialogDescription>
              Confirme a aprovação deste sinal para execução. A ordem será enviada para a KuCoin.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg mb-4">
              <TypeIcon className={`h-8 w-8 ${typeInfo.color.split(' ')[0]}`} />
              <div>
                <p className="font-bold">{typeInfo.label} - {signal.symbol}</p>
                <p className="text-sm text-muted-foreground">Confiança: {confidencePercent}%</p>
              </div>
            </div>
            <Textarea
              placeholder="Motivo da aprovação (opcional)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                onApprove(signal.id, reason);
                setShowApproveDialog(false);
                setReason('');
              }}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirmar Aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Rejeição */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Rejeitar Sinal de Trading
            </DialogTitle>
            <DialogDescription>
              Confirme a rejeição deste sinal. A ordem não será executada.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg mb-4">
              <TypeIcon className={`h-8 w-8 ${typeInfo.color.split(' ')[0]}`} />
              <div>
                <p className="font-bold">{typeInfo.label} - {signal.symbol}</p>
                <p className="text-sm text-muted-foreground">Confiança: {confidencePercent}%</p>
              </div>
            </div>
            <Textarea
              placeholder="Motivo da rejeição (recomendado)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onReject(signal.id, reason);
                setShowRejectDialog(false);
                setReason('');
              }}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Confirmar Rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function SignalApprovalPanel({
  controlMode,
  minConfidenceToExecute,
}: SignalApprovalPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [approvingSignalId, setApprovingSignalId] = useState<string | null>(null);
  const [rejectingSignalId, setRejectingSignalId] = useState<string | null>(null);

  // Buscar sinais pendentes
  const { data: signalsResponse, isLoading, refetch } = useQuery<{
    success: boolean;
    data: TradingSignal[];
  }>({
    queryKey: ['trading-signals-pending'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/integrations/trading/signals?active=true');
      return response.json();
    },
    refetchInterval: 10000,
  });

  // Buscar estatísticas de validação
  const { data: validationStats } = useQuery<{
    success: boolean;
    stats: ValidationStats;
  }>({
    queryKey: ['trading-validation-stats'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/integrations/trading/validations?limit=1');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Mutation para aprovar sinal
  const approveMutation = useMutation({
    mutationFn: async ({ signalId, reason }: { signalId: string; reason: string }) => {
      const response = await apiRequest('POST', `/api/integrations/trading/signals/${signalId}/execute`, {
        reason,
        approved: true,
      });
      return response.json();
    },
    onMutate: ({ signalId }) => {
      setApprovingSignalId(signalId);
    },
    onSuccess: () => {
      toast({
        title: 'Sinal Aprovado',
        description: 'A ordem foi enviada para execução.',
      });
      queryClient.invalidateQueries({ queryKey: ['trading-signals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['trading-orders'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao Aprovar',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setApprovingSignalId(null);
    },
  });

  // Mutation para rejeitar sinal
  const rejectMutation = useMutation({
    mutationFn: async ({ signalId, reason }: { signalId: string; reason: string }) => {
      const response = await apiRequest('POST', `/api/integrations/trading/signals/${signalId}/deactivate`, {
        reason,
      });
      return response.json();
    },
    onMutate: ({ signalId }) => {
      setRejectingSignalId(signalId);
    },
    onSuccess: () => {
      toast({
        title: 'Sinal Rejeitado',
        description: 'O sinal foi desativado.',
      });
      queryClient.invalidateQueries({ queryKey: ['trading-signals-pending'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao Rejeitar',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setRejectingSignalId(null);
    },
  });

  const signals = signalsResponse?.data || [];
  const stats = validationStats?.stats;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Aprovação de Sinais
              <Badge variant={controlMode === 'manual' ? 'default' : 'secondary'}>
                {controlMode === 'manual' ? 'MODO MANUAL' : 'MODO ALICE'}
              </Badge>
            </CardTitle>
            <CardDescription>
              {controlMode === 'manual'
                ? 'Todos os sinais precisam de aprovação humana antes da execução'
                : `Sinais com confiança ≥ ${Math.round(minConfidenceToExecute * 100)}% são executados automaticamente`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>

        {/* Estatísticas de Validação */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mt-4 p-4 bg-muted/50 rounded-lg">
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Validações</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{stats.passed}</p>
              <p className="text-xs text-muted-foreground">Aprovadas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              <p className="text-xs text-muted-foreground">Falhas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{stats.accuracyRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Taxa de Acerto</p>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Brain className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Nenhum sinal pendente</p>
            <p className="text-sm">Novos sinais aparecerão aqui quando a Alice identificar oportunidades</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <AnimatePresence>
              <div className="space-y-4">
                {signals.map((signal) => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    onApprove={(signalId, reason) => approveMutation.mutate({ signalId, reason })}
                    onReject={(signalId, reason) => rejectMutation.mutate({ signalId, reason })}
                    isApproving={approvingSignalId === signal.id}
                    isRejecting={rejectingSignalId === signal.id}
                  />
                ))}
              </div>
            </AnimatePresence>
          </ScrollArea>
        )}

        {/* Alerta de Modo */}
        {controlMode === 'alice' && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg p-3">
            <Brain className="h-4 w-4 text-blue-500" />
            <span>
              <strong>Modo Alice ativo:</strong> Sinais com confiança ≥ {Math.round(minConfidenceToExecute * 100)}% 
              são executados automaticamente. Sinais abaixo do threshold aparecem aqui para aprovação manual.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SignalApprovalPanel;


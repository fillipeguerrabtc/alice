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

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Brain,
  Shield,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileCheck,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { formatDateTime, formatNumber } from '@/lib/utils';

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
  sourceModel?: string | null;
  suggestedPrice?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
  suggestedSize?: number;
  metadata: {
    technicalIndicators?: Record<string, number>;
    validationStatus?: 'pending' | 'validated' | 'failed';
    validationId?: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    approvalReason?: string;
    techniques?: string[];
    techniqueScores?: Array<{ technique: string; signal: string; confidence: number; rationale?: string }>;
    ensembleResult?: {
      overallSignal?: string;
      confidence?: number;
      topTechniques?: Array<{ technique: string; signal: string; confidence: number; rationale?: string }>;
    };
    arbitrageSnapshot?: {
      intermediateAsset?: string;
      edgePct?: number;
      legs?: Array<{ from: string; to: string; symbol: string; side: string; rate: number }>;
    };
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

export interface SignalApprovalPanelProps {
  marketType?: 'futures' | 'spot' | 'margin';
}

type SignalApprovalOverrides = {
  orderType?: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  size?: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
};

type ApproveOverridesForm = {
  orderType?: SignalApprovalOverrides['orderType'];
  size: string;
  price: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
};

// ============================================================================
// HELPERS
// ============================================================================

const getSignalTypeInfo = (type: TradingSignal['signalType']) => {
  switch (type) {
    case 'entry_long':
      return { label: 'COMPRA', icon: TrendingUp, color: 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30' };
    case 'entry_short':
      return { label: 'VENDA', icon: TrendingDown, color: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30' };
    case 'exit':
      return { label: 'SAIR', icon: XCircle, color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/30' };
    case 'adjust_sl':
      return { label: 'AJUSTAR SL', icon: Shield, color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30' };
    case 'adjust_tp':
      return { label: 'AJUSTAR TP', icon: TrendingUp, color: 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/30' };
    case 'hold':
      return { label: 'MANTER', icon: Clock, color: 'text-muted-foreground bg-muted/60 border-muted-foreground/30' };
    case 'neutral':
      return { label: 'NEUTRO', icon: AlertCircle, color: 'text-muted-foreground bg-muted/60 border-muted-foreground/30' };
    default:
      return { label: type, icon: AlertCircle, color: 'text-muted-foreground bg-muted/60 border-muted-foreground/30' };
  }
};

const buildIndicatorExplanation = (analysis: Record<string, unknown>): string[] => {
  const items: string[] = [];
  const rsi = analysis.rsi as { value?: number; interpretation?: string } | undefined;
  if (rsi?.value !== undefined) {
    items.push(`RSI ${rsi.value.toFixed(2)} (${rsi.interpretation ?? 'neutro'})`);
  }
  const macd = analysis.macd as { histogram?: number; interpretation?: string; crossover?: string } | undefined;
  if (macd?.histogram !== undefined) {
    items.push(`MACD hist ${macd.histogram.toFixed(2)} (${macd.interpretation ?? 'neutro'})`);
  }
  const moving = analysis.movingAverages as { trend?: string } | undefined;
  if (moving?.trend) {
    items.push(`Médias móveis: tendência ${moving.trend}`);
  }
  const bollinger = analysis.bollinger as { percentB?: number; interpretation?: string } | undefined;
  if (bollinger?.percentB !== undefined) {
    items.push(`Bollinger %B ${(bollinger.percentB * 100).toFixed(0)}% (${bollinger.interpretation ?? 'neutro'})`);
  }
  const atr = analysis.atr as { percentage?: number; volatility?: string } | undefined;
  if (atr?.percentage !== undefined) {
    items.push(`ATR ${(atr.percentage).toFixed(2)}% (${atr.volatility ?? 'média'})`);
  }
  const stochastic = analysis.stochastic as { k?: number; d?: number; interpretation?: string } | undefined;
  if (stochastic?.k !== undefined) {
    items.push(`Stochastic %K ${stochastic.k.toFixed(2)} / %D ${stochastic.d?.toFixed(2) ?? 'N/A'} (${stochastic.interpretation ?? 'neutro'})`);
  }
  const adx = analysis.adx as { adx?: number; trendStrength?: string } | undefined;
  if (adx?.adx !== undefined) {
    items.push(`ADX ${adx.adx.toFixed(2)} (${adx.trendStrength ?? 'moderada'})`);
  }
  const sr = analysis.supportResistance as { pivot?: number } | undefined;
  if (sr?.pivot !== undefined) {
    items.push(`Suporte/Resistência: pivot ${sr.pivot.toFixed(2)}`);
  }
  const volume = analysis.volume as { volumeRatio?: number; interpretation?: string } | undefined;
  if (volume?.volumeRatio !== undefined) {
    items.push(`Volume ratio ${volume.volumeRatio.toFixed(2)}x (${volume.interpretation ?? 'normal'})`);
  }
  return items;
};

// ============================================================================
// COMPONENTE DE SINAL INDIVIDUAL
// ============================================================================

function SignalCard({
  signal,
  onApprove,
  onReject,
  onSendToTraining,
  isApproving,
  isRejecting,
  isSendingToTraining,
  locale,
  timeZone,
}: {
  signal: TradingSignal;
  onApprove: (signalId: string, reason?: string, overrides?: SignalApprovalOverrides) => void;
  onReject: (signalId: string, reason?: string) => void;
  onSendToTraining: (signalId: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isSendingToTraining: boolean;
  locale: string;
  timeZone: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [reason, setReason] = useState('');
  const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
  const hasMultiTimeframeContext = Boolean(
    metadata.timeframes || metadata.enabledIndicators || metadata.consensus,
  );
  const hasReasoning: boolean = typeof signal.reasoning === 'string' && signal.reasoning.trim().length > 0;
  const [approveOverrides, setApproveOverrides] = useState<ApproveOverridesForm>({
    orderType: signal.suggestedPrice ? 'limit' : 'market',
    size: '',
    price: signal.suggestedPrice ? String(signal.suggestedPrice) : '',
    leverage: '',
    stopLoss: signal.suggestedStopLoss ? String(signal.suggestedStopLoss) : '',
    takeProfit: signal.suggestedTakeProfit ? String(signal.suggestedTakeProfit) : '',
  });

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
                      {signal.sourceModel ?? 'N/A'}
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
                    {formatDateTime(signal.criadoEm, { locale, timeZone })}
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
                  {hasReasoning && (
                    <div>
                      <p className="text-sm font-medium mb-1">Raciocínio da IA:</p>
                      <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                        {signal.reasoning}
                      </p>
                    </div>
                  )}

                  {hasMultiTimeframeContext && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Contexto Multi‑Timeframe:</p>
                      {Array.isArray(metadata.timeframes) && metadata.timeframes.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Timeframes: {metadata.timeframes.join(', ')}
                        </p>
                      )}
                      {Array.isArray(metadata.enabledIndicators) && metadata.enabledIndicators.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Indicadores: {metadata.enabledIndicators.join(', ')}
                        </p>
                      )}
                      {typeof metadata.consensus === 'object' && metadata.consensus !== null && (
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Consenso: {(metadata.consensus as { overallSignal?: string }).overallSignal ?? 'N/A'}</p>
                          <p>
                            Acordo: {typeof (metadata.consensus as { agreementRatio?: number }).agreementRatio === 'number'
                              ? `${Math.round(((metadata.consensus as { agreementRatio?: number }).agreementRatio ?? 0) * 100)}%`
                              : 'N/A'}
                          </p>
                          {Array.isArray((metadata.consensus as { alignedTimeframes?: string[] }).alignedTimeframes) && (
                            <p>
                              Alinhados: {(metadata.consensus as { alignedTimeframes?: string[] }).alignedTimeframes?.join(', ') || 'Nenhum'}
                            </p>
                          )}
                          {Array.isArray((metadata.consensus as { misalignedTimeframes?: string[] }).misalignedTimeframes) && (
                            <p>
                              Divergentes: {(metadata.consensus as { misalignedTimeframes?: string[] }).misalignedTimeframes?.join(', ') || 'Nenhum'}
                            </p>
                          )}
                        </div>
                      )}
                      {typeof metadata.dataSources === 'object' && metadata.dataSources !== null && (
                        <p className="text-sm text-muted-foreground">
                          Fontes: {['orderBook', 'news', 'trainingData']
                            .filter((key) => (metadata.dataSources as Record<string, boolean>)[key])
                            .join(', ') || 'Nenhuma'}
                        </p>
                      )}
                      {Array.isArray(metadata.techniques) && metadata.techniques.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Técnicas: {metadata.techniques.join(', ')}
                        </p>
                      )}
                      {typeof metadata.ensembleResult === 'object' && metadata.ensembleResult !== null && (
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Ensemble: {(metadata.ensembleResult as { overallSignal?: string }).overallSignal ?? 'N/A'}</p>
                          <p>
                            Confiança: {typeof (metadata.ensembleResult as { confidence?: number }).confidence === 'number'
                              ? `${Math.round(((metadata.ensembleResult as { confidence?: number }).confidence ?? 0) * 100)}%`
                              : 'N/A'}
                          </p>
                          {Array.isArray((metadata.ensembleResult as { topTechniques?: Array<{ technique?: string; confidence?: number }> }).topTechniques) && (
                            <p>
                              Top 3: {(metadata.ensembleResult as { topTechniques?: Array<{ technique?: string }> }).topTechniques
                                ?.map((item) => item.technique)
                                .filter(Boolean)
                                .join(', ') || 'Nenhum'}
                            </p>
                          )}
                        </div>
                      )}
                      {typeof metadata.arbitrageSnapshot === 'object' && metadata.arbitrageSnapshot !== null && (
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Arbitragem: {(metadata.arbitrageSnapshot as { intermediateAsset?: string }).intermediateAsset ?? 'N/A'}</p>
                          <p>
                            Edge: {typeof (metadata.arbitrageSnapshot as { edgePct?: number }).edgePct === 'number'
                              ? `${(metadata.arbitrageSnapshot as { edgePct?: number }).edgePct?.toFixed(2)}%`
                              : 'N/A'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {Array.isArray(metadata.analysisMatrix) && metadata.analysisMatrix.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Raciocínio por timeframe:</p>
                      {metadata.analysisMatrix.map((entry) => {
                        const interval = (entry as { interval?: string }).interval ?? 'N/A';
                        const analysis = (entry as { analysis?: Record<string, unknown> }).analysis ?? {};
                        const explanations = buildIndicatorExplanation(analysis);
                        return (
                          <div key={`signal-${signal.id}-${interval}`} className="border rounded-md p-2 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">{interval}</p>
                            <ul className="list-disc pl-5 space-y-1">
                              {explanations.map((item) => (
                                <li key={`${interval}-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Valores Sugeridos */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {signal.suggestedPrice && (
                      <div className="bg-muted p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Preço Sugerido</p>
                        <p className="font-mono font-bold">${formatNumber(signal.suggestedPrice, locale)}</p>
                      </div>
                    )}
                    {signal.suggestedStopLoss && (
                      <div className="bg-red-50 p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Stop Loss</p>
                        <p className="font-mono font-bold text-red-600">
                          ${formatNumber(signal.suggestedStopLoss, locale)}
                        </p>
                      </div>
                    )}
                    {signal.suggestedTakeProfit && (
                      <div className="bg-green-50 p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Take Profit</p>
                        <p className="font-mono font-bold text-green-600">
                          ${formatNumber(signal.suggestedTakeProfit, locale)}
                        </p>
                      </div>
                    )}
                    {signal.suggestedSize && (
                      <div className="bg-muted p-2 rounded-lg">
                        <p className="text-xs text-muted-foreground">Tamanho (%)</p>
                        <p className="font-mono font-bold">
                          {formatNumber(signal.suggestedSize * 100, locale, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                          %
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSendToTraining(signal.id)}
                      disabled={isSendingToTraining}
                    >
                      {isSendingToTraining ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          Enviar para Treinamento
                        </>
                      )}
                    </Button>
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
      <Dialog open={showApproveDialog} onOpenChange={(open) => {
        setShowApproveDialog(open);
        if (open) {
          setApproveOverrides({
            orderType: signal.suggestedPrice ? 'limit' : 'market',
            size: '',
            price: signal.suggestedPrice ? String(signal.suggestedPrice) : '',
            leverage: '',
            stopLoss: signal.suggestedStopLoss ? String(signal.suggestedStopLoss) : '',
            takeProfit: signal.suggestedTakeProfit ? String(signal.suggestedTakeProfit) : '',
          });
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Aprovar Sinal de Trading
            </DialogTitle>
            <DialogDescription>
              Ajuste os parâmetros se necessário. A ordem ficará pendente para revisão final.
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
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select
                  value={approveOverrides.orderType ?? ''}
                  onValueChange={(value: string) =>
                    setApproveOverrides({
                      ...approveOverrides,
                      orderType: (value || 'market') as SignalApprovalOverrides['orderType'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                    <SelectItem value="stop_market">Stop Market</SelectItem>
                    <SelectItem value="stop_limit">Stop Limit</SelectItem>
                    <SelectItem value="take_profit">Take Profit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  value={approveOverrides.size}
                  onChange={(e) => setApproveOverrides({ ...approveOverrides, size: e.target.value })}
                  placeholder="Ex: 10"
                />
              </div>
              <div className="space-y-1">
                <Label>Preço</Label>
                <Input
                  type="number"
                  value={approveOverrides.price}
                  onChange={(e) => setApproveOverrides({ ...approveOverrides, price: e.target.value })}
                  placeholder="Mercado"
                  disabled={approveOverrides.orderType === 'market' || approveOverrides.orderType === 'stop_market' || approveOverrides.orderType === 'take_profit'}
                />
              </div>
              <div className="space-y-1">
                <Label>Alavancagem</Label>
                <Input
                  type="number"
                  value={approveOverrides.leverage}
                  onChange={(e) => setApproveOverrides({ ...approveOverrides, leverage: e.target.value })}
                  placeholder="Ex: 10"
                />
              </div>
              <div className="space-y-1">
                <Label>Stop Loss</Label>
                <Input
                  type="number"
                  value={approveOverrides.stopLoss}
                  onChange={(e) => setApproveOverrides({ ...approveOverrides, stopLoss: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Take Profit</Label>
                <Input
                  type="number"
                  value={approveOverrides.takeProfit}
                  onChange={(e) => setApproveOverrides({ ...approveOverrides, takeProfit: e.target.value })}
                />
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
                const overrides: SignalApprovalOverrides = {};
                const sizeValue = Number(approveOverrides.size);
                const priceValue = Number(approveOverrides.price);
                const leverageValue = Number(approveOverrides.leverage);
                const stopLossValue = Number(approveOverrides.stopLoss);
                const takeProfitValue = Number(approveOverrides.takeProfit);
                if (approveOverrides.orderType) {
                  overrides.orderType = approveOverrides.orderType as SignalApprovalOverrides['orderType'];
                }
                if (Number.isFinite(sizeValue) && sizeValue > 0) overrides.size = sizeValue;
                if (Number.isFinite(priceValue) && priceValue > 0) overrides.price = priceValue;
                if (Number.isFinite(leverageValue) && leverageValue > 0) overrides.leverage = leverageValue;
                if (Number.isFinite(stopLossValue) && stopLossValue > 0) overrides.stopLoss = stopLossValue;
                if (Number.isFinite(takeProfitValue) && takeProfitValue > 0) overrides.takeProfit = takeProfitValue;
                const trimmedReason = reason.trim();
                onApprove(
                  signal.id,
                  trimmedReason.length > 0 ? trimmedReason : undefined,
                  Object.keys(overrides).length ? overrides : undefined
                );
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
                const trimmedReason = reason.trim();
                onReject(signal.id, trimmedReason.length > 0 ? trimmedReason : undefined);
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
  marketType,
}: SignalApprovalPanelProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isAdminRole = userRoles.includes('admin') || userRoles.includes('super_admin');
  const [approvingSignalId, setApprovingSignalId] = useState<string | null>(null);
  const [rejectingSignalId, setRejectingSignalId] = useState<string | null>(null);
  const [creatingDatasetSignalId, setCreatingDatasetSignalId] = useState<string | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<{ kind: 'approval' | 'validation'; status: string } | null>(null);
  const [historyItems, setHistoryItems] = useState<TradingSignal[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLoadingRef = useRef(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

  // Buscar sinais pendentes
  const { data: signalsResponse, isLoading, refetch } = useQuery<{
    success: boolean;
    data: TradingSignal[];
  }>({
    queryKey: ['trading-signals-pending', marketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('active', 'true');
      if (marketType) {
        params.set('marketType', marketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/signals?${params.toString()}`);
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

  const { data: signalHistoryStats, refetch: refetchSignalHistoryStats } = useQuery<{
    success: boolean;
    data: {
      total: number;
      validation: { validated: number; failed: number; pending: number };
      approval: { approved: number; rejected: number; pending: number };
    };
  }>({
    queryKey: ['trading-signals-history-stats', marketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (marketType) params.set('marketType', marketType);
      const response = await apiRequest('GET', `/api/integrations/trading/signals/history/stats${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Mutation para aprovar sinal
  const approveMutation = useMutation({
    mutationFn: async ({ signalId, reason, overrides }: { signalId: string; reason?: string; overrides?: SignalApprovalOverrides }) => {
      const response = await apiRequest('POST', `/api/integrations/trading/signals/${signalId}/approve`, {
        ...(reason ? { reason } : {}),
        overrides,
      });
      return response.json();
    },
    onMutate: ({ signalId }) => {
      setApprovingSignalId(signalId);
    },
    onSuccess: () => {
      toast({
        title: 'Sinal Aprovado',
        description: 'Ordem criada para revisão e aprovação final.',
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
    mutationFn: async ({ signalId, reason }: { signalId: string; reason?: string }) => {
      const response = await apiRequest('POST', `/api/integrations/trading/signals/${signalId}/reject`, {
        ...(reason ? { reason } : {}),
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

  const createDatasetMutation = useMutation({
    mutationFn: async ({ signalId }: { signalId: string }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/datasets/from-signal', { signalId });
      return response.json();
    },
    onMutate: ({ signalId }) => {
      setCreatingDatasetSignalId(signalId);
    },
    onSuccess: () => {
      toast({
        title: 'Dataset criado',
        description: 'Item enviado para aprovação na página de Treinamento.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao criar dataset',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setCreatingDatasetSignalId(null);
    },
  });

  const fetchSignalHistory = useCallback(async (options: { reset?: boolean; filter?: { kind: 'approval' | 'validation'; status: string } } = {}) => {
    if (historyLoadingRef.current) return;
    const filter = options.filter ?? historyFilter;
    if (!filter) return;
    const reset = options.reset ?? false;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (!reset && historyCursor) {
      params.set('cursor', historyCursor);
    }
    if (marketType) params.set('marketType', marketType);
    if (filter.kind === 'approval') {
      params.set('approvalStatus', filter.status);
    } else {
      params.set('validationStatus', filter.status);
    }
    try {
      const response = await apiRequest('GET', `/api/integrations/trading/signals/history?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || t('trading.signals.history.loadFailed'));
      }
      const nextCursor = payload.nextCursor as string | null;
      const newItems = payload.data as TradingSignal[];
      setHistoryItems((prev) => reset ? newItems : [...prev, ...newItems]);
      setHistoryCursor(nextCursor ?? null);
      setHistoryHasMore(Boolean(nextCursor));
      if (reset) {
        setSelectedHistoryIds(new Set());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.generic');
      toast({ title: t('trading.signals.history.loadFailed'), description: message, variant: 'destructive' });
    } finally {
      setHistoryLoading(false);
      historyLoadingRef.current = false;
    }
  }, [historyCursor, historyFilter, marketType, t, toast]);

  const deleteHistoryMutation = useMutation({
    mutationFn: async ({ ids, all, scope }: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/signals/history/delete', {
        ids,
        all,
        scope,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('trading.signals.history.deleteFailed'));
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: t('trading.signals.history.deletedTitle'), description: t('trading.signals.history.deletedDescription') });
      refetchSignalHistoryStats();
      if (historyFilter) {
        fetchSignalHistory({ reset: true, filter: historyFilter });
      }
    },
    onError: (error: Error) => {
      toast({ title: t('trading.signals.history.deleteFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const openHistoryDialog = (filter: { kind: 'approval' | 'validation'; status: string }) => {
    setHistoryFilter(filter);
    setHistoryDialogOpen(true);
    setHistoryCursor(null);
    setHistoryHasMore(false);
    fetchSignalHistory({ reset: true, filter });
  };

  const toggleHistorySelection = (signalId: string, checked: boolean) => {
    setSelectedHistoryIds((prev) => {
      const updated = new Set(prev);
      if (checked) {
        updated.add(signalId);
      } else {
        updated.delete(signalId);
      }
      return updated;
    });
  };

  const toggleHistorySelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedHistoryIds(new Set(historyItems.map((item) => item.id)));
      return;
    }
    setSelectedHistoryIds(new Set());
  };

  const signals: TradingSignal[] = signalsResponse?.data ?? [];
  const stats = validationStats?.stats;
  const historyStats = signalHistoryStats?.data;
  const allHistorySelected = historyItems.length > 0 && selectedHistoryIds.size === historyItems.length;
  const hasHistorySelection = selectedHistoryIds.size > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Aprovação de Sinais
              <Badge variant="default">MODO MANUAL</Badge>
            </CardTitle>
            <CardDescription>
              Todos os sinais precisam de aprovação humana antes da execução
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>

        {/* Estatísticas de Sinais */}
        {historyStats && (
          <div className="grid grid-cols-3 gap-4 mt-4 p-4 bg-muted/50 rounded-lg">
            <Button
              variant="ghost"
              className="h-auto flex-col gap-1 py-2"
              onClick={() => openHistoryDialog({ kind: 'approval', status: 'approved' })}
            >
              <p className="text-2xl font-bold text-green-600">{historyStats.approval.approved}</p>
              <p className="text-xs text-muted-foreground">Aprovados</p>
            </Button>
            <Button
              variant="ghost"
              className="h-auto flex-col gap-1 py-2"
              onClick={() => openHistoryDialog({ kind: 'approval', status: 'rejected' })}
            >
              <p className="text-2xl font-bold text-red-600">{historyStats.approval.rejected}</p>
              <p className="text-xs text-muted-foreground">Rejeitados</p>
            </Button>
            <Button
              variant="ghost"
              className="h-auto flex-col gap-1 py-2"
              onClick={() => openHistoryDialog({ kind: 'validation', status: 'failed' })}
            >
              <p className="text-2xl font-bold text-orange-600">{historyStats.validation.failed}</p>
              <p className="text-xs text-muted-foreground">Falhas de validação</p>
            </Button>
          </div>
        )}
        {stats && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">Validados:</span>
            <span>passaram na validação cruzada LLM.</span>
            <span className="font-medium">Falhou validação:</span>
            <span>valores citados divergiram dos indicadores reais.</span>
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
                    onApprove={(signalId, reason, overrides) => approveMutation.mutate({ signalId, reason, overrides })}
                    onReject={(signalId, reason) => rejectMutation.mutate({ signalId, reason })}
                    onSendToTraining={(signalId) => createDatasetMutation.mutate({ signalId })}
                    isApproving={approvingSignalId === signal.id}
                    isRejecting={rejectingSignalId === signal.id}
                    isSendingToTraining={creatingDatasetSignalId === signal.id}
                    locale={locale}
                    timeZone={timeZone}
                  />
                ))}
              </div>
            </AnimatePresence>
          </ScrollArea>
        )}

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg p-3">
          <Brain className="h-4 w-4 text-blue-500" />
          <span>
            <strong>Revisão manual obrigatória:</strong> todo sinal precisa ser aprovado para gerar ordem em revisão.
          </span>
        </div>
      </CardContent>

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t('trading.signals.history.title')}</DialogTitle>
            <DialogDescription>
              {historyFilter?.kind === 'approval'
                ? t('trading.signals.history.approvalStatus', { status: historyFilter.status })
                : t('trading.signals.history.validationStatus', { status: historyFilter?.status ?? '-' })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              disabled={!hasHistorySelection || deleteHistoryMutation.isPending}
              onClick={() => deleteHistoryMutation.mutate({ ids: Array.from(selectedHistoryIds), scope: 'self' })}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('trading.signals.history.deleteSelected')}
            </Button>
            <Button
              variant="outline"
              disabled={deleteHistoryMutation.isPending}
              onClick={() => deleteHistoryMutation.mutate({ all: true, scope: 'self' })}
            >
              {t('trading.signals.history.deleteAllMine')}
            </Button>
            {isAdminRole && (
              <Button
                variant="outline"
                disabled={deleteHistoryMutation.isPending}
                onClick={() => deleteHistoryMutation.mutate({ all: true, scope: 'tenant' })}
              >
                {t('trading.signals.history.deleteAllTenant')}
              </Button>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allHistorySelected}
                      onCheckedChange={(checked) => toggleHistorySelectAll(Boolean(checked))}
                    />
                  </TableHead>
                  <TableHead>{t('trading.signals.history.table.type')}</TableHead>
                  <TableHead>{t('trading.signals.history.table.symbol')}</TableHead>
                  <TableHead>{t('trading.signals.history.table.validation')}</TableHead>
                  <TableHead>{t('trading.signals.history.table.approval')}</TableHead>
                  <TableHead>{t('trading.signals.history.table.date')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyItems.map((signal) => {
                  const typeInfo = getSignalTypeInfo(signal.signalType);
                  const TypeIcon = typeInfo.icon;
                  return (
                  <TableRow key={signal.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedHistoryIds.has(signal.id)}
                        onCheckedChange={(checked) => toggleHistorySelection(signal.id, Boolean(checked))}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${typeInfo.color} border-current`}>
                        <TypeIcon className="h-3 w-3 mr-1" />
                        {typeInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>{signal.symbol}</TableCell>
                    <TableCell className="capitalize">{signal.metadata?.validationStatus ?? 'pending'}</TableCell>
                    <TableCell className="capitalize">{signal.metadata?.approvalStatus ?? 'pending'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(signal.criadoEm, { locale, timeZone })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteHistoryMutation.mutate({ ids: [signal.id], scope: 'self' })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {historyItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      {t('trading.signals.history.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t('trading.signals.history.loadedCount', { count: historyItems.length })}
            </span>
            <Button
              variant="outline"
              disabled={!historyHasMore || historyLoading}
              onClick={() => fetchSignalHistory()}
            >
              {historyLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('trading.signals.history.loadMore')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default SignalApprovalPanel;


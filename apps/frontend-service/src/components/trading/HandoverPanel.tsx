/**
 * HandoverPanel - Painel de Controle de Trading (Manual/Alice)
 * 
 * Componente enterprise-grade para gerenciar handover/takeover
 * entre operação manual do usuário e operação autônoma da Alice.
 * 
 * Features:
 * - Toggle entre modo Manual e Alice (IA)
 * - Histórico de mudanças de controle
 * - Status atual com indicadores visuais
 * - Confirmação antes de mudanças críticas
 * - Integração com circuit breaker de trading
 * 
 * Regra 6 - SEM MOCKS: Integração real com backend
 * Regra 8 - TypeScript strict
 * Regra 13 - i18n PT-BR/EN
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  Bot,
  Hand,
  History,
  ShieldCheck,
  Clock,
  User,
} from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

// ============================================================================
// TIPOS
// ============================================================================

export type TradingControlMode = 'alice' | 'manual';

export interface ControlHistoryEntry {
  id: string;
  previousMode: TradingControlMode;
  newMode: TradingControlMode;
  changedBy: string | null;
  reason: string | null;
  source: string;
  createdAt: string;
}

export interface HandoverPanelProps {
  currentMode: TradingControlMode;
  tradingEnabled: boolean;
  circuitBreakerOpen: boolean;
  history: ControlHistoryEntry[];
  isLoading?: boolean;
  onModeChange?: (mode: TradingControlMode, reason: string) => Promise<void>;
  onTradingToggle?: (enabled: boolean) => Promise<void>;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const MODE_CONFIG = {
  alice: {
    icon: Bot,
    label: 'Alice (IA)',
    description: 'Trading autônomo guiado por IA',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500',
  },
  manual: {
    icon: Hand,
    label: 'Manual',
    description: 'Você controla todas as operações',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500',
  },
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function HandoverPanel({
  currentMode,
  tradingEnabled,
  circuitBreakerOpen,
  history,
  isLoading = false,
  onModeChange,
  onTradingToggle,
}: HandoverPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? 'UTC';
  
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<TradingControlMode | null>(null);
  const [reason, setReason] = useState('');
  
  const modeConfig = MODE_CONFIG[currentMode];
  const ModeIcon = modeConfig.icon;
  
  // Mutation para mudança de modo
  const modeChangeMutation = useMutation({
    mutationFn: async ({ mode, reason }: { mode: TradingControlMode; reason: string }) => {
      if (onModeChange) {
        await onModeChange(mode, reason);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trading-status'] });
      toast.success(t('trading.handover.modeChanged'));
      setShowConfirmDialog(false);
      setReason('');
      setPendingMode(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || t('trading.handover.modeChangeError'));
    },
  });
  
  // Mutation para toggle de trading
  const tradingToggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (onTradingToggle) {
        await onTradingToggle(enabled);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trading-status'] });
      toast.success(tradingEnabled ? t('trading.handover.tradingDisabled') : t('trading.handover.tradingEnabled'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('trading.handover.tradingToggleError'));
    },
  });
  
  const handleModeSwitch = () => {
    const newMode = currentMode === 'alice' ? 'manual' : 'alice';
    setPendingMode(newMode);
    setShowConfirmDialog(true);
  };
  
  const confirmModeChange = () => {
    if (pendingMode) {
      modeChangeMutation.mutate({ mode: pendingMode, reason });
    }
  };
  
  const handleTradingToggle = () => {
    tradingToggleMutation.mutate(!tradingEnabled);
  };
  
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                {t('trading.handover.title')}
              </CardTitle>
              <CardDescription>
                {t('trading.handover.description')}
              </CardDescription>
            </div>
            
            {/* Circuit Breaker Status */}
            {circuitBreakerOpen && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t('trading.handover.circuitBreakerOpen')}
              </Badge>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Current Mode Display */}
          <div className={cn(
            'flex items-center justify-between p-4 rounded-lg border-2',
            modeConfig.bgColor,
            modeConfig.borderColor
          )}>
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-full', modeConfig.bgColor)}>
                <ModeIcon className={cn('h-6 w-6', modeConfig.color)} />
              </div>
              <div>
                <p className="font-semibold">{t(`trading.handover.mode.${currentMode}`)}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`trading.handover.modeDescription.${currentMode}`)}
                </p>
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={handleModeSwitch}
              disabled={isLoading || modeChangeMutation.isPending || circuitBreakerOpen}
            >
              {currentMode === 'alice' ? (
                <>
                  <Hand className="mr-2 h-4 w-4" />
                  {t('trading.handover.takeover')}
                </>
              ) : (
                <>
                  <Bot className="mr-2 h-4 w-4" />
                  {t('trading.handover.handback')}
                </>
              )}
            </Button>
          </div>
          
          {/* Trading Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-full',
                tradingEnabled ? 'bg-green-500/10' : 'bg-muted'
              )}>
                {tradingEnabled ? (
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <Label htmlFor="trading-toggle" className="font-semibold">
                  {t('trading.handover.tradingStatus')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {tradingEnabled 
                    ? t('trading.handover.tradingActive')
                    : t('trading.handover.tradingInactive')
                  }
                </p>
              </div>
            </div>
            
            <Switch
              id="trading-toggle"
              checked={tradingEnabled}
              onCheckedChange={handleTradingToggle}
              disabled={isLoading || tradingToggleMutation.isPending || circuitBreakerOpen}
            />
          </div>
          
          {/* History Section */}
          {history.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" />
                {t('trading.handover.history')}
              </div>
              
              <div className="max-h-[200px] overflow-y-auto space-y-2">
                {history.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 text-sm"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {entry.newMode === 'alice' ? (
                        <Bot className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Hand className="h-4 w-4 text-orange-500" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {entry.previousMode} → {entry.newMode}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          via {entry.source}
                        </span>
                      </div>
                      
                      {entry.reason && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {entry.reason}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(entry.createdAt, { locale, timeZone })}
                        {entry.changedBy && (
                          <>
                            <User className="h-3 w-3 ml-2" />
                            <span className="truncate max-w-[100px]">
                              {entry.changedBy}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingMode === 'manual' ? (
                <>
                  <Hand className="h-5 w-5 text-orange-500" />
                  {t('trading.handover.confirmTakeover')}
                </>
              ) : (
                <>
                  <Bot className="h-5 w-5 text-blue-500" />
                  {t('trading.handover.confirmHandback')}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {pendingMode === 'manual'
                ? t('trading.handover.takeoverWarning')
                : t('trading.handover.handbackWarning')
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">{t('trading.handover.reasonLabel')}</Label>
              <Textarea
                id="reason"
                placeholder={t('trading.handover.reasonPlaceholder')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
            
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {pendingMode === 'manual'
                  ? t('trading.handover.takeoverNote')
                  : t('trading.handover.handbackNote')
                }
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmDialog(false);
                setReason('');
                setPendingMode(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant={pendingMode === 'manual' ? 'default' : 'default'}
              onClick={confirmModeChange}
              disabled={modeChangeMutation.isPending}
            >
              {modeChangeMutation.isPending ? (
                <>{t('common.processing')}...</>
              ) : pendingMode === 'manual' ? (
                t('trading.handover.confirmTakeoverBtn')
              ) : (
                t('trading.handover.confirmHandbackBtn')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HandoverPanel;

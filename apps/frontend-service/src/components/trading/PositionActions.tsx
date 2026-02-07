/**
 * PositionActions - Ações de gerenciamento de posições Futures
 *
 * Suporta fechar posição, adicionar/remover margem isolada,
 * e visualizar histórico de posições.
 *
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X, Plus, Minus, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export interface FuturesPosition {
  id: string;
  symbol: string;
  currentQty: number;
  avgEntryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealisedPnl: number;
  unrealisedPnlPcnt: number;
  realLeverage: number;
  posMargin: number;
  isOpen: boolean;
  maintMargin: number;
}

export interface PositionActionsProps {
  position: FuturesPosition;
  /** Callback após ação bem-sucedida para atualizar lista */
  onActionComplete?: () => void;
}

/** Botões de ação para posições individuais */
export function PositionActions({ position, onActionComplete }: PositionActionsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showMarginDialog, setShowMarginDialog] = useState(false);
  const [marginAction, setMarginAction] = useState<'add' | 'remove'>('add');
  const [marginAmount, setMarginAmount] = useState('');

  // Mutation: fechar posição
  const closePositionMutation = useMutation({
    mutationFn: async () => {
      const clientOid = `close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const side = position.currentQty > 0 ? 'sell' : 'buy';
      const size = Math.abs(position.currentQty);

      const res = await apiRequest('POST', '/api/integrations/trading/orders', {
        symbol: position.symbol,
        side,
        type: 'market',
        size: size.toString(),
        closeOrder: true,
        clientOid,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.positionActions.closeSuccess'),
        description: t('trading.positionActions.closeSuccessDesc', { symbol: position.symbol }),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading'] });
      setShowCloseDialog(false);
      onActionComplete?.();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.positionActions.closeError'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation: adicionar/remover margem isolada
  const marginMutation = useMutation({
    mutationFn: async (params: { action: 'add' | 'remove'; amount: string }) => {
      const endpoint = params.action === 'add'
        ? '/api/integrations/trading/positions/margin/deposit'
        : '/api/integrations/trading/positions/margin/withdraw';

      const res = await apiRequest('POST', endpoint, {
        symbol: position.symbol,
        margin: params.amount,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      const key = variables.action === 'add'
        ? 'trading.positionActions.addMarginSuccess'
        : 'trading.positionActions.removeMarginSuccess';
      toast({
        title: t(key),
        description: t('trading.positionActions.marginSuccessDesc', { symbol: position.symbol }),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading'] });
      setShowMarginDialog(false);
      setMarginAmount('');
      onActionComplete?.();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.positionActions.marginError'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const openAddMargin = () => {
    setMarginAction('add');
    setMarginAmount('');
    setShowMarginDialog(true);
  };

  const openRemoveMargin = () => {
    setMarginAction('remove');
    setMarginAmount('');
    setShowMarginDialog(true);
  };

  return (
    <>
      {/* Botões de ação */}
      <div className="flex items-center gap-1 mt-3">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowCloseDialog(true)}
        >
          <X className="h-3 w-3 mr-1" />
          {t('trading.positionActions.close')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddMargin}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t('trading.positionActions.addMargin')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openRemoveMargin}
        >
          <Minus className="h-3 w-3 mr-1" />
          {t('trading.positionActions.removeMargin')}
        </Button>
      </div>

      {/* Dialog: fechar posição */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('trading.positionActions.closeTitle')}</DialogTitle>
            <DialogDescription>
              {t('trading.positionActions.closeDesc', {
                qty: Math.abs(position.currentQty),
                symbol: position.symbol,
                side: position.currentQty > 0 ? 'LONG' : 'SHORT',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => closePositionMutation.mutate()}
              disabled={closePositionMutation.isPending}
            >
              {closePositionMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              {t('trading.positionActions.confirmClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: adicionar/remover margem */}
      <Dialog open={showMarginDialog} onOpenChange={setShowMarginDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {marginAction === 'add'
                ? t('trading.positionActions.addMarginTitle')
                : t('trading.positionActions.removeMarginTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.positionActions.marginDesc', { symbol: position.symbol })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('trading.positionActions.marginAmount')}</Label>
              <Input
                type="number"
                placeholder="0.01"
                value={marginAmount}
                onChange={(e) => setMarginAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('trading.positionActions.currentMargin')}: ${position.posMargin.toFixed(2)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarginDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => marginMutation.mutate({ action: marginAction, amount: marginAmount })}
              disabled={!marginAmount || Number(marginAmount) <= 0 || marginMutation.isPending}
            >
              {marginMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : marginAction === 'add' ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : (
                <Minus className="h-4 w-4 mr-2" />
              )}
              {marginAction === 'add'
                ? t('trading.positionActions.confirmAddMargin')
                : t('trading.positionActions.confirmRemoveMargin')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Botão de histórico de posições (renderizado no header da aba) */
export interface PositionHistoryButtonProps {
  symbol?: string;
}

export function PositionHistoryButton({ symbol }: PositionHistoryButtonProps) {
  const { t } = useTranslation();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setShowHistory(true)}>
        <History className="h-4 w-4 mr-2" />
        {t('trading.positionActions.history')}
      </Button>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t('trading.positionActions.historyTitle')}</DialogTitle>
            <DialogDescription>
              {t('trading.positionActions.historyDesc')}
            </DialogDescription>
          </DialogHeader>
          <PositionHistoryTable symbol={symbol} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Tabela de histórico de posições */
function PositionHistoryTable({ symbol }: { symbol?: string }) {
  const { t } = useTranslation();

  interface PositionHistoryEntry {
    id: string;
    symbol: string;
    side: string;
    size: string;
    entryPrice: string;
    closePrice: string;
    realisedPnl: string;
    closedAt: string;
  }

  const { data: history, isLoading } = useQuery<PositionHistoryEntry[]>({
    queryKey: ['/api/integrations/trading/positions/history', symbol],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (symbol) params.set('symbol', symbol);
      const res = await apiRequest('GET', `/api/integrations/trading/positions/history?${params.toString()}`);
      const json = await res.json();
      return json.data?.items ?? json.items ?? [];
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;

  if (!history?.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {t('trading.positionActions.noHistory')}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('trading.orders.table.symbol')}</TableHead>
          <TableHead>{t('trading.orders.table.side')}</TableHead>
          <TableHead>{t('trading.orders.table.size')}</TableHead>
          <TableHead>{t('trading.positions.entryPrice')}</TableHead>
          <TableHead>{t('trading.positionActions.closePrice')}</TableHead>
          <TableHead>{t('trading.positionActions.realisedPnl')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{entry.symbol}</TableCell>
            <TableCell>{entry.side?.toUpperCase()}</TableCell>
            <TableCell>{entry.size}</TableCell>
            <TableCell>${entry.entryPrice}</TableCell>
            <TableCell>${entry.closePrice}</TableCell>
            <TableCell className={Number(entry.realisedPnl) >= 0 ? 'text-green-500' : 'text-red-500'}>
              {Number(entry.realisedPnl) >= 0 ? '+' : ''}${entry.realisedPnl}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}


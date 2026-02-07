/**
 * OcoOrderForm - Formulário para ordens OCO (One-Cancels-the-Other)
 *
 * Suporta Futures, Spot e Margin. Cria pares de ordens vinculadas:
 * uma ordem limite (take profit) e uma stop (stop loss) que se
 * cancelam mutuamente ao preencher.
 *
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Link2, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

/** Tipo de mercado suportado */
export type MarketType = 'futures' | 'spot' | 'margin';

export interface OcoOrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketType: MarketType;
  symbol: string;
  currentPrice: number;
  marginMode?: 'cross' | 'isolated';
}

interface OcoFormState {
  side: 'buy' | 'sell';
  /** Preço da ordem limite (take profit) */
  limitPrice: string;
  /** Quantidade */
  size: string;
  /** Preço do stop (stop loss) */
  stopPrice: string;
  /** Leverage (somente Futures) */
  leverage: string;
}

/**
 * Retorna o endpoint correto para criação de OCO baseado no tipo de mercado
 */
function getOcoEndpoint(marketType: MarketType): string {
  switch (marketType) {
    case 'futures':
      return '/api/integrations/trading/oco-orders';
    case 'spot':
      return '/api/integrations/trading/spot/oco-orders';
    case 'margin':
      return '/api/integrations/trading/margin/oco-orders';
  }
}

export function OcoOrderForm({
  open,
  onOpenChange,
  marketType,
  symbol,
  currentPrice,
  marginMode,
}: OcoOrderFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<OcoFormState>({
    side: 'buy',
    limitPrice: '',
    size: '',
    stopPrice: '',
    leverage: '10',
  });

  const isFutures = marketType === 'futures';

  const createOcoMutation = useMutation({
    mutationFn: async (formData: OcoFormState) => {
      const endpoint = getOcoEndpoint(marketType);
      const clientOid = `oco-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Corpo da requisição base
      const body: Record<string, unknown> = {
        symbol,
        side: formData.side,
        size: formData.size,
        limitPrice: formData.limitPrice,
        stopPrice: formData.stopPrice,
        clientOid,
      };

      // Campos específicos por mercado
      if (isFutures) {
        body.leverage = Number(formData.leverage);
      }
      if (marketType === 'margin' && marginMode) {
        body.marginMode = marginMode;
      }

      const res = await apiRequest('POST', endpoint, body);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.oco.success'),
        description: t('trading.oco.successDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading'] });
      onOpenChange(false);
      // Resetar formulário
      setForm({
        side: 'buy',
        limitPrice: '',
        size: '',
        stopPrice: '',
        leverage: '10',
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.oco.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const canSubmit =
    form.size &&
    form.limitPrice &&
    form.stopPrice &&
    Number(form.size) > 0 &&
    Number(form.limitPrice) > 0 &&
    Number(form.stopPrice) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {t('trading.oco.title')}
          </DialogTitle>
          <DialogDescription>
            {t('trading.oco.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Side */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={form.side === 'buy' ? 'default' : 'outline'}
              className={form.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : ''}
              onClick={() => setForm({ ...form, side: 'buy' })}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              {t('trading.orders.buy')}
            </Button>
            <Button
              type="button"
              variant={form.side === 'sell' ? 'default' : 'outline'}
              className={form.side === 'sell' ? 'bg-red-600 hover:bg-red-700' : ''}
              onClick={() => setForm({ ...form, side: 'sell' })}
            >
              <TrendingDown className="h-4 w-4 mr-2" />
              {t('trading.orders.sell')}
            </Button>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label>
              {isFutures
                ? t('trading.orders.form.sizeContracts')
                : t('trading.orders.form.sizeAmount')}
            </Label>
            <Input
              type="number"
              placeholder="1"
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
            />
          </div>

          {/* Limit Price (Take Profit side) */}
          <div className="space-y-2">
            <Label>{t('trading.oco.limitPrice')}</Label>
            <Input
              type="number"
              placeholder={currentPrice.toString()}
              value={form.limitPrice}
              onChange={(e) => setForm({ ...form, limitPrice: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t('trading.oco.limitPriceHint')}
            </p>
          </div>

          {/* Stop Price (Stop Loss side) */}
          <div className="space-y-2">
            <Label>{t('trading.oco.stopPrice')}</Label>
            <Input
              type="number"
              placeholder={currentPrice.toString()}
              value={form.stopPrice}
              onChange={(e) => setForm({ ...form, stopPrice: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t('trading.oco.stopPriceHint')}
            </p>
          </div>

          {/* Leverage (Futures only) */}
          {isFutures && (
            <div className="space-y-2">
              <Label>{t('trading.orders.form.leverage')}</Label>
              <Select
                value={form.leverage}
                onValueChange={(value) => setForm({ ...form, leverage: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10, 20, 50, 100].map((lev) => (
                    <SelectItem key={lev} value={lev.toString()}>
                      {lev}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Summary */}
          {canSubmit && (
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-sm">
                <p className="font-medium mb-2">{t('trading.oco.summary')}</p>
                <div className="space-y-1 text-muted-foreground">
                  <p>
                    {form.side === 'buy' ? t('trading.orders.buying') : t('trading.orders.selling')}{' '}
                    {form.size}{' '}
                    {isFutures ? t('trading.orders.contracts') : t('trading.orders.amount')}
                  </p>
                  <p>{t('trading.oco.limitAt')} ${form.limitPrice}</p>
                  <p>{t('trading.oco.stopAt')} ${form.stopPrice}</p>
                  {isFutures && <p>{t('trading.orders.form.withLeverage')} {form.leverage}x</p>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => createOcoMutation.mutate(form)}
            disabled={!canSubmit || createOcoMutation.isPending}
            className={form.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
          >
            {createOcoMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            {t('trading.oco.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

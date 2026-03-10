import { Activity, BookOpen, Loader2, Rocket, TrendingDown, TrendingUp } from 'lucide-react';
import type { TFunction } from 'i18next';
import { formatNumber, parseLocaleNumberInput } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TradingOrderForm = {
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size: string;
  price: string;
  funds: string;
  usdtAmount: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
};

type TradingPnlEstimate = {
  pnlPct: number;
  pnlValue: number;
};

type TradingNewOrderDialogProps = {
  canSubmitOrder: boolean;
  currentPrice: number;
  defaultSymbol: string;
  highPrice: number;
  isFuturesMarket: boolean;
  isSubmitting: boolean;
  locale: string;
  lowPrice: number;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
  onPatchOrderForm: (patch: Partial<TradingOrderForm>) => void;
  onSizeChange: (value: string) => void;
  onSubmit: () => void;
  onUsdtChange: (value: string) => void;
  open: boolean;
  orderEffectivePrice: number;
  orderForm: TradingOrderForm;
  orderLeverageValue: number;
  orderStopLossEstimate: TradingPnlEstimate | null;
  orderStopLossValue: number | null;
  orderTakeProfitEstimate: TradingPnlEstimate | null;
  orderTakeProfitValue: number | null;
  priceChange: number;
  priceChangePercent: number;
  riskMaxLeverage: number;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  t: TFunction;
  volumeOf24h: number;
  wsEnabled: boolean;
};

export function TradingNewOrderDialog({
  canSubmitOrder,
  currentPrice,
  defaultSymbol,
  highPrice,
  isFuturesMarket,
  isSubmitting,
  locale,
  lowPrice,
  onCancel,
  onOpenChange,
  onPatchOrderForm,
  onSizeChange,
  onSubmit,
  onUsdtChange,
  open,
  orderEffectivePrice,
  orderForm,
  orderLeverageValue,
  orderStopLossEstimate,
  orderStopLossValue,
  orderTakeProfitEstimate,
  orderTakeProfitValue,
  priceChange,
  priceChangePercent,
  riskMaxLeverage,
  selectedMarketType,
  selectedSymbol,
  t,
  volumeOf24h,
  wsEnabled,
}: TradingNewOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            {t('trading.orders.newDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('trading.orders.newDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4 py-2">
            {currentPrice > 0 ? (
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{selectedSymbol || defaultSymbol}</span>
                    <Badge variant="outline" className="text-xs">{selectedMarketType}</Badge>
                  </div>
                  {wsEnabled ? (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Activity className="h-3 w-3 text-green-500" />
                      {t('trading.status.liveLabel')}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    ${formatNumber(currentPrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {priceChange !== 0 ? (
                    <span className={`text-sm ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {priceChange >= 0 ? '+' : ''}{(priceChangePercent * 100).toFixed(2)}%
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Máx: ${formatNumber(highPrice || 0, locale, { minimumFractionDigits: 2 })}</span>
                  <span>Mín: ${formatNumber(lowPrice || 0, locale, { minimumFractionDigits: 2 })}</span>
                  <span>Vol: {formatNumber(volumeOf24h || 0, locale, { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={orderForm.side === 'buy' ? 'default' : 'outline'}
                className={orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700 h-12' : 'h-12'}
                onClick={() => onPatchOrderForm({ side: 'buy' })}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                {t('trading.orders.buy')}
              </Button>
              <Button
                type="button"
                variant={orderForm.side === 'sell' ? 'default' : 'outline'}
                className={orderForm.side === 'sell' ? 'bg-red-600 hover:bg-red-700 h-12' : 'h-12'}
                onClick={() => onPatchOrderForm({ side: 'sell' })}
              >
                <TrendingDown className="h-4 w-4 mr-2" />
                {t('trading.orders.sell')}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>{t('trading.orders.form.orderType')}</Label>
              <Select
                value={orderForm.orderType}
                onValueChange={(value: 'limit' | 'market') => onPatchOrderForm({ orderType: value })}
              >
                <SelectTrigger data-testid="select-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">{t('trading.orders.form.market')}</SelectItem>
                  <SelectItem value="limit">{t('trading.orders.form.limit')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {orderForm.orderType === 'limit' ? (
              <div className="space-y-2">
                <Label>{t('trading.orders.form.price')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={currentPrice > 0 ? currentPrice.toString() : 'Ex: 108.250,50'}
                  value={orderForm.price}
                  onChange={(event) => onPatchOrderForm({ price: event.target.value })}
                  data-testid="input-order-price"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>
                {isFuturesMarket
                  ? t('trading.orders.form.sizeContracts')
                  : t('trading.orders.form.sizeAmount')}
              </Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder={isFuturesMarket ? 'Ex: 10' : 'Ex: 0,001'}
                value={orderForm.size}
                onChange={(event) => onSizeChange(event.target.value)}
                data-testid="input-order-size"
              />
              <p className="text-xs text-muted-foreground">
                {isFuturesMarket
                  ? t('trading.orders.form.sizeHint', { symbol: selectedSymbol || defaultSymbol })
                  : t('trading.orders.form.sizeSpotHint')}
              </p>
            </div>

            {isFuturesMarket ? (
              <div className="space-y-2">
                <Label>Valor em USDT</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 100,00"
                  value={orderForm.usdtAmount}
                  onChange={(event) => onUsdtChange(event.target.value)}
                  data-testid="input-order-usdt"
                />
                <p className="text-xs text-muted-foreground">
                  Preencha contratos OU valor em USDT — a conversão é automática.
                </p>
              </div>
            ) : null}

            {!isFuturesMarket && orderForm.orderType === 'market' && orderForm.side === 'buy' ? (
              <div className="space-y-2">
                <Label>{t('trading.orders.form.funds')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 100,00"
                  value={orderForm.funds}
                  onChange={(event) => onPatchOrderForm({ funds: event.target.value })}
                  data-testid="input-order-funds"
                />
                <p className="text-xs text-muted-foreground">
                  {t('trading.orders.form.fundsHint')}
                </p>
              </div>
            ) : null}

            {isFuturesMarket ? (
              <div className="space-y-2">
                <Label>{t('trading.orders.form.leverage')}</Label>
                <Select
                  value={orderForm.leverage}
                  onValueChange={(value) => onPatchOrderForm({ leverage: value })}
                >
                  <SelectTrigger data-testid="select-leverage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 10, 20, 50, 100].map((lev) => (
                      <SelectItem key={lev} value={lev.toString()} disabled={lev > riskMaxLeverage}>
                        {lev}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('trading.orders.form.stopLoss')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={t('trading.orders.form.optional')}
                  value={orderForm.stopLoss}
                  onChange={(event) => onPatchOrderForm({ stopLoss: event.target.value })}
                  data-testid="input-stop-loss"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('trading.orders.form.takeProfit')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={t('trading.orders.form.optional')}
                  value={orderForm.takeProfit}
                  onChange={(event) => onPatchOrderForm({ takeProfit: event.target.value })}
                  data-testid="input-take-profit"
                />
              </div>
            </div>

            {(orderForm.size || orderForm.funds) && currentPrice > 0 ? (
              <Card className="bg-muted/50 border-dashed">
                <CardContent className="p-3 space-y-2">
                  <p className="font-semibold text-sm flex items-center gap-1">
                    <BookOpen className="h-4 w-4" />
                    {t('trading.orders.form.summary')}
                  </p>
                  <Separator />
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Símbolo</span>
                    <span className="font-mono text-right">{selectedSymbol || defaultSymbol}</span>

                    <span className="text-muted-foreground">Direção</span>
                    <span className={`text-right font-medium ${orderForm.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                      {orderForm.side === 'buy' ? t('trading.orders.buying') : t('trading.orders.selling')}
                    </span>

                    <span className="text-muted-foreground">{t('trading.orders.form.orderType')}</span>
                    <span className="text-right">
                      {orderForm.orderType === 'market' ? t('trading.orders.form.market') : t('trading.orders.form.limit')}
                    </span>

                    {orderForm.size ? (
                      <>
                        <span className="text-muted-foreground">Quantidade</span>
                        <span className="font-mono text-right">
                          {orderForm.size} {isFuturesMarket ? t('trading.orders.contracts') : t('trading.orders.amount')}
                        </span>
                      </>
                    ) : null}

                    <span className="text-muted-foreground">{t('trading.orders.form.price')}</span>
                    <span className="font-mono text-right">
                      {orderForm.orderType === 'market'
                        ? `~$${formatNumber(currentPrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${t('trading.orders.form.marketPrice')})`
                        : `$${formatNumber(orderEffectivePrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </span>

                    {isFuturesMarket && orderForm.usdtAmount ? (
                      <>
                        <span className="text-muted-foreground">Valor Estimado</span>
                        <span className="font-mono text-right font-medium">
                          ~${formatNumber(parseLocaleNumberInput(orderForm.usdtAmount) ?? 0, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                        </span>
                      </>
                    ) : null}

                    {!isFuturesMarket && orderForm.funds ? (
                      <>
                        <span className="text-muted-foreground">{t('trading.orders.form.funds')}</span>
                        <span className="font-mono text-right">${orderForm.funds}</span>
                      </>
                    ) : null}

                    {isFuturesMarket ? (
                      <>
                        <span className="text-muted-foreground">{t('trading.orders.form.leverage')}</span>
                        <span className="text-right">{orderForm.leverage}x</span>

                        {orderForm.usdtAmount ? (
                          <>
                            <span className="text-muted-foreground">Margem Requerida</span>
                            <span className="font-mono text-right">
                              ~${formatNumber((parseLocaleNumberInput(orderForm.usdtAmount) ?? 0) / Math.max(orderLeverageValue, 1), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                            </span>
                          </>
                        ) : null}
                      </>
                    ) : null}

                    {orderForm.stopLoss ? (
                      <>
                        <span className="text-muted-foreground">{t('trading.orders.form.stopLoss')}</span>
                        <span className="font-mono text-right text-red-500">
                          {orderStopLossValue !== null ? `$${formatNumber(orderStopLossValue, locale, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}` : orderForm.stopLoss}
                        </span>
                        {orderStopLossEstimate ? (
                          <>
                            <span className="text-muted-foreground">Estimativa SL</span>
                            <span className={`font-mono text-right ${orderStopLossEstimate.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {orderStopLossEstimate.pnlValue >= 0 ? '+' : ''}${formatNumber(orderStopLossEstimate.pnlValue, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({orderStopLossEstimate.pnlPct >= 0 ? '+' : ''}{orderStopLossEstimate.pnlPct.toFixed(2)}%)
                            </span>
                          </>
                        ) : null}
                      </>
                    ) : null}

                    {orderForm.takeProfit ? (
                      <>
                        <span className="text-muted-foreground">{t('trading.orders.form.takeProfit')}</span>
                        <span className="font-mono text-right text-green-500">
                          {orderTakeProfitValue !== null ? `$${formatNumber(orderTakeProfitValue, locale, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}` : orderForm.takeProfit}
                        </span>
                        {orderTakeProfitEstimate ? (
                          <>
                            <span className="text-muted-foreground">Estimativa TP</span>
                            <span className={`font-mono text-right ${orderTakeProfitEstimate.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {orderTakeProfitEstimate.pnlValue >= 0 ? '+' : ''}${formatNumber(orderTakeProfitEstimate.pnlValue, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({orderTakeProfitEstimate.pnlPct >= 0 ? '+' : ''}{orderTakeProfitEstimate.pnlPct.toFixed(2)}%)
                            </span>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!canSubmitOrder || isSubmitting}
            className={`font-bold ${orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4 mr-2" />
            )}
            {t('trading.orders.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

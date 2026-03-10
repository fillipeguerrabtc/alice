import { CheckCircle, Loader2, Shield } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';

type TradingRiskForm = {
  maxPositionSize: string;
  maxDailyLoss: string;
  maxOrderValue: string;
  maxLeverage: number;
  maxOpenPositions: number;
  defaultLeverage: number;
  defaultSymbol: string;
  defaultMarketType: 'futures' | 'spot' | 'margin';
  marginMode: 'cross' | 'isolated';
  tradingEnabled: boolean;
};

type TradingRiskConfigDialogProps = {
  isSubmitting: boolean;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
  onPatchForm: (patch: Partial<TradingRiskForm>) => void;
  onSubmit: () => void;
  open: boolean;
  riskForm: TradingRiskForm;
  symbolOptions: string[];
  t: TFunction;
};

export function TradingRiskConfigDialog({
  isSubmitting,
  onCancel,
  onOpenChange,
  onPatchForm,
  onSubmit,
  open,
  riskForm,
  symbolOptions,
  t,
}: TradingRiskConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[85vh] max-h-[85vh] overflow-hidden flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('trading.riskConfig.title')}
          </DialogTitle>
          <DialogDescription>
            {t('trading.riskConfig.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.controls')}</h4>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t('trading.riskConfig.tradingEnabled')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('trading.riskConfig.tradingEnabledDesc')}
                  </p>
                </div>
                <Switch
                  checked={riskForm.tradingEnabled}
                  onCheckedChange={(checked) => onPatchForm({ tradingEnabled: checked })}
                  data-testid="switch-trading-enabled"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.limits')}</h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxPositionSize')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxPositionSize}
                      onChange={(event) => onPatchForm({ maxPositionSize: event.target.value })}
                      className="pr-8"
                      data-testid="input-max-position-size"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxDailyLoss')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxDailyLoss}
                      onChange={(event) => onPatchForm({ maxDailyLoss: event.target.value })}
                      className="pr-8"
                      data-testid="input-max-daily-loss"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxOrderValue')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxOrderValue}
                      onChange={(event) => onPatchForm({ maxOrderValue: event.target.value })}
                      className="pl-8"
                      data-testid="input-max-order-value"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxLeverage')}</Label>
                  <Select
                    value={riskForm.maxLeverage.toString()}
                    onValueChange={(value) => onPatchForm({ maxLeverage: parseInt(value, 10) })}
                  >
                    <SelectTrigger data-testid="select-max-leverage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50, 100].map((lev) => (
                        <SelectItem key={lev} value={lev.toString()}>
                          {lev}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxOpenPositions')}</Label>
                  <Input
                    type="number"
                    value={riskForm.maxOpenPositions}
                    onChange={(event) => onPatchForm({ maxOpenPositions: parseInt(event.target.value, 10) || 1 })}
                    min={1}
                    max={10}
                    data-testid="input-max-open-positions"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.defaults')}</h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultLeverage')}</Label>
                  <Select
                    value={riskForm.defaultLeverage.toString()}
                    onValueChange={(value) => onPatchForm({ defaultLeverage: parseInt(value, 10) })}
                  >
                    <SelectTrigger data-testid="select-default-leverage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5, 10, 20].map((lev) => (
                        <SelectItem key={lev} value={lev.toString()} disabled={lev > riskForm.maxLeverage}>
                          {lev}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultSymbol')}</Label>
                  <Select
                    value={riskForm.defaultSymbol}
                    onValueChange={(value) => onPatchForm({ defaultSymbol: value })}
                    disabled={symbolOptions.length === 0}
                  >
                    <SelectTrigger data-testid="select-default-symbol">
                      <SelectValue placeholder={t('trading.riskConfig.defaultSymbolPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {symbolOptions.map((symbol) => (
                        <SelectItem key={symbol} value={symbol}>
                          {symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultMarketType')}</Label>
                  <Select
                    value={riskForm.defaultMarketType}
                    onValueChange={(value: 'futures' | 'spot' | 'margin') =>
                      onPatchForm({ defaultMarketType: value })
                    }
                  >
                    <SelectTrigger data-testid="select-default-market-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="futures">{t('trading.marketType.futures')}</SelectItem>
                      <SelectItem value="spot">{t('trading.marketType.spot')}</SelectItem>
                      <SelectItem value="margin">{t('trading.marketType.margin')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.marginMode')}</Label>
                  <Select
                    value={riskForm.marginMode}
                    onValueChange={(value: 'cross' | 'isolated') => onPatchForm({ marginMode: value })}
                    disabled={riskForm.defaultMarketType !== 'margin'}
                  >
                    <SelectTrigger data-testid="select-default-margin-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cross">{t('trading.marginMode.cross')}</SelectItem>
                      <SelectItem value="isolated">{t('trading.marginMode.isolated')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

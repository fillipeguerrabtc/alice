import { FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TradingReviewOrderForm = {
  orderType: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  size: string;
  price: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
};

type TradingReviewOrderDialogProps = {
  form: TradingReviewOrderForm;
  hasTarget: boolean;
  isApproving: boolean;
  isUpdating: boolean;
  onApproveAndExecute: () => void;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  onSaveAdjustments: () => void;
  onUpdateField: (field: keyof TradingReviewOrderForm, value: string) => void;
  open: boolean;
};

export function TradingReviewOrderDialog({
  form,
  hasTarget,
  isApproving,
  isUpdating,
  onApproveAndExecute,
  onClose,
  onOpenChange,
  onSaveAdjustments,
  onUpdateField,
  open,
}: TradingReviewOrderDialogProps) {
  const isMarketLikeOrder =
    form.orderType === 'market' || form.orderType === 'stop_market' || form.orderType === 'take_profit';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Revisar Ordem
          </DialogTitle>
          <DialogDescription>
            Ajuste os parâmetros antes da execução na KuCoin.
          </DialogDescription>
        </DialogHeader>

        {hasTarget ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={form.orderType}
                  onValueChange={(value) => onUpdateField('orderType', value)}
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
              <div className="space-y-2">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  value={form.size}
                  onChange={(event) => onUpdateField('size', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Preço</Label>
                <Input
                  type="number"
                  value={form.price}
                  onChange={(event) => onUpdateField('price', event.target.value)}
                  placeholder="Mercado"
                  disabled={isMarketLikeOrder}
                />
              </div>
              <div className="space-y-2">
                <Label>Alavancagem</Label>
                <Input
                  type="number"
                  value={form.leverage}
                  onChange={(event) => onUpdateField('leverage', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Stop Loss</Label>
                <Input
                  type="number"
                  value={form.stopLoss}
                  onChange={(event) => onUpdateField('stopLoss', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Take Profit</Label>
                <Input
                  type="number"
                  value={form.takeProfit}
                  onChange={(event) => onUpdateField('takeProfit', event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Nenhuma ordem selecionada." className="py-2 [&>p]:text-sm" />
        )}

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {hasTarget ? (
            <>
              <Button
                variant="secondary"
                onClick={onSaveAdjustments}
                disabled={isUpdating}
              >
                Salvar ajustes
              </Button>
              <Button
                onClick={onApproveAndExecute}
                disabled={isApproving}
              >
                Aprovar e Executar
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

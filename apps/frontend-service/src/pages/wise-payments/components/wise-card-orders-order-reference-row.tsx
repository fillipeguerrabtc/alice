import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type WiseCardOrdersOrderReferenceRowProps = {
  cardOrderId: string;
  onFetchCardOrderDetails: () => void;
  onFetchCardOrderRequirements: () => void;
  setCardOrderId: (value: string) => void;
  t: TFunction;
};

export function WiseCardOrdersOrderReferenceRow({
  cardOrderId,
  onFetchCardOrderDetails,
  onFetchCardOrderRequirements,
  setCardOrderId,
  t,
}: WiseCardOrdersOrderReferenceRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t('wise.cardOrders.orderId')}</Label>
        <Input
          value={cardOrderId}
          onChange={(event) => setCardOrderId(event.target.value)}
          data-testid="input-card-order-id"
        />
      </div>
      <div className="flex items-end gap-2">
        <Button variant="outline" onClick={onFetchCardOrderDetails} data-testid="button-card-order-details">
          {t('wise.cardOrders.fetchDetails')}
        </Button>
        <Button
          variant="outline"
          onClick={onFetchCardOrderRequirements}
          data-testid="button-card-order-requirements"
        >
          {t('wise.cardOrders.fetchRequirements')}
        </Button>
      </div>
    </div>
  );
}

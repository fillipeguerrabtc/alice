import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type WiseCardOrdersActionsFooterProps = {
  cardOrderAvailability: string | null;
  cardOrderDetails: string | null;
  cardOrderRequirements: string | null;
  isPendingCardOrderAvailability: boolean;
  onFetchCardOrderAvailability: () => void;
  t: TFunction;
};

export function WiseCardOrdersActionsFooter({
  cardOrderAvailability,
  cardOrderDetails,
  cardOrderRequirements,
  isPendingCardOrderAvailability,
  onFetchCardOrderAvailability,
  t,
}: WiseCardOrdersActionsFooterProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onFetchCardOrderAvailability}
          disabled={isPendingCardOrderAvailability}
          data-testid="button-card-order-availability"
        >
          {t('wise.cardOrders.fetchAvailability')}
        </Button>
      </div>

      <div className="space-y-2">
        <Label>{t('wise.cardOrders.response')}</Label>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
          {cardOrderDetails || cardOrderRequirements || cardOrderAvailability || t('wise.cardOrders.responseEmpty')}
        </pre>
      </div>
    </>
  );
}

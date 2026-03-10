import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { TFunction } from 'i18next';

type WiseCardOrdersCreateCardProps = {
  cardOrderPayload: string;
  isPendingCardOrderCreate: boolean;
  onCreateCardOrder: () => void;
  setCardOrderPayload: (value: string) => void;
  t: TFunction;
};

export function WiseCardOrdersCreateCard({
  cardOrderPayload,
  isPendingCardOrderCreate,
  onCreateCardOrder,
  setCardOrderPayload,
  t,
}: WiseCardOrdersCreateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.cardOrders.createTitle')}</CardTitle>
        <CardDescription>{t('wise.cardOrders.createSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={cardOrderPayload}
          onChange={(event) => setCardOrderPayload(event.target.value)}
          rows={6}
          placeholder="{ }"
          data-testid="textarea-card-order-payload"
        />
        <Button onClick={onCreateCardOrder} disabled={isPendingCardOrderCreate} data-testid="button-create-card-order">
          <Plus className="h-4 w-4 mr-2" />
          {t('wise.cardOrders.create')}
        </Button>
      </CardContent>
    </Card>
  );
}

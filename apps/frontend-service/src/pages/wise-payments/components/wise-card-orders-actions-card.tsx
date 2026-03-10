import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WiseCardOrdersActionsCardProps } from './wise-card-orders-actions-card-types';
import { WiseCardOrdersActionsFooter } from './wise-card-orders-actions-footer';
import { WiseCardOrdersJsonActionBlock } from './wise-card-orders-json-action-block';
import { WiseCardOrdersOrderReferenceRow } from './wise-card-orders-order-reference-row';

export function WiseCardOrdersActionsCard({
  cardOrderAvailability,
  cardOrderDetails,
  cardOrderId,
  cardOrderPinPayload,
  cardOrderRequirements,
  cardOrderStatusPayload,
  cardOrderValidationPayload,
  isPendingCardOrderAvailability,
  isPendingCardOrderPin,
  isPendingCardOrderStatusUpdate,
  isPendingCardOrderValidateAddress,
  onFetchCardOrderAvailability,
  onFetchCardOrderDetails,
  onFetchCardOrderRequirements,
  onSetCardOrderPin,
  onUpdateCardOrderStatus,
  onValidateCardOrderAddress,
  setCardOrderId,
  setCardOrderPinPayload,
  setCardOrderStatusPayload,
  setCardOrderValidationPayload,
  t,
}: WiseCardOrdersActionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.cardOrders.actionsTitle')}</CardTitle>
        <CardDescription>{t('wise.cardOrders.actionsSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <WiseCardOrdersOrderReferenceRow
          cardOrderId={cardOrderId}
          onFetchCardOrderDetails={onFetchCardOrderDetails}
          onFetchCardOrderRequirements={onFetchCardOrderRequirements}
          setCardOrderId={setCardOrderId}
          t={t}
        />

        <WiseCardOrdersJsonActionBlock
          buttonLabelKey="wise.cardOrders.updateStatus"
          isPending={isPendingCardOrderStatusUpdate}
          labelKey="wise.cardOrders.statusPayload"
          onSubmit={onUpdateCardOrderStatus}
          setValue={setCardOrderStatusPayload}
          t={t}
          testIdButton="button-card-order-status"
          testIdTextarea="textarea-card-order-status"
          value={cardOrderStatusPayload}
        />

        <WiseCardOrdersJsonActionBlock
          buttonLabelKey="wise.cardOrders.validateAddress"
          isPending={isPendingCardOrderValidateAddress}
          labelKey="wise.cardOrders.addressPayload"
          onSubmit={onValidateCardOrderAddress}
          setValue={setCardOrderValidationPayload}
          t={t}
          testIdButton="button-card-order-validate"
          testIdTextarea="textarea-card-order-address"
          value={cardOrderValidationPayload}
        />

        <WiseCardOrdersJsonActionBlock
          buttonLabelKey="wise.cardOrders.setPin"
          isPending={isPendingCardOrderPin}
          labelKey="wise.cardOrders.pinPayload"
          onSubmit={onSetCardOrderPin}
          setValue={setCardOrderPinPayload}
          t={t}
          testIdButton="button-card-order-pin"
          testIdTextarea="textarea-card-order-pin"
          value={cardOrderPinPayload}
        />

        <WiseCardOrdersActionsFooter
          cardOrderAvailability={cardOrderAvailability}
          cardOrderDetails={cardOrderDetails}
          cardOrderRequirements={cardOrderRequirements}
          isPendingCardOrderAvailability={isPendingCardOrderAvailability}
          onFetchCardOrderAvailability={onFetchCardOrderAvailability}
          t={t}
        />
      </CardContent>
    </Card>
  );
}

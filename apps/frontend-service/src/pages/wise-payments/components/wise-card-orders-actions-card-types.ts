import type { TFunction } from 'i18next';

export type WiseCardOrdersActionsCardProps = {
  cardOrderAvailability: string | null;
  cardOrderDetails: string | null;
  cardOrderId: string;
  cardOrderPinPayload: string;
  cardOrderRequirements: string | null;
  cardOrderStatusPayload: string;
  cardOrderValidationPayload: string;
  isPendingCardOrderAvailability: boolean;
  isPendingCardOrderPin: boolean;
  isPendingCardOrderStatusUpdate: boolean;
  isPendingCardOrderValidateAddress: boolean;
  onFetchCardOrderAvailability: () => void;
  onFetchCardOrderDetails: () => void;
  onFetchCardOrderRequirements: () => void;
  onSetCardOrderPin: () => void;
  onUpdateCardOrderStatus: () => void;
  onValidateCardOrderAddress: () => void;
  setCardOrderId: (value: string) => void;
  setCardOrderPinPayload: (value: string) => void;
  setCardOrderStatusPayload: (value: string) => void;
  setCardOrderValidationPayload: (value: string) => void;
  t: TFunction;
};

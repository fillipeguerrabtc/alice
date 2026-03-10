import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type CardOrdersPageState = {
  pageNumber: string;
  pageSize: string;
};

export type WiseCardOrder = {
  cardType?: string;
  created?: string;
  id?: string;
  status?: string;
};

export type WiseCardOrdersTabContentProps = {
  cardOrderAvailability: string | null;
  cardOrderDetails: string | null;
  cardOrderId: string;
  cardOrderPayload: string;
  cardOrderPinPayload: string;
  cardOrderRequirements: string | null;
  cardOrderStatusPayload: string;
  cardOrderValidationPayload: string;
  cardOrders: WiseCardOrder[];
  cardOrdersPage: CardOrdersPageState;
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  isLoadingCardOrders: boolean;
  isPendingCardOrderAvailability: boolean;
  isPendingCardOrderCreate: boolean;
  isPendingCardOrderPin: boolean;
  isPendingCardOrderStatusUpdate: boolean;
  isPendingCardOrderValidateAddress: boolean;
  locale: string;
  onCreateCardOrder: () => void;
  onFetchCardOrderAvailability: () => void;
  onFetchCardOrderDetails: () => void;
  onFetchCardOrderRequirements: () => void;
  onRefreshCardOrders: () => void;
  onSetCardOrderPin: () => void;
  onUpdateCardOrderStatus: () => void;
  onValidateCardOrderAddress: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setCardOrderId: (value: string) => void;
  setCardOrderPayload: (value: string) => void;
  setCardOrderPinPayload: (value: string) => void;
  setCardOrdersPage: (updater: (prev: CardOrdersPageState) => CardOrdersPageState) => void;
  setCardOrderStatusPayload: (value: string) => void;
  setCardOrderValidationPayload: (value: string) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
  timeZone: string;
};

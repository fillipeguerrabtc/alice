import type { TFunction } from 'i18next';

export type CurrencyOption = {
  code: string;
  name: string;
};

export type WiseRecipient = {
  id: number;
  accountHolderName: string;
  type: string;
  currency: string;
};

export type WiseRecipientsTabContentProps = {
  cardPermissionPayload: string;
  cardPermissionResult: string | null;
  cardPermissionToken: string;
  cardPermissionsPayload: string;
  cardPermissionsResult: string | null;
  cardSecureDetailsResult: string | null;
  cardSecureKeyResult: string | null;
  cardSecurePayload: string;
  cardSecurePinPayload: string;
  cardSecurePinResult: string | null;
  cardSecureToken: string;
  currencies: CurrencyOption[];
  isLoadingRecipients: boolean;
  onDeleteRecipient: (recipientId: number) => void;
  onFetchCardPermissions: () => void;
  onFetchCardSecureDetails: () => void;
  onFetchCardSecureKey: () => void;
  onFetchCardSecurePin: () => void;
  onUpdateCardPermissions: () => void;
  onUpdateCardPermissionsBulk: () => void;
  recipients: WiseRecipient[];
  setCardPermissionPayload: (value: string) => void;
  setCardPermissionToken: (value: string) => void;
  setCardPermissionsPayload: (value: string) => void;
  setCardSecurePayload: (value: string) => void;
  setCardSecurePinPayload: (value: string) => void;
  setCardSecureToken: (value: string) => void;
  setShowNewRecipientDialog: (open: boolean) => void;
  showNewRecipientDialog: boolean;
  t: TFunction;
};

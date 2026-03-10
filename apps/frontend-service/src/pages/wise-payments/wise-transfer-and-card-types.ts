import type { TFunction } from 'i18next';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type JsonParser = (
  raw: string,
  errorTitle: string
) => Record<string, unknown> | null;

export type UseWiseTransferAndCardActionsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  t: TFunction;
};

export type UseWiseTransferAndCardActionsResult = {
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
  handleCancelTransfer: () => Promise<void>;
  handleFetchCardPermissions: () => Promise<void>;
  handleFetchCardSecureDetails: () => Promise<void>;
  handleFetchCardSecureKey: () => Promise<void>;
  handleFetchCardSecurePin: () => Promise<void>;
  handleFundTransfer: () => Promise<void>;
  handleUpdateCardPermissions: () => Promise<void>;
  handleUpdateCardPermissionsBulk: () => Promise<void>;
  setCardPermissionPayload: (value: string) => void;
  setCardPermissionToken: (value: string) => void;
  setCardPermissionsPayload: (value: string) => void;
  setCardSecurePayload: (value: string) => void;
  setCardSecurePinPayload: (value: string) => void;
  setCardSecureToken: (value: string) => void;
  setTransferActionId: (value: string) => void;
  transferActionId: string;
  transferActionResult: string | null;
};

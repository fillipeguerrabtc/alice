import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseAccountDetail = {
  accountHolderName?: string;
  currency?: string;
  id?: number;
};

export type RecipientRequirementsForm = {
  sourceAmount: string;
  sourceCurrency: string;
  targetCurrency: string;
};

export type WiseAccountDetailsTabContentProps = {
  accountDetails: WiseAccountDetail[];
  accountDetailsOrders: Record<string, unknown>[];
  accountDetailsPayload: string;
  accountDetailsResponse: string | null;
  isCreatingAccountDetailsOrder: boolean;
  isLoadingAccountDetails: boolean;
  isLoadingAccountDetailsOrders: boolean;
  onCreateAccountDetailsOrder: () => void;
  onFetchRecipientRequirements: () => void;
  onRecipientRequirementsFieldChange: (field: keyof RecipientRequirementsForm, value: string) => void;
  onRefreshAccountDetails: () => void;
  onRefreshAccountDetailsOrders: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  recipientRequirementsForm: RecipientRequirementsForm;
  recipientRequirementsResult: string | null;
  setAccountDetailsPayload: (value: string) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
};

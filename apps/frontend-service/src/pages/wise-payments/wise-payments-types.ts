export interface WiseBalance {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount?: {
    value: number;
    currency: string;
  };
  totalWorth?: {
    value: number;
    currency: string;
  };
}

export interface WiseTransfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount: number;
  quote: number;
  status: string;
  reference: string;
  rate: number;
  created: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceValue: number;
  targetValue: number;
  customerTransactionId: string;
}

export interface WiseProfile {
  id: number;
  type: string;
  details?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
}

export interface WiseRecipient {
  id: number;
  business: number | null;
  profile: number;
  accountHolderName: string;
  type: string;
  country: string;
  currency: string;
  active: boolean;
}

export interface WiseCard {
  cardToken: string;
  status: string;
  type?: string;
  profileId?: number;
  lastFourDigits?: string;
  expiryDate?: string;
  nameOnCard?: string;
}

export interface WiseCardOrder {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
  cardType?: string;
}

export interface WiseAccountDetail {
  id?: number;
  profileId?: number;
  currency?: string;
  accountHolderName?: string;
}

export interface WiseSpendControl {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  maxAmount?: number;
  period?: string;
  cardToken?: string;
}

export interface WiseDispute {
  id?: string;
  status?: string;
  reason?: string;
  scheme?: string;
  created?: string;
  updated?: string;
}

export interface WiseKycReview {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
}

export interface WiseBatchGroup {
  id: string;
  name: string;
  status: string;
  sourceCurrency: string;
  version: number;
  created: string;
}

export interface WiseStatus {
  configured: boolean;
  sandbox: boolean;
  profileId: string | null;
}

export interface WiseBalancesResponse {
  balances: WiseBalance[];
  sandbox: boolean;
}

export interface WiseTransfersResponse {
  transfers: WiseTransfer[];
}

export interface WiseRecipientsResponse {
  recipients: WiseRecipient[];
}

export interface WiseBatchGroupsResponse {
  batchGroups: WiseBatchGroup[];
}

export interface WiseProfilesResponse {
  profiles: WiseProfile[];
}

export interface WiseCardsResponse {
  cards: WiseCard[];
}

export interface WiseCardOrdersResponse {
  orders: { content?: WiseCardOrder[] } & Record<string, unknown>;
}

export interface WiseAccountDetailsResponse {
  details: WiseAccountDetail[];
}

export interface WiseAccountDetailsOrdersResponse {
  orders: Record<string, unknown>[];
}

export interface WiseSpendControlsResponse {
  rules: WiseSpendControl[];
}

export interface WiseDisputesResponse {
  disputes: WiseDispute[];
}

export interface WiseKycReviewsResponse {
  reviews: WiseKycReview[];
}

export interface WiseUserMeResponse {
  user: Record<string, unknown>;
}

export interface WiseDisputeReasonsResponse {
  reasons: Record<string, unknown>;
}

export type WiseCardOrdersPage = {
  pageNumber: string;
  pageSize: string;
};

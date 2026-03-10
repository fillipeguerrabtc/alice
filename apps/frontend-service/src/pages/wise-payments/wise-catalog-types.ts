import type {
  WiseCatalogOperation,
  WiseCatalogParamKey,
} from './wise-catalog-operations';

export type { WiseCatalogOperation, WiseCatalogParamKey };

export type WiseCatalogParams = {
  profileId: string;
  cardToken: string;
  disputeId: string;
  transferId: string;
  kycReviewId: string;
  subscriptionId: string;
  action: string;
  ruleId: string;
  application: string;
};

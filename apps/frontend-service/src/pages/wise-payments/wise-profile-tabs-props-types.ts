import type { TFunction } from 'i18next';
import type { WisePaymentsTabsContentProps } from './components/wise-payments-tabs-content';
import type { useWiseAccountCardDisputeActions } from './use-wise-account-card-dispute-actions';
import type { useWiseCardSpendActions } from './use-wise-card-spend-actions';
import type { useWiseDataQueries } from './use-wise-data-queries';
import type { useWiseDerivedData } from './use-wise-derived-data';
import type { useWiseFileUploadState } from './use-wise-file-upload-state';
import type { useWiseReferenceActions } from './use-wise-reference-actions';
import type { useWiseRefreshActions } from './use-wise-refresh-actions';
import type { useWiseWebhookSimulationScaActions } from './use-wise-webhook-simulation-sca-actions';

export type ProfileScopedTabProps = {
  profileFilter: ReturnType<typeof useWiseDataQueries>['profileFilter'];
  profiles: ReturnType<typeof useWiseDerivedData>['profiles'];
  setProfileFilter: ReturnType<typeof useWiseDataQueries>['setProfileFilter'];
};

export type BuildWiseProfileTabsPropsOptions = {
  accountCardDisputeActions: ReturnType<typeof useWiseAccountCardDisputeActions>;
  cardSpendActions: ReturnType<typeof useWiseCardSpendActions>;
  dataQueries: ReturnType<typeof useWiseDataQueries>;
  derivedData: ReturnType<typeof useWiseDerivedData>;
  fileUploadState: ReturnType<typeof useWiseFileUploadState>;
  locale: string;
  profileScopedTabProps: ProfileScopedTabProps;
  referenceActions: ReturnType<typeof useWiseReferenceActions>;
  refreshActions: ReturnType<typeof useWiseRefreshActions>;
  t: TFunction;
  timeZone: string;
  webhookSimulationScaActions: ReturnType<typeof useWiseWebhookSimulationScaActions>;
};

export type WiseProfileTabsProps = Pick<
  WisePaymentsTabsContentProps,
  | 'accountDetailsTabProps'
  | 'cardsTabProps'
  | 'cardOrdersTabProps'
  | 'cardTransactionsTabProps'
  | 'spendControlsTabProps'
  | 'disputesTabProps'
  | 'kycTabProps'
  | 'webhooksTabProps'
  | 'simulationsTabProps'
  | 'scaTabProps'
>;

export type WiseProfileCoreTabsProps = Pick<
  WiseProfileTabsProps,
  | 'accountDetailsTabProps'
  | 'cardsTabProps'
  | 'cardOrdersTabProps'
  | 'cardTransactionsTabProps'
  | 'spendControlsTabProps'
>;

export type WiseProfileComplianceTabsProps = Pick<
  WiseProfileTabsProps,
  | 'disputesTabProps'
  | 'kycTabProps'
  | 'webhooksTabProps'
  | 'simulationsTabProps'
  | 'scaTabProps'
>;

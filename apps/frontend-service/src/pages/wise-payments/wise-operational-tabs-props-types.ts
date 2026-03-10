import type { TFunction } from 'i18next';
import type { WisePaymentsTabsContentProps } from './components/wise-payments-tabs-content';
import type { useWiseBalanceExchangeStatementActions } from './use-wise-balance-exchange-statement-actions';
import type { useWiseCardSpendActions } from './use-wise-card-spend-actions';
import type { useWiseCatalogWorkbench } from './use-wise-catalog-workbench';
import type { useWiseDataQueries } from './use-wise-data-queries';
import type { useWiseDerivedData } from './use-wise-derived-data';
import type { useWiseRecipientActions } from './use-wise-recipient-actions';
import type { useWiseReferenceActions } from './use-wise-reference-actions';
import type { useWiseRefreshActions } from './use-wise-refresh-actions';
import type { useWiseTransferAndCardActions } from './use-wise-transfer-and-card-actions';
import type { useWiseUserActivityActions } from './use-wise-user-activity-actions';

export type BuildWiseOperationalTabsPropsOptions = {
  balanceExchangeStatementActions: ReturnType<typeof useWiseBalanceExchangeStatementActions>;
  cardSpendActions: ReturnType<typeof useWiseCardSpendActions>;
  catalogWorkbench: ReturnType<typeof useWiseCatalogWorkbench>;
  dataQueries: ReturnType<typeof useWiseDataQueries>;
  derivedData: ReturnType<typeof useWiseDerivedData>;
  locale: string;
  recipientActions: ReturnType<typeof useWiseRecipientActions>;
  referenceActions: ReturnType<typeof useWiseReferenceActions>;
  refreshActions: ReturnType<typeof useWiseRefreshActions>;
  t: TFunction;
  timeZone: string;
  transferAndCardActions: ReturnType<typeof useWiseTransferAndCardActions>;
  userActivityActions: ReturnType<typeof useWiseUserActivityActions>;
};

export type WiseOperationalTabsProps = Pick<
  WisePaymentsTabsContentProps,
  | 'balancesTabProps'
  | 'exchangeTabProps'
  | 'transfersTabProps'
  | 'recipientsTabProps'
  | 'quotesTabProps'
  | 'batchTabProps'
  | 'statementsTabProps'
  | 'profilesTabProps'
  | 'usersTabProps'
  | 'activitiesTabProps'
  | 'spendLimitsTabProps'
  | 'catalogTabProps'
>;

export type WiseOperationalFinanceTabsProps = Pick<
  WiseOperationalTabsProps,
  | 'balancesTabProps'
  | 'exchangeTabProps'
  | 'transfersTabProps'
  | 'recipientsTabProps'
  | 'quotesTabProps'
  | 'batchTabProps'
  | 'statementsTabProps'
>;

export type WiseOperationalAdminTabsProps = Pick<
  WiseOperationalTabsProps,
  | 'profilesTabProps'
  | 'usersTabProps'
  | 'activitiesTabProps'
  | 'spendLimitsTabProps'
  | 'catalogTabProps'
>;

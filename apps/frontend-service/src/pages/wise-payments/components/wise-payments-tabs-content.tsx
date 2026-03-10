import type { ComponentProps } from 'react';
import { WiseBatchTabContent } from './wise-batch-tab-content';
import { WiseAccountDetailsTabContent } from './wise-account-details-tab-content';
import { WiseBalancesTabContent } from './wise-balances-tab-content';
import { WiseActivitiesTabContent } from './wise-activities-tab-content';
import { WiseCardOrdersTabContent } from './wise-card-orders-tab-content';
import { WiseCardsTabContent } from './wise-cards-tab-content';
import { WiseCardTransactionsTabContent } from './wise-card-transactions-tab-content';
import { WiseCatalogTabContent } from './wise-catalog-tab-content';
import { WiseDisputesTabContent } from './wise-disputes-tab-content';
import { WiseExchangeTabContent } from './wise-exchange-tab-content';
import { WiseKycTabContent } from './wise-kyc-tab-content';
import { WiseProfilesTabContent } from './wise-profiles-tab-content';
import { WiseQuotesTabContent } from './wise-quotes-tab-content';
import { WiseRecipientsTabContent } from './wise-recipients-tab-content';
import { WiseScaTabContent } from './wise-sca-tab-content';
import { WiseSpendControlsTabContent } from './wise-spend-controls-tab-content';
import { WiseSpendLimitsTabContent } from './wise-spend-limits-tab-content';
import { WiseSimulationsTabContent } from './wise-simulations-tab-content';
import { WiseStatementsTabContent } from './wise-statements-tab-content';
import { WiseTransfersTabContent } from './wise-transfers-tab-content';
import { WiseUsersTabContent } from './wise-users-tab-content';
import { WiseWebhooksTabContent } from './wise-webhooks-tab-content';

export type WisePaymentsTabsContentProps = {
  accountDetailsTabProps: ComponentProps<typeof WiseAccountDetailsTabContent>;
  activitiesTabProps: ComponentProps<typeof WiseActivitiesTabContent>;
  balancesTabProps: ComponentProps<typeof WiseBalancesTabContent>;
  batchTabProps: ComponentProps<typeof WiseBatchTabContent>;
  cardOrdersTabProps: ComponentProps<typeof WiseCardOrdersTabContent>;
  cardTransactionsTabProps: ComponentProps<typeof WiseCardTransactionsTabContent>;
  cardsTabProps: ComponentProps<typeof WiseCardsTabContent>;
  catalogTabProps: ComponentProps<typeof WiseCatalogTabContent>;
  disputesTabProps: ComponentProps<typeof WiseDisputesTabContent>;
  exchangeTabProps: ComponentProps<typeof WiseExchangeTabContent>;
  kycTabProps: ComponentProps<typeof WiseKycTabContent>;
  profilesTabProps: ComponentProps<typeof WiseProfilesTabContent>;
  quotesTabProps: ComponentProps<typeof WiseQuotesTabContent>;
  recipientsTabProps: ComponentProps<typeof WiseRecipientsTabContent>;
  scaTabProps: ComponentProps<typeof WiseScaTabContent>;
  simulationsTabProps: ComponentProps<typeof WiseSimulationsTabContent>;
  spendControlsTabProps: ComponentProps<typeof WiseSpendControlsTabContent>;
  spendLimitsTabProps: ComponentProps<typeof WiseSpendLimitsTabContent>;
  statementsTabProps: ComponentProps<typeof WiseStatementsTabContent>;
  transfersTabProps: ComponentProps<typeof WiseTransfersTabContent>;
  usersTabProps: ComponentProps<typeof WiseUsersTabContent>;
  webhooksTabProps: ComponentProps<typeof WiseWebhooksTabContent>;
};

export function WisePaymentsTabsContent({
  accountDetailsTabProps,
  activitiesTabProps,
  balancesTabProps,
  batchTabProps,
  cardOrdersTabProps,
  cardTransactionsTabProps,
  cardsTabProps,
  catalogTabProps,
  disputesTabProps,
  exchangeTabProps,
  kycTabProps,
  profilesTabProps,
  quotesTabProps,
  recipientsTabProps,
  scaTabProps,
  simulationsTabProps,
  spendControlsTabProps,
  spendLimitsTabProps,
  statementsTabProps,
  transfersTabProps,
  usersTabProps,
  webhooksTabProps,
}: WisePaymentsTabsContentProps) {
  return (
    <>
      <WiseBalancesTabContent {...balancesTabProps} />
      <WiseExchangeTabContent {...exchangeTabProps} />
      <WiseAccountDetailsTabContent {...accountDetailsTabProps} />
      <WiseTransfersTabContent {...transfersTabProps} />
      <WiseRecipientsTabContent {...recipientsTabProps} />
      <WiseQuotesTabContent {...quotesTabProps} />
      <WiseBatchTabContent {...batchTabProps} />
      <WiseStatementsTabContent {...statementsTabProps} />
      <WiseProfilesTabContent {...profilesTabProps} />
      <WiseUsersTabContent {...usersTabProps} />
      <WiseActivitiesTabContent {...activitiesTabProps} />
      <WiseCardsTabContent {...cardsTabProps} />
      <WiseCardOrdersTabContent {...cardOrdersTabProps} />
      <WiseCardTransactionsTabContent {...cardTransactionsTabProps} />
      <WiseSpendControlsTabContent {...spendControlsTabProps} />
      <WiseSpendLimitsTabContent {...spendLimitsTabProps} />
      <WiseDisputesTabContent {...disputesTabProps} />
      <WiseKycTabContent {...kycTabProps} />
      <WiseWebhooksTabContent {...webhooksTabProps} />
      <WiseSimulationsTabContent {...simulationsTabProps} />
      <WiseScaTabContent {...scaTabProps} />
      <WiseCatalogTabContent {...catalogTabProps} />
    </>
  );
}

import type { TFunction } from 'i18next';
import type { useToast } from '@/hooks/use-toast';
import { useWiseAccountCardDisputeActions } from './use-wise-account-card-dispute-actions';
import { useWiseBalanceExchangeStatementActions } from './use-wise-balance-exchange-statement-actions';
import { useWiseCardSpendActions } from './use-wise-card-spend-actions';
import { useWiseCatalogWorkbench } from './use-wise-catalog-workbench';
import type { useWiseDataQueries } from './use-wise-data-queries';
import type { useWiseFileUploadState } from './use-wise-file-upload-state';
import { useWiseRecipientActions } from './use-wise-recipient-actions';
import { useWiseReferenceActions } from './use-wise-reference-actions';
import { useWiseSpendControlDefaultCurrency } from './use-wise-spend-control-default-currency';
import { useWiseTransferAndCardActions } from './use-wise-transfer-and-card-actions';
import { useWiseUserActivityActions } from './use-wise-user-activity-actions';
import { useWiseWebhookSimulationScaActions } from './use-wise-webhook-simulation-sca-actions';
import { WISE_CATALOG_OPERATIONS } from './wise-payments-constants';

type ToastFn = ReturnType<typeof useToast>['toast'];

type UseWiseActionsSuiteOptions = {
  dataQueries: ReturnType<typeof useWiseDataQueries>;
  fileUploadState: ReturnType<typeof useWiseFileUploadState>;
  notify: ToastFn;
  parseJsonSafe: (raw: string, errorTitle: string) => Record<string, unknown> | null;
  t: TFunction;
};

export function useWiseActionsSuite({
  dataQueries,
  fileUploadState,
  notify,
  parseJsonSafe,
  t,
}: UseWiseActionsSuiteOptions) {
  const referenceActions = useWiseReferenceActions({
    notify,
    t,
  });

  const catalogWorkbench = useWiseCatalogWorkbench({
    notify,
    operations: WISE_CATALOG_OPERATIONS,
    profileIdDefault: dataQueries.statusData?.profileId,
    t,
  });

  const recipientActions = useWiseRecipientActions({
    notify,
    t,
  });

  const cardSpendActions = useWiseCardSpendActions({
    notify,
    parseJsonSafe,
    profileFilter: dataQueries.profileFilter,
    t,
  });

  useWiseSpendControlDefaultCurrency({
    balances: dataQueries.balancesData?.balances ?? [],
    setSpendControlForm: cardSpendActions.setSpendControlForm,
    spendControlForm: cardSpendActions.spendControlForm,
  });

  const transferAndCardActions = useWiseTransferAndCardActions({
    notify,
    parseJsonSafe,
    profileFilter: dataQueries.profileFilter,
    t,
  });

  const webhookSimulationScaActions = useWiseWebhookSimulationScaActions({
    notify,
    parseJsonSafe,
    profileFilter: dataQueries.profileFilter,
    t,
  });

  const accountCardDisputeActions = useWiseAccountCardDisputeActions({
    disputeUpload: fileUploadState.disputeUpload,
    kycUploadAdditional: fileUploadState.kycUploadAdditional,
    kycUploadDocument: fileUploadState.kycUploadDocument,
    notify,
    parseJsonSafe,
    profileFilter: dataQueries.profileFilter,
    t,
  });

  const userActivityActions = useWiseUserActivityActions({
    notify,
    t,
  });

  const balanceExchangeStatementActions = useWiseBalanceExchangeStatementActions({
    notify,
    t,
  });

  return {
    accountCardDisputeActions,
    balanceExchangeStatementActions,
    cardSpendActions,
    catalogWorkbench,
    recipientActions,
    referenceActions,
    transferAndCardActions,
    userActivityActions,
    webhookSimulationScaActions,
  };
}

import type { useWiseDataQueries } from './use-wise-data-queries';
import { useWiseDerivedData } from './use-wise-derived-data';
import { useWiseRefreshActions } from './use-wise-refresh-actions';

type UseWiseRefreshDerivedOptions = {
  dataQueries: ReturnType<typeof useWiseDataQueries>;
};

export function useWiseRefreshDerived({ dataQueries }: UseWiseRefreshDerivedOptions) {
  const refreshActions = useWiseRefreshActions({
    profileFilter: dataQueries.profileFilter,
    refetchAccountDetails: dataQueries.refetchAccountDetails,
    refetchAccountDetailsOrders: dataQueries.refetchAccountDetailsOrders,
    refetchBalances: dataQueries.refetchBalances,
    refetchBatchGroups: dataQueries.refetchBatchGroups,
    refetchCardOrders: dataQueries.refetchCardOrders,
    refetchCards: dataQueries.refetchCards,
    refetchDisputes: dataQueries.refetchDisputes,
    refetchKycReviews: dataQueries.refetchKycReviews,
    refetchProfiles: dataQueries.refetchProfiles,
    refetchRecipients: dataQueries.refetchRecipients,
    refetchSpendControls: dataQueries.refetchSpendControls,
    refetchTransfers: dataQueries.refetchTransfers,
    refetchWiseUserMe: dataQueries.refetchWiseUserMe,
  });

  const derivedData = useWiseDerivedData({
    accountDetailsData: dataQueries.accountDetailsData,
    accountDetailsOrdersData: dataQueries.accountDetailsOrdersData,
    balancesData: dataQueries.balancesData,
    batchGroupsData: dataQueries.batchGroupsData,
    cardOrdersData: dataQueries.cardOrdersData,
    cardsData: dataQueries.cardsData,
    disputesData: dataQueries.disputesData,
    kycReviewsData: dataQueries.kycReviewsData,
    profilesData: dataQueries.profilesData,
    recipientsData: dataQueries.recipientsData,
    spendControlsData: dataQueries.spendControlsData,
    transfersData: dataQueries.transfersData,
  });

  return {
    derivedData,
    refreshActions,
  };
}

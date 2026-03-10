import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWiseQueryGuard } from './use-wise-query-guard';
import { useWiseGlobalDataQueries } from './use-wise-global-data-queries';
import { useWiseProfileScopedDataQueries } from './use-wise-profile-scoped-data-queries';
import type {
  WiseCardOrdersPage,
  WiseStatus,
} from './wise-payments-types';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type UseWiseDataQueriesOptions = {
  notify: NotifyFn;
};

export function useWiseDataQueries(options: UseWiseDataQueriesOptions) {
  const { notify } = options;
  const [profileFilter, setProfileFilter] = useState('');
  const [cardOrdersPage, setCardOrdersPage] = useState<WiseCardOrdersPage>({ pageNumber: '1', pageSize: '10' });

  const { data: statusData, isLoading: isLoadingStatus } = useQuery<WiseStatus>({
    queryKey: ['/api/integrations/wise/status'],
  });

  const { wiseQueryEnabled, handleWiseQueryError } = useWiseQueryGuard({
    configured: Boolean(statusData?.configured),
    notify,
  });
  const isProfileScopedQueryEnabled = wiseQueryEnabled && Boolean(profileFilter);

  useEffect(() => {
    if (statusData?.profileId && !profileFilter) {
      setProfileFilter(statusData.profileId);
    }
  }, [statusData?.profileId, profileFilter]);

  const {
    balancesData,
    isLoadingBalances,
    refetchBalances,
    balancesError,
    transfersData,
    isLoadingTransfers,
    refetchTransfers,
    transfersError,
    recipientsData,
    isLoadingRecipients,
    refetchRecipients,
    recipientsError,
    batchGroupsData,
    isLoadingBatchGroups,
    refetchBatchGroups,
    batchGroupsError,
    profilesData,
    isLoadingProfiles,
    refetchProfiles,
    profilesError,
    wiseUserMeData,
    isLoadingWiseUserMe,
    refetchWiseUserMe,
    wiseUserMeError,
  } = useWiseGlobalDataQueries({ wiseQueryEnabled });

  const {
    cardsData,
    isLoadingCards,
    refetchCards,
    cardsError,
    spendControlsData,
    isLoadingSpendControls,
    refetchSpendControls,
    spendControlsError,
    disputesData,
    isLoadingDisputes,
    refetchDisputes,
    disputesError,
    kycReviewsData,
    isLoadingKycReviews,
    refetchKycReviews,
    kycReviewsError,
    cardOrdersData,
    isLoadingCardOrders,
    refetchCardOrders,
    cardOrdersError,
    disputeReasonsData,
    isLoadingDisputeReasons,
    disputeReasonsError,
    accountDetailsData,
    isLoadingAccountDetails,
    refetchAccountDetails,
    accountDetailsError,
    accountDetailsOrdersData,
    isLoadingAccountDetailsOrders,
    refetchAccountDetailsOrders,
    accountDetailsOrdersError,
  } = useWiseProfileScopedDataQueries({
    cardOrdersPage,
    isProfileScopedQueryEnabled,
    profileFilter,
  });

  useEffect(() => {
    const firstError = [
      balancesError,
      transfersError,
      recipientsError,
      batchGroupsError,
      profilesError,
      wiseUserMeError,
      cardsError,
      spendControlsError,
      disputesError,
      kycReviewsError,
      cardOrdersError,
      disputeReasonsError,
      accountDetailsError,
      accountDetailsOrdersError,
    ].find(Boolean);

    if (firstError) {
      handleWiseQueryError(firstError);
    }
  }, [
    balancesError,
    transfersError,
    recipientsError,
    batchGroupsError,
    profilesError,
    wiseUserMeError,
    cardsError,
    spendControlsError,
    disputesError,
    kycReviewsError,
    cardOrdersError,
    disputeReasonsError,
    accountDetailsError,
    accountDetailsOrdersError,
    handleWiseQueryError,
  ]);

  return {
    accountDetailsData,
    accountDetailsOrdersData,
    balancesData,
    batchGroupsData,
    cardOrdersData,
    cardOrdersPage,
    cardsData,
    disputeReasonsData,
    disputesData,
    isLoadingAccountDetails,
    isLoadingAccountDetailsOrders,
    isLoadingBalances,
    isLoadingBatchGroups,
    isLoadingCardOrders,
    isLoadingCards,
    isLoadingDisputeReasons,
    isLoadingDisputes,
    isLoadingKycReviews,
    isLoadingProfiles,
    isLoadingRecipients,
    isLoadingSpendControls,
    isLoadingStatus,
    isLoadingTransfers,
    isLoadingWiseUserMe,
    kycReviewsData,
    profileFilter,
    profilesData,
    recipientsData,
    refetchAccountDetails,
    refetchAccountDetailsOrders,
    refetchBalances,
    refetchBatchGroups,
    refetchCardOrders,
    refetchCards,
    refetchDisputes,
    refetchKycReviews,
    refetchProfiles,
    refetchRecipients,
    refetchSpendControls,
    refetchTransfers,
    refetchWiseUserMe,
    setCardOrdersPage,
    setProfileFilter,
    spendControlsData,
    statusData,
    transfersData,
    wiseQueryEnabled,
    wiseUserMeData,
  };
}

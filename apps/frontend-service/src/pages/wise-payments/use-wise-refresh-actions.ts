import { useCallback } from 'react';

type RefetchFn = () => Promise<unknown>;

type UseWiseRefreshActionsOptions = {
  profileFilter: string;
  refetchAccountDetails: RefetchFn;
  refetchAccountDetailsOrders: RefetchFn;
  refetchBalances: RefetchFn;
  refetchBatchGroups: RefetchFn;
  refetchCardOrders: RefetchFn;
  refetchCards: RefetchFn;
  refetchDisputes: RefetchFn;
  refetchKycReviews: RefetchFn;
  refetchProfiles: RefetchFn;
  refetchRecipients: RefetchFn;
  refetchSpendControls: RefetchFn;
  refetchTransfers: RefetchFn;
  refetchWiseUserMe: RefetchFn;
};

export function useWiseRefreshActions(options: UseWiseRefreshActionsOptions) {
  const {
    profileFilter,
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
  } = options;

  const handleRefreshAccountDetails = useCallback(() => {
    void refetchAccountDetails();
  }, [refetchAccountDetails]);

  const handleRefreshAccountDetailsOrders = useCallback(() => {
    void refetchAccountDetailsOrders();
  }, [refetchAccountDetailsOrders]);

  const handleRefreshProfiles = useCallback(() => {
    void refetchProfiles();
  }, [refetchProfiles]);

  const handleRefreshWiseUserMe = useCallback(() => {
    void refetchWiseUserMe();
  }, [refetchWiseUserMe]);

  const handleRefreshCards = useCallback(() => {
    void refetchCards();
  }, [refetchCards]);

  const handleRefreshCardOrders = useCallback(() => {
    void refetchCardOrders();
  }, [refetchCardOrders]);

  const handleRefreshSpendControls = useCallback(() => {
    void refetchSpendControls();
  }, [refetchSpendControls]);

  const handleRefreshDisputes = useCallback(() => {
    void refetchDisputes();
  }, [refetchDisputes]);

  const handleRefreshKycReviews = useCallback(() => {
    void refetchKycReviews();
  }, [refetchKycReviews]);

  const handleRefreshWiseData = useCallback(() => {
    void refetchBalances();
    void refetchTransfers();
    void refetchRecipients();
    void refetchBatchGroups();
    void refetchProfiles();
    if (!profileFilter) return;
    void refetchCards();
    void refetchSpendControls();
    void refetchDisputes();
    void refetchKycReviews();
  }, [
    profileFilter,
    refetchBalances,
    refetchBatchGroups,
    refetchCards,
    refetchDisputes,
    refetchKycReviews,
    refetchProfiles,
    refetchRecipients,
    refetchSpendControls,
    refetchTransfers,
  ]);

  return {
    handleRefreshAccountDetails,
    handleRefreshAccountDetailsOrders,
    handleRefreshCardOrders,
    handleRefreshCards,
    handleRefreshDisputes,
    handleRefreshKycReviews,
    handleRefreshProfiles,
    handleRefreshSpendControls,
    handleRefreshWiseData,
    handleRefreshWiseUserMe,
  };
}

import { useWiseApiQuery } from './use-wise-query-hooks';
import type {
  WiseBalancesResponse,
  WiseBatchGroupsResponse,
  WiseProfilesResponse,
  WiseRecipientsResponse,
  WiseTransfersResponse,
  WiseUserMeResponse,
} from './wise-payments-types';

type UseWiseGlobalDataQueriesOptions = {
  wiseQueryEnabled: boolean;
};

export function useWiseGlobalDataQueries(
  options: UseWiseGlobalDataQueriesOptions
) {
  const { wiseQueryEnabled } = options;

  const {
    data: balancesData,
    isLoading: isLoadingBalances,
    refetch: refetchBalances,
    error: balancesError,
  } = useWiseApiQuery<WiseBalancesResponse>({
    endpoint: '/api/integrations/wise/balances',
    enabled: wiseQueryEnabled,
  });

  const {
    data: transfersData,
    isLoading: isLoadingTransfers,
    refetch: refetchTransfers,
    error: transfersError,
  } = useWiseApiQuery<WiseTransfersResponse>({
    endpoint: '/api/integrations/wise/transfers',
    enabled: wiseQueryEnabled,
  });

  const {
    data: recipientsData,
    isLoading: isLoadingRecipients,
    refetch: refetchRecipients,
    error: recipientsError,
  } = useWiseApiQuery<WiseRecipientsResponse>({
    endpoint: '/api/integrations/wise/recipients',
    enabled: wiseQueryEnabled,
  });

  const {
    data: batchGroupsData,
    isLoading: isLoadingBatchGroups,
    refetch: refetchBatchGroups,
    error: batchGroupsError,
  } = useWiseApiQuery<WiseBatchGroupsResponse>({
    endpoint: '/api/integrations/wise/batch-groups',
    enabled: wiseQueryEnabled,
  });

  const {
    data: profilesData,
    isLoading: isLoadingProfiles,
    refetch: refetchProfiles,
    error: profilesError,
  } = useWiseApiQuery<WiseProfilesResponse>({
    endpoint: '/api/integrations/wise/profiles',
    enabled: wiseQueryEnabled,
  });

  const {
    data: wiseUserMeData,
    isLoading: isLoadingWiseUserMe,
    refetch: refetchWiseUserMe,
    error: wiseUserMeError,
  } = useWiseApiQuery<WiseUserMeResponse>({
    endpoint: '/api/integrations/wise/users/me',
    enabled: wiseQueryEnabled,
  });

  return {
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
  };
}

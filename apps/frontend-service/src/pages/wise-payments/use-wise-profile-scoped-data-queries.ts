import { useWiseProfileScopedQuery } from './use-wise-query-hooks';
import type {
  WiseAccountDetailsOrdersResponse,
  WiseAccountDetailsResponse,
  WiseCardOrdersPage,
  WiseCardOrdersResponse,
  WiseCardsResponse,
  WiseDisputeReasonsResponse,
  WiseDisputesResponse,
  WiseKycReviewsResponse,
  WiseSpendControlsResponse,
} from './wise-payments-types';

type UseWiseProfileScopedDataQueriesOptions = {
  cardOrdersPage: WiseCardOrdersPage;
  isProfileScopedQueryEnabled: boolean;
  profileFilter: string;
};

export function useWiseProfileScopedDataQueries(
  options: UseWiseProfileScopedDataQueriesOptions
) {
  const { cardOrdersPage, isProfileScopedQueryEnabled, profileFilter } = options;

  const {
    data: cardsData,
    isLoading: isLoadingCards,
    refetch: refetchCards,
    error: cardsError,
  } = useWiseProfileScopedQuery<WiseCardsResponse>({
    endpoint: '/api/integrations/wise/cards',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: spendControlsData,
    isLoading: isLoadingSpendControls,
    refetch: refetchSpendControls,
    error: spendControlsError,
  } = useWiseProfileScopedQuery<WiseSpendControlsResponse>({
    endpoint: '/api/integrations/wise/spend-controls',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: disputesData,
    isLoading: isLoadingDisputes,
    refetch: refetchDisputes,
    error: disputesError,
  } = useWiseProfileScopedQuery<WiseDisputesResponse>({
    endpoint: '/api/integrations/wise/disputes',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: kycReviewsData,
    isLoading: isLoadingKycReviews,
    refetch: refetchKycReviews,
    error: kycReviewsError,
  } = useWiseProfileScopedQuery<WiseKycReviewsResponse>({
    endpoint: '/api/integrations/wise/kyc-reviews',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: cardOrdersData,
    isLoading: isLoadingCardOrders,
    refetch: refetchCardOrders,
    error: cardOrdersError,
  } = useWiseProfileScopedQuery<WiseCardOrdersResponse>({
    endpoint: '/api/integrations/wise/card-orders',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
    queryKeyParts: [cardOrdersPage.pageNumber, cardOrdersPage.pageSize],
    queryParams: {
      pageNumber: cardOrdersPage.pageNumber,
      pageSize: cardOrdersPage.pageSize,
    },
  });

  const {
    data: disputeReasonsData,
    isLoading: isLoadingDisputeReasons,
    error: disputeReasonsError,
  } = useWiseProfileScopedQuery<WiseDisputeReasonsResponse>({
    endpoint: '/api/integrations/wise/disputes/reasons',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: accountDetailsData,
    isLoading: isLoadingAccountDetails,
    refetch: refetchAccountDetails,
    error: accountDetailsError,
  } = useWiseProfileScopedQuery<WiseAccountDetailsResponse>({
    endpoint: '/api/integrations/wise/account-details',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  const {
    data: accountDetailsOrdersData,
    isLoading: isLoadingAccountDetailsOrders,
    refetch: refetchAccountDetailsOrders,
    error: accountDetailsOrdersError,
  } = useWiseProfileScopedQuery<WiseAccountDetailsOrdersResponse>({
    endpoint: '/api/integrations/wise/account-details/orders',
    profileFilter,
    enabled: isProfileScopedQueryEnabled,
  });

  return {
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
  };
}

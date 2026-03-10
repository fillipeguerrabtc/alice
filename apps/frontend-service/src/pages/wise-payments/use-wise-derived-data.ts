import { useMemo } from 'react';
import type {
  WiseAccountDetail,
  WiseAccountDetailsOrdersResponse,
  WiseAccountDetailsResponse,
  WiseBalance,
  WiseBalancesResponse,
  WiseBatchGroup,
  WiseBatchGroupsResponse,
  WiseCard,
  WiseCardOrder,
  WiseCardOrdersResponse,
  WiseCardsResponse,
  WiseDispute,
  WiseDisputesResponse,
  WiseKycReviewsResponse,
  WiseProfile,
  WiseProfilesResponse,
  WiseRecipient,
  WiseRecipientsResponse,
  WiseSpendControl,
  WiseSpendControlsResponse,
  WiseTransfer,
  WiseTransfersResponse,
} from './wise-payments-types';

type UseWiseDerivedDataOptions = {
  accountDetailsData?: WiseAccountDetailsResponse;
  accountDetailsOrdersData?: WiseAccountDetailsOrdersResponse;
  balancesData?: WiseBalancesResponse;
  batchGroupsData?: WiseBatchGroupsResponse;
  cardOrdersData?: WiseCardOrdersResponse;
  cardsData?: WiseCardsResponse;
  disputesData?: WiseDisputesResponse;
  kycReviewsData?: WiseKycReviewsResponse;
  profilesData?: WiseProfilesResponse;
  recipientsData?: WiseRecipientsResponse;
  spendControlsData?: WiseSpendControlsResponse;
  transfersData?: WiseTransfersResponse;
};

export function useWiseDerivedData(options: UseWiseDerivedDataOptions) {
  const {
    accountDetailsData,
    accountDetailsOrdersData,
    balancesData,
    batchGroupsData,
    cardOrdersData,
    cardsData,
    disputesData,
    kycReviewsData,
    profilesData,
    recipientsData,
    spendControlsData,
    transfersData,
  } = options;

  return useMemo(() => {
    const balances = (balancesData?.balances || []) as WiseBalance[];
    const transfers = (transfersData?.transfers || []) as WiseTransfer[];
    const recipients = (recipientsData?.recipients || []) as WiseRecipient[];
    const batchGroups = (batchGroupsData?.batchGroups || []) as WiseBatchGroup[];
    const profiles = (profilesData?.profiles || []) as WiseProfile[];
    const cards = (cardsData?.cards || []) as WiseCard[];
    const spendControls = (spendControlsData?.rules || []) as WiseSpendControl[];
    const disputes = (disputesData?.disputes || []) as WiseDispute[];
    const kycReviews = (kycReviewsData?.reviews || []) as WiseKycReviewsResponse['reviews'];
    const cardOrders = (cardOrdersData?.orders?.content || []) as WiseCardOrder[];
    const accountDetails = (accountDetailsData?.details || []) as WiseAccountDetail[];
    const accountDetailsOrders = (accountDetailsOrdersData?.orders || []) as Record<string, unknown>[];
    const balanceCurrencies = Array.from(new Set(balances.map((balance) => balance.currency)));

    return {
      accountDetails,
      accountDetailsOrders,
      balanceCurrencies,
      balances,
      batchGroups,
      cardOrders,
      cards,
      disputes,
      kycReviews,
      profiles,
      recipients,
      spendControls,
      transfers,
    };
  }, [
    accountDetailsData?.details,
    accountDetailsOrdersData?.orders,
    balancesData?.balances,
    batchGroupsData?.batchGroups,
    cardOrdersData?.orders?.content,
    cardsData?.cards,
    disputesData?.disputes,
    kycReviewsData?.reviews,
    profilesData?.profiles,
    recipientsData?.recipients,
    spendControlsData?.rules,
    transfersData?.transfers,
  ]);
}

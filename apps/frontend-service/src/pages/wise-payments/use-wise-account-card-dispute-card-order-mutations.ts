import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';
import { useWiseAccountCardOrderMutations } from './use-wise-account-card-order-mutations';
import { useWiseCardTransactionMutation } from './use-wise-card-transaction-mutation';

type UseWiseAccountCardDisputeCardOrderMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setAccountDetailsResponse: (value: string | null) => void;
  setCardOrderAvailability: (value: string | null) => void;
  setCardOrderDetails: (value: string | null) => void;
  setCardOrderRequirements: (value: string | null) => void;
  setCardTransactionDetails: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardDisputeCardOrderMutations(
  options: UseWiseAccountCardDisputeCardOrderMutationsOptions
) {
  const {
    notify,
    profileFilter,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    setCardTransactionDetails,
    t,
  } = options;

  const accountCardOrderMutations = useWiseAccountCardOrderMutations({
    notify,
    profileFilter,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    t,
  });

  const cardTransactionMutations = useWiseCardTransactionMutation({
    notify,
    profileFilter,
    setCardTransactionDetails,
    t,
  });

  return {
    ...accountCardOrderMutations,
    ...cardTransactionMutations,
  };
}

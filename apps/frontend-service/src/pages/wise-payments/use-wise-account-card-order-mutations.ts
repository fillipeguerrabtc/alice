import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';
import { useWiseAccountDetailsOrderMutation } from './use-wise-account-details-order-mutation';
import { useWiseCardOrderReadMutations } from './use-wise-card-order-read-mutations';
import { useWiseCardOrderWriteMutations } from './use-wise-card-order-write-mutations';

type UseWiseAccountCardOrderMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setAccountDetailsResponse: (value: string | null) => void;
  setCardOrderAvailability: (value: string | null) => void;
  setCardOrderDetails: (value: string | null) => void;
  setCardOrderRequirements: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardOrderMutations(
  options: UseWiseAccountCardOrderMutationsOptions
) {
  const {
    notify,
    profileFilter,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    t,
  } = options;

  const createAccountDetailsOrderMutation = useWiseAccountDetailsOrderMutation({
    notify,
    profileFilter,
    setAccountDetailsResponse,
    t,
  });

  const {
    createCardOrderMutation,
    presetCardOrderPinMutation,
    updateCardOrderStatusMutation,
    validateCardOrderAddressMutation,
  } = useWiseCardOrderWriteMutations({
    notify,
    profileFilter,
    setCardOrderDetails,
    t,
  });

  const {
    getCardOrderAvailabilityMutation,
    getCardOrderDetailsMutation,
    getCardOrderRequirementsMutation,
  } = useWiseCardOrderReadMutations({
    notify,
    profileFilter,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    t,
  });

  return {
    createCardOrderMutation,
    createAccountDetailsOrderMutation,
    updateCardOrderStatusMutation,
    getCardOrderAvailabilityMutation,
    getCardOrderDetailsMutation,
    getCardOrderRequirementsMutation,
    validateCardOrderAddressMutation,
    presetCardOrderPinMutation,
  };
}

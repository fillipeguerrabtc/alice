import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  SpendControlForm,
} from './wise-card-spend-types';
import { useWiseCardStatusMutations } from './use-wise-card-status-mutations';
import { useWiseSpendControlMutations } from './use-wise-spend-control-mutations';
import { useWiseSpendLimitsMutations } from './use-wise-spend-limits-mutations';

type UseWiseCardSpendMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  t: TFunction;
  setSpendControlForm: Dispatch<SetStateAction<SpendControlForm>>;
  setSpendLimitsProfileResult: Dispatch<SetStateAction<string | null>>;
  setSpendLimitsCardResult: Dispatch<SetStateAction<string | null>>;
};

export function useWiseCardSpendMutations(
  options: UseWiseCardSpendMutationsOptions
) {
  const {
    notify,
    profileFilter,
    t,
    setSpendControlForm,
    setSpendLimitsProfileResult,
    setSpendLimitsCardResult,
  } = options;

  const { updateCardStatusMutation } = useWiseCardStatusMutations({
    notify,
    profileFilter,
    t,
  });

  const {
    createSpendControlMutation,
    assignSpendControlMutation,
    deleteSpendControlMutation,
    unassignSpendControlMutation,
  } = useWiseSpendControlMutations({
    notify,
    profileFilter,
    setSpendControlForm,
    t,
  });

  const {
    getSpendLimitsProfileMutation,
    updateSpendLimitsProfileMutation,
    getSpendLimitsCardMutation,
    updateSpendLimitsCardMutation,
    deleteSpendLimitsCardMutation,
  } = useWiseSpendLimitsMutations({
    notify,
    setSpendLimitsCardResult,
    setSpendLimitsProfileResult,
    t,
  });

  return {
    updateCardStatusMutation,
    createSpendControlMutation,
    assignSpendControlMutation,
    deleteSpendControlMutation,
    unassignSpendControlMutation,
    getSpendLimitsProfileMutation,
    updateSpendLimitsProfileMutation,
    getSpendLimitsCardMutation,
    updateSpendLimitsCardMutation,
    deleteSpendLimitsCardMutation,
  };
}

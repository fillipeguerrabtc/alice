import { useState } from 'react';
import {
  INITIAL_SPEND_CONTROL_ASSIGNMENT,
  INITIAL_SPEND_CONTROL_FORM,
  type UseWiseCardSpendActionsOptions,
  type UseWiseCardSpendActionsResult,
} from './wise-card-spend-types';
import { useWiseCardSpendControlHandlers } from './use-wise-card-spend-control-handlers';
import { useWiseCardSpendLimitsHandlers } from './use-wise-card-spend-limits-handlers';
import { useWiseCardSpendMutations } from './use-wise-card-spend-mutations';

export function useWiseCardSpendActions(
  options: UseWiseCardSpendActionsOptions,
): UseWiseCardSpendActionsResult {
  const { notify, parseJsonSafe, profileFilter, t } = options;
  const [cardStatusUpdates, setCardStatusUpdates] = useState<Record<string, string>>({});
  const [spendControlForm, setSpendControlForm] = useState(INITIAL_SPEND_CONTROL_FORM);
  const [spendControlAssignment, setSpendControlAssignment] = useState(INITIAL_SPEND_CONTROL_ASSIGNMENT);
  const [spendControlDeleteId, setSpendControlDeleteId] = useState('');
  const [spendLimitsProfileId, setSpendLimitsProfileId] = useState('');
  const [spendLimitsPayload, setSpendLimitsPayload] = useState('');
  const [spendLimitsCardToken, setSpendLimitsCardToken] = useState('');
  const [spendLimitsCardPayload, setSpendLimitsCardPayload] = useState('');
  const [spendLimitsProfileResult, setSpendLimitsProfileResult] = useState<string | null>(null);
  const [spendLimitsCardResult, setSpendLimitsCardResult] = useState<string | null>(null);
  const [spendLimitsDeleteCardToken, setSpendLimitsDeleteCardToken] = useState('');

  const {
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
  } = useWiseCardSpendMutations({
    notify,
    profileFilter,
    t,
    setSpendControlForm,
    setSpendLimitsProfileResult,
    setSpendLimitsCardResult,
  });

  const {
    handleAssignSpendControl,
    handleCreateSpendControl,
    handleDeleteSpendControl,
    handleUpdateCardStatus,
  } = useWiseCardSpendControlHandlers({
    assignSpendControl: assignSpendControlMutation.mutate,
    cardStatusUpdates,
    createSpendControl: createSpendControlMutation.mutate,
    deleteSpendControl: deleteSpendControlMutation.mutate,
    notify,
    spendControlAssignment,
    spendControlDeleteId,
    spendControlForm,
    t,
    unassignSpendControl: unassignSpendControlMutation.mutate,
    updateCardStatus: updateCardStatusMutation.mutate,
  });

  const {
    handleDeleteSpendLimitsCard,
    handleFetchSpendLimitsCard,
    handleFetchSpendLimitsProfile,
    handleUpdateSpendLimitsCard,
    handleUpdateSpendLimitsProfile,
  } = useWiseCardSpendLimitsHandlers({
    deleteSpendLimitsCard: deleteSpendLimitsCardMutation.mutate,
    getSpendLimitsCard: getSpendLimitsCardMutation.mutate,
    getSpendLimitsProfile: getSpendLimitsProfileMutation.mutate,
    notify,
    parseJsonSafe,
    spendLimitsCardPayload,
    spendLimitsCardToken,
    spendLimitsDeleteCardToken,
    spendLimitsPayload,
    spendLimitsProfileId,
    t,
    updateSpendLimitsCard: updateSpendLimitsCardMutation.mutate,
    updateSpendLimitsProfile: updateSpendLimitsProfileMutation.mutate,
  });

  return {
    cardStatusUpdates,
    handleAssignSpendControl,
    handleCreateSpendControl,
    handleDeleteSpendControl,
    handleDeleteSpendLimitsCard,
    handleFetchSpendLimitsCard,
    handleFetchSpendLimitsProfile,
    handleUpdateCardStatus,
    handleUpdateSpendLimitsCard,
    handleUpdateSpendLimitsProfile,
    isPendingAssignSpendControl: assignSpendControlMutation.isPending,
    isPendingCreateSpendControl: createSpendControlMutation.isPending,
    isPendingDeleteSpendControl: deleteSpendControlMutation.isPending,
    isPendingDeleteSpendLimitsCard: deleteSpendLimitsCardMutation.isPending,
    isPendingUnassignSpendControl: unassignSpendControlMutation.isPending,
    isPendingUpdateCardStatus: updateCardStatusMutation.isPending,
    isPendingUpdateSpendLimitsCard: updateSpendLimitsCardMutation.isPending,
    isPendingUpdateSpendLimitsProfile: updateSpendLimitsProfileMutation.isPending,
    setCardStatusUpdates,
    setSpendControlAssignment,
    setSpendControlDeleteId,
    setSpendControlForm,
    setSpendLimitsCardPayload,
    setSpendLimitsCardToken,
    setSpendLimitsDeleteCardToken,
    setSpendLimitsPayload,
    setSpendLimitsProfileId,
    spendControlAssignment,
    spendControlDeleteId,
    spendControlForm,
    spendLimitsCardPayload,
    spendLimitsCardResult,
    spendLimitsCardToken,
    spendLimitsDeleteCardToken,
    spendLimitsPayload,
    spendLimitsProfileId,
    spendLimitsProfileResult,
  };
}

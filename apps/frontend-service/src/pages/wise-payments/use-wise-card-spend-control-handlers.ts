import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  SpendControlAssignment,
  SpendControlForm,
} from './wise-card-spend-types';

type SpendControlPayload = {
  ruleId: string;
  cardToken: string;
};

type CreateSpendControlPayload = {
  name: string;
  currency: string;
  maxAmount: number;
  period: string;
};

type UseWiseCardSpendControlHandlersOptions = {
  assignSpendControl: (payload: SpendControlPayload) => void;
  cardStatusUpdates: Record<string, string>;
  createSpendControl: (payload: CreateSpendControlPayload) => void;
  deleteSpendControl: (ruleId: string) => void;
  notify: NotifyFn;
  spendControlAssignment: SpendControlAssignment;
  spendControlDeleteId: string;
  spendControlForm: SpendControlForm;
  t: TFunction;
  unassignSpendControl: (payload: SpendControlPayload) => void;
  updateCardStatus: (payload: { cardToken: string; status: string }) => void;
};

export function useWiseCardSpendControlHandlers({
  assignSpendControl,
  cardStatusUpdates,
  createSpendControl,
  deleteSpendControl,
  notify,
  spendControlAssignment,
  spendControlDeleteId,
  spendControlForm,
  t,
  unassignSpendControl,
  updateCardStatus,
}: UseWiseCardSpendControlHandlersOptions) {
  const handleUpdateCardStatus = useCallback(
    (cardToken: string) => {
      const status = cardStatusUpdates[cardToken]?.trim();
      if (!status) {
        notify({ title: t('wise.cards.statusRequired'), variant: 'destructive' });
        return;
      }
      updateCardStatus({ cardToken, status });
    },
    [cardStatusUpdates, notify, t, updateCardStatus],
  );

  const handleCreateSpendControl = useCallback(() => {
    if (
      !spendControlForm.name.trim() ||
      !spendControlForm.maxAmount.trim() ||
      !spendControlForm.currency ||
      !spendControlForm.period
    ) {
      notify({ title: t('wise.spendControls.missingParams'), variant: 'destructive' });
      return;
    }
    const maxAmount = Number(spendControlForm.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      notify({ title: t('wise.spendControls.invalidAmount'), variant: 'destructive' });
      return;
    }
    createSpendControl({
      name: spendControlForm.name.trim(),
      currency: spendControlForm.currency,
      maxAmount,
      period: spendControlForm.period,
    });
  }, [
    createSpendControl,
    notify,
    spendControlForm.currency,
    spendControlForm.maxAmount,
    spendControlForm.name,
    spendControlForm.period,
    t,
  ]);

  const handleAssignSpendControl = useCallback(
    (assign: 'assign' | 'unassign') => {
      if (
        !spendControlAssignment.ruleId.trim() ||
        !spendControlAssignment.cardToken.trim()
      ) {
        notify({ title: t('wise.spendControls.missingAssign'), variant: 'destructive' });
        return;
      }
      const payload = {
        ruleId: spendControlAssignment.ruleId.trim(),
        cardToken: spendControlAssignment.cardToken.trim(),
      };
      if (assign === 'assign') {
        assignSpendControl(payload);
        return;
      }
      unassignSpendControl(payload);
    },
    [assignSpendControl, notify, spendControlAssignment.cardToken, spendControlAssignment.ruleId, t, unassignSpendControl],
  );

  const handleDeleteSpendControl = useCallback(() => {
    if (!spendControlDeleteId.trim()) {
      notify({ title: t('wise.spendControls.missingDelete'), variant: 'destructive' });
      return;
    }
    deleteSpendControl(spendControlDeleteId.trim());
  }, [deleteSpendControl, notify, spendControlDeleteId, t]);

  return {
    handleAssignSpendControl,
    handleCreateSpendControl,
    handleDeleteSpendControl,
    handleUpdateCardStatus,
  };
}

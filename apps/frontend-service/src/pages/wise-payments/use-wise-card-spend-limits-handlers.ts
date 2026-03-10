import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  ParseJsonSafeFn,
} from './wise-card-spend-types';

type SpendLimitsProfilePayload = {
  profileId: string;
  body: Record<string, unknown>;
};

type SpendLimitsCardPayload = {
  profileId: string;
  cardToken: string;
  body: Record<string, unknown>;
};

type SpendLimitsCardKeyPayload = {
  profileId: string;
  cardToken: string;
};

type UseWiseCardSpendLimitsHandlersOptions = {
  deleteSpendLimitsCard: (payload: SpendLimitsCardKeyPayload) => void;
  getSpendLimitsCard: (payload: SpendLimitsCardKeyPayload) => void;
  getSpendLimitsProfile: (profileId: string) => void;
  notify: NotifyFn;
  parseJsonSafe: ParseJsonSafeFn;
  spendLimitsCardPayload: string;
  spendLimitsCardToken: string;
  spendLimitsDeleteCardToken: string;
  spendLimitsPayload: string;
  spendLimitsProfileId: string;
  t: TFunction;
  updateSpendLimitsCard: (payload: SpendLimitsCardPayload) => void;
  updateSpendLimitsProfile: (payload: SpendLimitsProfilePayload) => void;
};

export function useWiseCardSpendLimitsHandlers({
  deleteSpendLimitsCard,
  getSpendLimitsCard,
  getSpendLimitsProfile,
  notify,
  parseJsonSafe,
  spendLimitsCardPayload,
  spendLimitsCardToken,
  spendLimitsDeleteCardToken,
  spendLimitsPayload,
  spendLimitsProfileId,
  t,
  updateSpendLimitsCard,
  updateSpendLimitsProfile,
}: UseWiseCardSpendLimitsHandlersOptions) {
  const handleFetchSpendLimitsProfile = useCallback(() => {
    if (!spendLimitsProfileId.trim()) {
      notify({ title: t('wise.spendLimits.missingProfileId'), variant: 'destructive' });
      return;
    }
    getSpendLimitsProfile(spendLimitsProfileId.trim());
  }, [getSpendLimitsProfile, notify, spendLimitsProfileId, t]);

  const handleUpdateSpendLimitsProfile = useCallback(() => {
    if (!spendLimitsProfileId.trim()) {
      notify({ title: t('wise.spendLimits.missingProfileId'), variant: 'destructive' });
      return;
    }
    const parsed = parseJsonSafe(spendLimitsPayload, t('wise.errors.invalidJson'));
    if (!parsed) {
      notify({ title: t('wise.errors.invalidJson'), variant: 'destructive' });
      return;
    }
    updateSpendLimitsProfile({
      profileId: spendLimitsProfileId.trim(),
      body: parsed,
    });
  }, [
    notify,
    parseJsonSafe,
    spendLimitsPayload,
    spendLimitsProfileId,
    t,
    updateSpendLimitsProfile,
  ]);

  const handleFetchSpendLimitsCard = useCallback(() => {
    if (!spendLimitsProfileId.trim() || !spendLimitsCardToken.trim()) {
      notify({ title: t('wise.spendLimits.missingCardInput'), variant: 'destructive' });
      return;
    }
    getSpendLimitsCard({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsCardToken.trim(),
    });
  }, [getSpendLimitsCard, notify, spendLimitsCardToken, spendLimitsProfileId, t]);

  const handleUpdateSpendLimitsCard = useCallback(() => {
    if (!spendLimitsProfileId.trim() || !spendLimitsCardToken.trim()) {
      notify({ title: t('wise.spendLimits.missingCardInput'), variant: 'destructive' });
      return;
    }
    const parsed = parseJsonSafe(spendLimitsCardPayload, t('wise.errors.invalidJson'));
    if (!parsed) {
      notify({ title: t('wise.errors.invalidJson'), variant: 'destructive' });
      return;
    }
    updateSpendLimitsCard({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsCardToken.trim(),
      body: parsed,
    });
  }, [
    notify,
    parseJsonSafe,
    spendLimitsCardPayload,
    spendLimitsCardToken,
    spendLimitsProfileId,
    t,
    updateSpendLimitsCard,
  ]);

  const handleDeleteSpendLimitsCard = useCallback(() => {
    if (!spendLimitsProfileId.trim() || !spendLimitsDeleteCardToken.trim()) {
      notify({ title: t('wise.spendLimits.missingCardDelete'), variant: 'destructive' });
      return;
    }
    deleteSpendLimitsCard({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsDeleteCardToken.trim(),
    });
  }, [
    deleteSpendLimitsCard,
    notify,
    spendLimitsDeleteCardToken,
    spendLimitsProfileId,
    t,
  ]);

  return {
    handleDeleteSpendLimitsCard,
    handleFetchSpendLimitsCard,
    handleFetchSpendLimitsProfile,
    handleUpdateSpendLimitsCard,
    handleUpdateSpendLimitsProfile,
  };
}

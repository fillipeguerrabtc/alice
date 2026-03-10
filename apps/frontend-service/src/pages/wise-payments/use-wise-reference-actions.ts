import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

export type WiseRatesForm = {
  sourceCurrency: string;
  targetCurrency: string;
};

export type WiseRecipientRequirementsForm = {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
};

type UseWiseReferenceActionsOptions = {
  notify: NotifyFn;
  t: TFunction;
};

type UseWiseReferenceActionsResult = {
  balanceCapacityCurrency: string;
  balanceCapacityResult: string | null;
  handleFetchBalanceCapacity: () => Promise<void>;
  handleFetchRates: () => Promise<void>;
  handleFetchRecipientRequirements: () => Promise<void>;
  handleFetchTotalFunds: () => Promise<void>;
  onRecipientRequirementsFieldChange: (field: keyof WiseRecipientRequirementsForm, value: string) => void;
  ratesForm: WiseRatesForm;
  ratesResult: string | null;
  recipientRequirementsForm: WiseRecipientRequirementsForm;
  recipientRequirementsResult: string | null;
  setBalanceCapacityCurrency: (value: string) => void;
  setRatesForm: Dispatch<SetStateAction<WiseRatesForm>>;
  setTotalFundsCurrency: (value: string) => void;
  totalFundsCurrency: string;
  totalFundsResult: string | null;
};

export function useWiseReferenceActions(
  options: UseWiseReferenceActionsOptions,
): UseWiseReferenceActionsResult {
  const { notify, t } = options;
  const [balanceCapacityCurrency, setBalanceCapacityCurrency] = useState('');
  const [balanceCapacityResult, setBalanceCapacityResult] = useState<string | null>(null);
  const [totalFundsCurrency, setTotalFundsCurrency] = useState('');
  const [totalFundsResult, setTotalFundsResult] = useState<string | null>(null);
  const [ratesForm, setRatesForm] = useState<WiseRatesForm>({
    sourceCurrency: '',
    targetCurrency: '',
  });
  const [ratesResult, setRatesResult] = useState<string | null>(null);
  const [recipientRequirementsForm, setRecipientRequirementsForm] = useState<WiseRecipientRequirementsForm>({
    sourceCurrency: '',
    targetCurrency: '',
    sourceAmount: '',
  });
  const [recipientRequirementsResult, setRecipientRequirementsResult] = useState<string | null>(null);

  const handleFetchBalanceCapacity = useCallback(async () => {
    if (!balanceCapacityCurrency.trim()) {
      notify({ title: t('wise.balanceCapacity.missingCurrency'), variant: 'destructive' });
      return;
    }

    try {
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/balance-capacity?currency=${encodeURIComponent(balanceCapacityCurrency.trim().toUpperCase())}`,
      );
      const data = (await response.json()) as Record<string, unknown>;
      setBalanceCapacityResult(JSON.stringify(data.capacity ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [balanceCapacityCurrency, notify, t]);

  const handleFetchTotalFunds = useCallback(async () => {
    if (!totalFundsCurrency.trim()) {
      notify({ title: t('wise.totalFunds.missingCurrency'), variant: 'destructive' });
      return;
    }

    try {
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/total-funds?currency=${encodeURIComponent(totalFundsCurrency.trim().toUpperCase())}`,
      );
      const data = (await response.json()) as Record<string, unknown>;
      setTotalFundsResult(JSON.stringify(data.total ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [notify, t, totalFundsCurrency]);

  const handleFetchRates = useCallback(async () => {
    if (!ratesForm.sourceCurrency.trim() || !ratesForm.targetCurrency.trim()) {
      notify({ title: t('wise.rates.missingCurrencies'), variant: 'destructive' });
      return;
    }

    try {
      const params = new URLSearchParams({
        source: ratesForm.sourceCurrency.trim().toUpperCase(),
        target: ratesForm.targetCurrency.trim().toUpperCase(),
      });
      const response = await apiRequest('GET', `/api/integrations/wise/rates?${params.toString()}`);
      const data = (await response.json()) as Record<string, unknown>;
      setRatesResult(JSON.stringify(data.rate ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [notify, ratesForm.sourceCurrency, ratesForm.targetCurrency, t]);

  const handleFetchRecipientRequirements = useCallback(async () => {
    const { sourceCurrency, targetCurrency, sourceAmount } = recipientRequirementsForm;
    if (!sourceCurrency.trim() || !targetCurrency.trim() || !sourceAmount.trim()) {
      notify({ title: t('wise.recipientRequirements.missingParams'), variant: 'destructive' });
      return;
    }

    try {
      const params = new URLSearchParams({
        sourceCurrency: sourceCurrency.trim().toUpperCase(),
        targetCurrency: targetCurrency.trim().toUpperCase(),
        sourceAmount: sourceAmount.trim(),
      });
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/recipient-requirements?${params.toString()}`,
      );
      const data = (await response.json()) as Record<string, unknown>;
      setRecipientRequirementsResult(JSON.stringify(data.requirements ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [notify, recipientRequirementsForm, t]);

  const onRecipientRequirementsFieldChange = useCallback(
    (field: keyof WiseRecipientRequirementsForm, value: string) => {
      setRecipientRequirementsForm((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    [],
  );

  return {
    balanceCapacityCurrency,
    balanceCapacityResult,
    handleFetchBalanceCapacity,
    handleFetchRates,
    handleFetchRecipientRequirements,
    handleFetchTotalFunds,
    onRecipientRequirementsFieldChange,
    ratesForm,
    ratesResult,
    recipientRequirementsForm,
    recipientRequirementsResult,
    setBalanceCapacityCurrency,
    setRatesForm,
    setTotalFundsCurrency,
    totalFundsCurrency,
    totalFundsResult,
  };
}

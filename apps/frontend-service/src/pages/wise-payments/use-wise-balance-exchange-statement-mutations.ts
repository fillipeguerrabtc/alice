import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  INITIAL_NEW_BALANCE_FORM,
  type NewBalanceForm,
  type NotifyFn,
  type WiseBalance,
  type WiseBalanceStatementResponse,
  type WiseQuote,
} from './wise-balance-exchange-statement-types';

type UseWiseBalanceExchangeStatementMutationsOptions = {
  notify: NotifyFn;
  t: TFunction;
  setShowNewBalanceDialog: Dispatch<SetStateAction<boolean>>;
  setNewBalanceForm: Dispatch<SetStateAction<NewBalanceForm>>;
  setStatementData: Dispatch<SetStateAction<WiseBalanceStatementResponse | null>>;
};

export function useWiseBalanceExchangeStatementMutations(
  options: UseWiseBalanceExchangeStatementMutationsOptions
) {
  const { notify, t, setShowNewBalanceDialog, setNewBalanceForm, setStatementData } =
    options;

  const createQuoteMutation = useMutation({
    mutationFn: async (payload: {
      sourceCurrency: string;
      targetCurrency: string;
      sourceAmount: number;
    }) => {
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/quotes',
        payload
      );
      return response.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      notify({
        title: t('wise.success.quoteCreated'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: () => {
      notify({
        title: t('wise.errors.quoteFailed'),
        variant: 'destructive',
      });
    },
  });

  const createBalanceMutation = useMutation({
    mutationFn: async (payload: {
      currency: string;
      type: 'STANDARD' | 'SAVINGS';
      name?: string;
    }) => {
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/balances',
        payload
      );
      return response.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      setShowNewBalanceDialog(false);
      setNewBalanceForm(INITIAL_NEW_BALANCE_FORM);
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      notify({ title: t('wise.balances.created') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.balanceCreateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteBalanceMutation = useMutation({
    mutationFn: async (balanceId: number) => {
      const response = await apiRequest(
        'DELETE',
        `/api/integrations/wise/balances/${balanceId}`
      );
      return response.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      notify({ title: t('wise.balances.deleted') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.balanceDeleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeQuoteMutation = useMutation({
    mutationFn: async (payload: {
      sourceCurrency: string;
      targetCurrency: string;
      sourceAmount: number;
    }) => {
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/balance-quotes',
        payload
      );
      return response.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      notify({
        title: t('wise.exchange.quoteReady'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: (error) => {
      notify({
        title: t('wise.exchange.quoteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeExecuteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/balance-movements',
        { quoteId }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      notify({ title: t('wise.exchange.completed') });
    },
    onError: (error) => {
      notify({
        title: t('wise.exchange.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const statementMutation = useMutation({
    mutationFn: async (payload: {
      balanceId: string;
      currency: string;
      intervalStart: string;
      intervalEnd: string;
    }) => {
      const params = new URLSearchParams({
        currency: payload.currency,
        intervalStart: payload.intervalStart,
        intervalEnd: payload.intervalEnd,
      });
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/balances/${payload.balanceId}/statement?${params.toString()}`
      );
      return response.json() as Promise<{ statement: WiseBalanceStatementResponse }>;
    },
    onSuccess: (data) => {
      setStatementData(data.statement);
    },
    onError: (error) => {
      notify({
        title: t('wise.history.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return {
    createQuoteMutation,
    createBalanceMutation,
    deleteBalanceMutation,
    exchangeQuoteMutation,
    exchangeExecuteMutation,
    statementMutation,
  };
}

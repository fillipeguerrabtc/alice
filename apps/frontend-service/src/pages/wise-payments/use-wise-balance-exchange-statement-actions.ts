import { useCallback, useState } from 'react';
import {
  INITIAL_EXCHANGE_FORM,
  INITIAL_NEW_BALANCE_FORM,
  INITIAL_QUOTE_FORM,
  INITIAL_STATEMENT_FORM,
  type StatementForm,
  type UseWiseBalanceExchangeStatementActionsOptions,
  type UseWiseBalanceExchangeStatementActionsResult,
  type WiseBalanceStatementResponse,
} from './wise-balance-exchange-statement-types';
import { useWiseBalanceExchangeStatementMutations } from './use-wise-balance-exchange-statement-mutations';

export type {
  ExchangeForm,
  NewBalanceForm,
  QuoteForm,
  StatementForm,
  WiseBalance,
  WiseBalanceStatement,
  WiseBalanceStatementResponse,
  WiseQuote,
} from './wise-balance-exchange-statement-types';

export function useWiseBalanceExchangeStatementActions(
  options: UseWiseBalanceExchangeStatementActionsOptions
): UseWiseBalanceExchangeStatementActionsResult {
  const { notify, t } = options;
  const [quoteForm, setQuoteForm] = useState(INITIAL_QUOTE_FORM);
  const [exchangeForm, setExchangeForm] = useState(INITIAL_EXCHANGE_FORM);
  const [statementForm, setStatementForm] = useState(INITIAL_STATEMENT_FORM);
  const [statementData, setStatementData] =
    useState<WiseBalanceStatementResponse | null>(null);
  const [showNewBalanceDialog, setShowNewBalanceDialog] = useState(false);
  const [newBalanceForm, setNewBalanceForm] = useState(INITIAL_NEW_BALANCE_FORM);

  const {
    createQuoteMutation,
    createBalanceMutation,
    deleteBalanceMutation,
    exchangeQuoteMutation,
    exchangeExecuteMutation,
    statementMutation,
  } = useWiseBalanceExchangeStatementMutations({
    notify,
    t,
    setShowNewBalanceDialog,
    setNewBalanceForm,
    setStatementData,
  });

  const handleGetQuote = useCallback(() => {
    if (!quoteForm.sourceAmount) {
      return;
    }
    createQuoteMutation.mutate({
      sourceCurrency: quoteForm.sourceCurrency,
      targetCurrency: quoteForm.targetCurrency,
      sourceAmount: parseFloat(quoteForm.sourceAmount),
    });
  }, [
    createQuoteMutation,
    quoteForm.sourceAmount,
    quoteForm.sourceCurrency,
    quoteForm.targetCurrency,
  ]);

  const handleGetExchangeQuote = useCallback(() => {
    if (!exchangeForm.sourceAmount) {
      return;
    }
    exchangeQuoteMutation.mutate({
      sourceCurrency: exchangeForm.sourceCurrency,
      targetCurrency: exchangeForm.targetCurrency,
      sourceAmount: parseFloat(exchangeForm.sourceAmount),
    });
  }, [
    exchangeForm.sourceAmount,
    exchangeForm.sourceCurrency,
    exchangeForm.targetCurrency,
    exchangeQuoteMutation,
  ]);

  const handleExecuteExchange = useCallback(() => {
    const quote = exchangeQuoteMutation.data?.quote;
    if (!quote?.id) {
      return;
    }
    exchangeExecuteMutation.mutate(quote.id);
  }, [exchangeExecuteMutation, exchangeQuoteMutation.data?.quote]);

  const handleFetchStatement = useCallback(() => {
    if (
      !statementForm.balanceId ||
      !statementForm.intervalStart ||
      !statementForm.intervalEnd
    ) {
      notify({ title: t('wise.history.missingParams'), variant: 'destructive' });
      return;
    }
    const startIso = new Date(
      `${statementForm.intervalStart}T00:00:00.000Z`
    ).toISOString();
    const endIso = new Date(
      `${statementForm.intervalEnd}T23:59:59.999Z`
    ).toISOString();

    statementMutation.mutate({
      balanceId: statementForm.balanceId,
      currency: statementForm.currency,
      intervalStart: startIso,
      intervalEnd: endIso,
    });
  }, [
    notify,
    statementForm.balanceId,
    statementForm.currency,
    statementForm.intervalEnd,
    statementForm.intervalStart,
    statementMutation,
    t,
  ]);

  const handleCreateBalance = useCallback(() => {
    if (newBalanceForm.type === 'SAVINGS' && !newBalanceForm.name.trim()) {
      notify({ title: t('wise.balances.nameRequired'), variant: 'destructive' });
      return;
    }

    createBalanceMutation.mutate({
      currency: newBalanceForm.currency,
      type: newBalanceForm.type,
      name:
        newBalanceForm.type === 'SAVINGS'
          ? newBalanceForm.name.trim()
          : undefined,
    });
  }, [
    createBalanceMutation,
    newBalanceForm.currency,
    newBalanceForm.name,
    newBalanceForm.type,
    notify,
    t,
  ]);

  const handleDeleteBalance = useCallback(
    (balanceId: number) => {
      if (window.confirm(t('wise.balances.confirmDelete'))) {
        deleteBalanceMutation.mutate(balanceId);
      }
    },
    [deleteBalanceMutation, t]
  );

  const onStatementFieldChange = useCallback(
    (field: keyof StatementForm, value: string) => {
      setStatementForm((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    []
  );

  return {
    exchangeForm,
    exchangeQuote: exchangeQuoteMutation.data?.quote ?? null,
    handleCreateBalance,
    handleDeleteBalance,
    handleExecuteExchange,
    handleFetchStatement,
    handleGetExchangeQuote,
    handleGetQuote,
    isPendingCreateBalance: createBalanceMutation.isPending,
    isPendingExchangeExecute: exchangeExecuteMutation.isPending,
    isPendingExchangeQuote: exchangeQuoteMutation.isPending,
    isPendingQuote: createQuoteMutation.isPending,
    isPendingStatement: statementMutation.isPending,
    newBalanceForm,
    onStatementFieldChange,
    quote: createQuoteMutation.data?.quote ?? null,
    quoteForm,
    setExchangeForm,
    setNewBalanceForm,
    setQuoteForm,
    setShowNewBalanceDialog,
    showNewBalanceDialog,
    statementData,
    statementForm,
  };
}

import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import {
  CURRENCIES,
  getWiseStatusBadge,
} from './wise-payments-constants';
import type {
  BuildWiseOperationalTabsPropsOptions,
  WiseOperationalFinanceTabsProps,
} from './wise-operational-tabs-props-types';

export function buildWiseOperationalFinanceTabsProps({
  balanceExchangeStatementActions,
  dataQueries,
  derivedData,
  locale,
  recipientActions,
  referenceActions,
  t,
  timeZone,
  transferAndCardActions,
}: BuildWiseOperationalTabsPropsOptions): WiseOperationalFinanceTabsProps {
  const balancesTabProps = {
    balanceCapacityCurrency: referenceActions.balanceCapacityCurrency,
    balanceCapacityResult: referenceActions.balanceCapacityResult,
    balances: derivedData.balances,
    createBalancePending: balanceExchangeStatementActions.isPendingCreateBalance,
    currencies: CURRENCIES,
    formatCurrency,
    isLoadingBalances: dataQueries.isLoadingBalances,
    locale,
    newBalanceForm: balanceExchangeStatementActions.newBalanceForm,
    onCreateBalance: balanceExchangeStatementActions.handleCreateBalance,
    onDeleteBalance: balanceExchangeStatementActions.handleDeleteBalance,
    onFetchBalanceCapacity: referenceActions.handleFetchBalanceCapacity,
    onFetchTotalFunds: referenceActions.handleFetchTotalFunds,
    setBalanceCapacityCurrency: referenceActions.setBalanceCapacityCurrency,
    setNewBalanceForm: balanceExchangeStatementActions.setNewBalanceForm,
    setShowNewBalanceDialog: balanceExchangeStatementActions.setShowNewBalanceDialog,
    setTotalFundsCurrency: referenceActions.setTotalFundsCurrency,
    showNewBalanceDialog: balanceExchangeStatementActions.showNewBalanceDialog,
    t,
    totalFundsCurrency: referenceActions.totalFundsCurrency,
    totalFundsResult: referenceActions.totalFundsResult,
  };

  const exchangeTabProps = {
    balanceCurrencies: derivedData.balanceCurrencies,
    currencies: CURRENCIES,
    exchangeExecutePending: balanceExchangeStatementActions.isPendingExchangeExecute,
    exchangeForm: balanceExchangeStatementActions.exchangeForm,
    exchangeQuote: balanceExchangeStatementActions.exchangeQuote,
    exchangeQuotePending: balanceExchangeStatementActions.isPendingExchangeQuote,
    formatCurrency,
    formatDate,
    formatNumber,
    locale,
    onExecuteExchange: balanceExchangeStatementActions.handleExecuteExchange,
    onFetchRates: referenceActions.handleFetchRates,
    onGetExchangeQuote: balanceExchangeStatementActions.handleGetExchangeQuote,
    ratesForm: referenceActions.ratesForm,
    ratesResult: referenceActions.ratesResult,
    setExchangeForm: balanceExchangeStatementActions.setExchangeForm,
    setRatesForm: referenceActions.setRatesForm,
    t,
    timeZone,
  };

  const transfersTabProps = {
    formatCurrency,
    formatDate,
    getStatusBadge: getWiseStatusBadge,
    isLoadingTransfers: dataQueries.isLoadingTransfers,
    locale,
    onCancelTransfer: transferAndCardActions.handleCancelTransfer,
    onFundTransfer: transferAndCardActions.handleFundTransfer,
    setTransferActionId: transferAndCardActions.setTransferActionId,
    t,
    timeZone,
    transferActionId: transferAndCardActions.transferActionId,
    transferActionResult: transferAndCardActions.transferActionResult,
    transfers: derivedData.transfers,
  };

  const recipientsTabProps = {
    cardPermissionPayload: transferAndCardActions.cardPermissionPayload,
    cardPermissionResult: transferAndCardActions.cardPermissionResult,
    cardPermissionToken: transferAndCardActions.cardPermissionToken,
    cardPermissionsPayload: transferAndCardActions.cardPermissionsPayload,
    cardPermissionsResult: transferAndCardActions.cardPermissionsResult,
    cardSecureDetailsResult: transferAndCardActions.cardSecureDetailsResult,
    cardSecureKeyResult: transferAndCardActions.cardSecureKeyResult,
    cardSecurePayload: transferAndCardActions.cardSecurePayload,
    cardSecurePinPayload: transferAndCardActions.cardSecurePinPayload,
    cardSecurePinResult: transferAndCardActions.cardSecurePinResult,
    cardSecureToken: transferAndCardActions.cardSecureToken,
    currencies: CURRENCIES,
    isLoadingRecipients: dataQueries.isLoadingRecipients,
    onDeleteRecipient: recipientActions.handleDeleteRecipient,
    onFetchCardPermissions: transferAndCardActions.handleFetchCardPermissions,
    onFetchCardSecureDetails: transferAndCardActions.handleFetchCardSecureDetails,
    onFetchCardSecureKey: transferAndCardActions.handleFetchCardSecureKey,
    onFetchCardSecurePin: transferAndCardActions.handleFetchCardSecurePin,
    onUpdateCardPermissions: transferAndCardActions.handleUpdateCardPermissions,
    onUpdateCardPermissionsBulk: transferAndCardActions.handleUpdateCardPermissionsBulk,
    recipients: derivedData.recipients,
    setCardPermissionPayload: transferAndCardActions.setCardPermissionPayload,
    setCardPermissionToken: transferAndCardActions.setCardPermissionToken,
    setCardPermissionsPayload: transferAndCardActions.setCardPermissionsPayload,
    setCardSecurePayload: transferAndCardActions.setCardSecurePayload,
    setCardSecurePinPayload: transferAndCardActions.setCardSecurePinPayload,
    setCardSecureToken: transferAndCardActions.setCardSecureToken,
    setShowNewRecipientDialog: recipientActions.setShowNewRecipientDialog,
    showNewRecipientDialog: recipientActions.showNewRecipientDialog,
    t,
  };

  const quotesTabProps = {
    currencies: CURRENCIES,
    formatCurrency,
    formatDate,
    formatNumber,
    isPendingQuote: balanceExchangeStatementActions.isPendingQuote,
    locale,
    onGetQuote: balanceExchangeStatementActions.handleGetQuote,
    quote: balanceExchangeStatementActions.quote,
    quoteForm: balanceExchangeStatementActions.quoteForm,
    setQuoteForm: balanceExchangeStatementActions.setQuoteForm,
    t,
    timeZone,
  };

  const batchTabProps = {
    batchGroups: derivedData.batchGroups,
    formatDate,
    getStatusBadge: getWiseStatusBadge,
    isLoadingBatchGroups: dataQueries.isLoadingBatchGroups,
    locale,
    t,
    timeZone,
  };

  const statementsTabProps = {
    balances: derivedData.balances,
    formatCurrency,
    formatDate,
    isPendingStatement: balanceExchangeStatementActions.isPendingStatement,
    locale,
    onFetchStatement: balanceExchangeStatementActions.handleFetchStatement,
    onStatementFieldChange: balanceExchangeStatementActions.onStatementFieldChange,
    statementCurrencies: derivedData.balanceCurrencies.length
      ? derivedData.balanceCurrencies
      : CURRENCIES.map((currency) => currency.code),
    statementData: balanceExchangeStatementActions.statementData,
    statementForm: balanceExchangeStatementActions.statementForm,
    t,
    timeZone,
  };

  return {
    balancesTabProps,
    batchTabProps,
    exchangeTabProps,
    quotesTabProps,
    recipientsTabProps,
    statementsTabProps,
    transfersTabProps,
  };
}

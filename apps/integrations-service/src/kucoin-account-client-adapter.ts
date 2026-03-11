import * as kucoinAccountClient from './kucoinAccountClient.js';

export function createKucoinAccountClientAdapter() {
  return {
    isAccountConfigured: () => kucoinAccountClient.isAccountConfigured(),
    getAccountSummaryInfo: () => kucoinAccountClient.getAccountSummaryInfo(),
    getApikeyInfo: () => kucoinAccountClient.getApikeyInfo(),
    getAccountTypeSpot: () => kucoinAccountClient.getAccountTypeSpot(),
    getAccountDetailSpot: (accountId: string) => kucoinAccountClient.getAccountDetailSpot(accountId),
    getAccountLedgersSpotMargin: (params: Record<string, string>) => kucoinAccountClient.getAccountLedgersSpotMargin(
      params as Parameters<typeof kucoinAccountClient.getAccountLedgersSpotMargin>[0],
    ),
    getAccountLedgersTradeHf: (params: Record<string, string>) => kucoinAccountClient.getAccountLedgersTradeHf(
      params as Parameters<typeof kucoinAccountClient.getAccountLedgersTradeHf>[0],
    ),
    getAccountLedgersMarginHf: (params: Record<string, string>) => kucoinAccountClient.getAccountLedgersMarginHf(
      params as Parameters<typeof kucoinAccountClient.getAccountLedgersMarginHf>[0],
    ),
    getAccountLedgersFutures: (params: Record<string, string>) => kucoinAccountClient.getAccountLedgersFutures(
      params as Parameters<typeof kucoinAccountClient.getAccountLedgersFutures>[0],
    ),
    addSubAccount: (payload: unknown) => kucoinAccountClient.addSubAccount(
      payload as Parameters<typeof kucoinAccountClient.addSubAccount>[0],
    ),
    addSubAccountMarginPermission: (subUserId: string) => kucoinAccountClient.addSubAccountMarginPermission(subUserId),
    addSubAccountFuturesPermission: (subUserId: string) => kucoinAccountClient.addSubAccountFuturesPermission(subUserId),
    getSubAccountListSummary: (params: Record<string, string>) => kucoinAccountClient.getSubAccountListSummary(
      params as Parameters<typeof kucoinAccountClient.getSubAccountListSummary>[0],
    ),
    getSubAccountDetailBalance: (subUserId: string) => kucoinAccountClient.getSubAccountDetailBalance(subUserId),
    getSubAccountListSpotBalance: (params: Record<string, string>) => kucoinAccountClient.getSubAccountListSpotBalance(
      params as Parameters<typeof kucoinAccountClient.getSubAccountListSpotBalance>[0],
    ),
    getSubAccountListFuturesBalance: (params: Record<string, string>) => kucoinAccountClient.getSubAccountListFuturesBalance(
      params as Parameters<typeof kucoinAccountClient.getSubAccountListFuturesBalance>[0],
    ),
    addDepositAddress: (currency: string, chain?: string) => kucoinAccountClient.addDepositAddress(currency, chain),
    getDepositAddress: (currency: string, chain?: string) => kucoinAccountClient.getDepositAddress(currency, chain),
    getDepositHistory: (params: Record<string, string>) => kucoinAccountClient.getDepositHistory(
      params as Parameters<typeof kucoinAccountClient.getDepositHistory>[0],
    ),
    getWithdrawalQuotas: (currency: string, chain?: string) => kucoinAccountClient.getWithdrawalQuotas(currency, chain),
    withdraw: (payload: unknown) => kucoinAccountClient.withdraw(
      payload as Parameters<typeof kucoinAccountClient.withdraw>[0],
    ),
    cancelWithdrawal: (id: string) => kucoinAccountClient.cancelWithdrawal(id),
    getWithdrawalHistory: (params: Record<string, string>) => kucoinAccountClient.getWithdrawalHistory(
      params as Parameters<typeof kucoinAccountClient.getWithdrawalHistory>[0],
    ),
    getWithdrawalById: (id: string) => kucoinAccountClient.getWithdrawalById(id),
    getTransferQuotas: (currency: string, type: string) => kucoinAccountClient.getTransferQuotas(currency, type),
    flexTransfer: (payload: unknown) => kucoinAccountClient.flexTransfer(
      payload as Parameters<typeof kucoinAccountClient.flexTransfer>[0],
    ),
    getBasicFeeSpotMargin: (currencyType?: string) => kucoinAccountClient.getBasicFeeSpotMargin(currencyType),
    getActualFeeFutures: (symbol: string) => kucoinAccountClient.getActualFeeFutures(symbol),
  };
}

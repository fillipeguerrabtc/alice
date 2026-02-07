/**
 * KuCoin Account Client - Alice Enterprise Platform
 *
 * Implementação dedicada para Account Management (REST):
 * - Funding & Account Info
 * - Sub Accounts
 * - Deposits & Withdrawals
 * - Transfers
 * - Trade Fees
 *
 * Usa mesma autenticação e base URL da Spot API.
 * Alinhado à documentação oficial KuCoin 2025.
 *
 * Regra 6: SEM MOCKS - integração real.
 * Regra 8: TypeScript strict.
 *
 * Autor: Fillipe Guerra
 * Data: 07 de Fevereiro de 2026
 */

import { createLogger } from '@alice/logger';
import { CIRCUIT_BREAKER_PRESETS, createAlicePrometheus } from '@alice/shared-utils';
import { createKucoinRequester } from './kucoinRequest.js';

const logger = createLogger('kucoin-account-client');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const KUCOIN_ACCOUNT_BASE_URL = (process.env.KUCOIN_SPOT_BASE_URL || 'https://api.kucoin.com').trim();
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;

const kucoinAccountRequester = createKucoinRequester({
  name: 'kucoin-account',
  operationPrefix: 'account',
  baseUrl: KUCOIN_ACCOUNT_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinSpot,
});

export function initKucoinAccountMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  kucoinAccountRequester.initMetrics(prometheusMetrics);
  logger.info('Métricas KuCoin Account inicializadas');
}

// ============================================================================
// TIPOS - Account & Funding
// ============================================================================

/** Resumo da conta do usuário */
export interface AccountSummaryInfo {
  level: number;
  subQuantity: number;
  spotSubQuantity: number;
  marginSubQuantity: number;
  futuresSubQuantity: number;
  maxSubQuantity: number;
  maxDefaultSubQuantity: number;
  maxSpotSubQuantity: number;
  maxMarginSubQuantity: number;
  maxFuturesSubQuantity: number;
}

/** Informações da API key */
export interface ApiKeyInfo {
  remark: string;
  apiKey: string;
  apiVersion: number;
  permission: string;
  ipWhitelist: string;
  createdAt: number;
  uid: number;
  isMaster: boolean;
}

/** Conta HF Spot */
export interface HfAccountOpened {
  uid: number;
  opened: boolean;
}

/** Detalhe de uma conta */
export interface AccountDetail {
  id: string;
  currency: string;
  type: string;
  balance: string;
  available: string;
  holds: string;
}

/** Ledger entry */
export interface LedgerEntry {
  id: string;
  currency: string;
  amount: string;
  fee: string;
  balance: string;
  accountType: string;
  bizType: string;
  direction: string;
  createdAt: number;
  context?: string;
}

/** Ledger entry Futures */
export interface FuturesLedgerEntry {
  time: number;
  type: string;
  amount: number;
  fee: number;
  accountEquity: number;
  status: string;
  remark: string;
  offset: number;
  currency: string;
}

// ============================================================================
// TIPOS - Sub Account
// ============================================================================

/** Sub-conta criada */
export interface SubAccountCreated {
  uid: number;
  subName: string;
  remarks: string;
  access: string;
}

/** Resumo de sub-contas */
export interface SubAccountSummary {
  userId: string;
  uid: number;
  subName: string;
  status: number;
  type: number;
  access: string;
  createdAt: number;
  remarks: string;
}

/** Balance de sub-conta */
export interface SubAccountBalance {
  subUserId: string;
  subName: string;
  mainAccounts: Array<{
    currency: string;
    balance: string;
    available: string;
    holds: string;
    baseCurrency: string;
    baseCurrencyPrice: string;
    baseAmount: string;
  }>;
  tradeAccounts: Array<{
    currency: string;
    balance: string;
    available: string;
    holds: string;
    baseCurrency: string;
    baseCurrencyPrice: string;
    baseAmount: string;
  }>;
  marginAccounts: Array<{
    currency: string;
    balance: string;
    available: string;
    holds: string;
    baseCurrency: string;
    baseCurrencyPrice: string;
    baseAmount: string;
  }>;
}

/** Balance Spot/Margin de sub-contas (v2) */
export interface SubAccountSpotBalance {
  subUserId: string;
  subName: string;
  mainAccounts: Array<{
    currency: string;
    balance: string;
    available: string;
    holds: string;
  }>;
}

/** Balance Futures de sub-conta */
export interface SubAccountFuturesBalance {
  summary: {
    accountEquityTotal: number;
    unrealisedPNLTotal: number;
    marginBalanceTotal: number;
    positionMarginTotal: number;
    orderMarginTotal: number;
    frozenFundsTotal: number;
    availableBalanceTotal: number;
    currency: string;
  };
  accounts: Array<{
    accountName: string;
    accountEquity: number;
    unrealisedPNL: number;
    marginBalance: number;
    positionMargin: number;
    orderMargin: number;
    frozenFunds: number;
    availableBalance: number;
    currency: string;
  }>;
}

// ============================================================================
// TIPOS - Deposits & Withdrawals
// ============================================================================

/** Endereço de depósito */
export interface DepositAddress {
  address: string;
  memo: string;
  chain: string;
  contractAddress: string;
}

/** Histórico de depósito */
export interface DepositRecord {
  currency: string;
  chain: string;
  status: string;
  address: string;
  memo: string;
  isInner: boolean;
  amount: string;
  fee: string;
  walletTxId: string;
  createdAt: number;
  updatedAt: number;
  remark: string;
}

/** Limites de withdrawal */
export interface WithdrawalQuota {
  currency: string;
  limitBTCAmount: string;
  usedBTCAmount: string;
  remainAmount: string;
  availableAmount: string;
  withdrawMinFee: string;
  innerWithdrawMinFee: string;
  withdrawMinSize: string;
  isWithdrawEnabled: boolean;
  precision: number;
  chain: string;
}

/** Registro de withdrawal */
export interface WithdrawalRecord {
  id: string;
  currency: string;
  chain: string;
  status: string;
  address: string;
  memo: string;
  isInner: boolean;
  amount: string;
  fee: string;
  walletTxId: string;
  createdAt: number;
  updatedAt: number;
  remark: string;
}

/** Parâmetros de withdrawal */
export interface WithdrawParams {
  currency: string;
  address: string;
  amount: string;
  memo?: string;
  isInner?: boolean;
  remark?: string;
  chain?: string;
  feeDeductType?: 'INTERNAL' | 'EXTERNAL';
}

// ============================================================================
// TIPOS - Transfer & Fees
// ============================================================================

/** Limites de transferência */
export interface TransferQuota {
  currency: string;
  balance: string;
  available: string;
  holds: string;
  transferable: string;
}

/** Parâmetros de flex transfer */
export interface FlexTransferParams {
  clientOid: string;
  currency: string;
  amount: string;
  fromUserId?: string;
  fromAccountType: string;
  fromAccountTag?: string;
  type: string;
  toUserId?: string;
  toAccountType: string;
  toAccountTag?: string;
}

/** Resposta de transfer */
export interface TransferResponse {
  orderId: string;
}

/** Fee básica Spot/Margin */
export interface BasicFee {
  takerFeeRate: string;
  makerFeeRate: string;
}

/** Fee de um par de trading Futures */
export interface TradeFee {
  symbol: string;
  takerFeeRate: string;
  makerFeeRate: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function buildEndpoint(base: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

// ============================================================================
// ACCOUNT & FUNDING
// ============================================================================

/**
 * Resumo da conta do usuário
 * GET /api/v2/user-info
 */
export async function getAccountSummaryInfo(): Promise<AccountSummaryInfo> {
  const response = await kucoinAccountRequester.executeRequest<AccountSummaryInfo>(
    'GET',
    '/api/v2/user-info',
  );
  return response.data;
}

/**
 * Informações da API key
 * GET /api/v1/user/api-key
 */
export async function getApikeyInfo(): Promise<ApiKeyInfo> {
  const response = await kucoinAccountRequester.executeRequest<ApiKeyInfo>(
    'GET',
    '/api/v1/user/api-key',
  );
  return response.data;
}

/**
 * Verificar se conta HF Spot está aberta
 * GET /api/v1/hf/accounts/opened
 */
export async function getAccountTypeSpot(): Promise<HfAccountOpened> {
  const response = await kucoinAccountRequester.executeRequest<HfAccountOpened>(
    'GET',
    '/api/v1/hf/accounts/opened',
  );
  return response.data;
}

/**
 * Detalhe de uma conta específica
 * GET /api/v1/accounts/{accountId}
 */
export async function getAccountDetailSpot(accountId: string): Promise<AccountDetail> {
  const response = await kucoinAccountRequester.executeRequest<AccountDetail>(
    'GET',
    `/api/v1/accounts/${accountId}`,
  );
  return response.data;
}

/**
 * Ledger Spot/Margin
 * GET /api/v1/accounts/ledgers
 */
export async function getAccountLedgersSpotMargin(params?: Record<string, string | number | boolean | undefined>): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: LedgerEntry[] }> {
  const endpoint = buildEndpoint('/api/v1/accounts/ledgers', params);
  const response = await kucoinAccountRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: LedgerEntry[] }>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Ledger Trade HF
 * GET /api/v1/hf/accounts/ledgers
 */
export async function getAccountLedgersTradeHf(params?: Record<string, string | number | boolean | undefined>): Promise<LedgerEntry[]> {
  const endpoint = buildEndpoint('/api/v1/hf/accounts/ledgers', params);
  const response = await kucoinAccountRequester.executeRequest<LedgerEntry[]>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Ledger Margin HF
 * GET /api/v3/hf/margin/account/ledgers
 */
export async function getAccountLedgersMarginHf(params?: Record<string, string | number | boolean | undefined>): Promise<LedgerEntry[]> {
  const endpoint = buildEndpoint('/api/v3/hf/margin/account/ledgers', params);
  const response = await kucoinAccountRequester.executeRequest<LedgerEntry[]>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Ledger Futures (Transaction History)
 * GET /api/v1/transaction-history
 */
export async function getAccountLedgersFutures(params?: Record<string, string | number | boolean | undefined>): Promise<{ dataList: FuturesLedgerEntry[]; hasMore: boolean }> {
  const endpoint = buildEndpoint('/api/v1/transaction-history', params);
  const response = await kucoinAccountRequester.executeRequest<{ dataList: FuturesLedgerEntry[]; hasMore: boolean }>(
    'GET',
    endpoint,
  );
  return response.data;
}

// ============================================================================
// SUB ACCOUNTS
// ============================================================================

/**
 * Criar sub-conta
 * POST /api/v2/sub/user/created
 */
export async function addSubAccount(params: { subName: string; password: string; access: string; remarks?: string }): Promise<SubAccountCreated> {
  const response = await kucoinAccountRequester.executeRequest<SubAccountCreated>(
    'POST',
    '/api/v2/sub/user/created',
    params as unknown as Record<string, unknown>,
  );
  return response.data;
}

/**
 * Habilitar permissão Margin para sub-conta
 * POST /api/v3/sub/user/margin/enable
 */
export async function addSubAccountMarginPermission(subUserId: string): Promise<{ subUserId: string }> {
  const response = await kucoinAccountRequester.executeRequest<{ subUserId: string }>(
    'POST',
    '/api/v3/sub/user/margin/enable',
    { subUserId },
  );
  return response.data;
}

/**
 * Habilitar permissão Futures para sub-conta
 * POST /api/v3/sub/user/futures/enable
 */
export async function addSubAccountFuturesPermission(subUserId: string): Promise<{ subUserId: string }> {
  const response = await kucoinAccountRequester.executeRequest<{ subUserId: string }>(
    'POST',
    '/api/v3/sub/user/futures/enable',
    { subUserId },
  );
  return response.data;
}

/**
 * Listar sub-contas (resumo)
 * GET /api/v2/sub/user
 */
export async function getSubAccountListSummary(params?: Record<string, string | number | boolean | undefined>): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SubAccountSummary[] }> {
  const endpoint = buildEndpoint('/api/v2/sub/user', params);
  const response = await kucoinAccountRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SubAccountSummary[] }>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Balance detalhado de uma sub-conta
 * GET /api/v1/sub-accounts/{subUserId}
 */
export async function getSubAccountDetailBalance(subUserId: string): Promise<SubAccountBalance> {
  const response = await kucoinAccountRequester.executeRequest<SubAccountBalance>(
    'GET',
    `/api/v1/sub-accounts/${subUserId}`,
  );
  return response.data;
}

/**
 * Listar balances Spot de sub-contas
 * GET /api/v2/sub-accounts
 */
export async function getSubAccountListSpotBalance(params?: Record<string, string | number | boolean | undefined>): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SubAccountSpotBalance[] }> {
  const endpoint = buildEndpoint('/api/v2/sub-accounts', params);
  const response = await kucoinAccountRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SubAccountSpotBalance[] }>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Listar balances Futures de sub-contas
 * GET /api/v1/account-overview-all
 */
export async function getSubAccountListFuturesBalance(params?: Record<string, string | number | boolean | undefined>): Promise<SubAccountFuturesBalance> {
  const endpoint = buildEndpoint('/api/v1/account-overview-all', params);
  const response = await kucoinAccountRequester.executeRequest<SubAccountFuturesBalance>(
    'GET',
    endpoint,
  );
  return response.data;
}

// ============================================================================
// DEPOSITS
// ============================================================================

/**
 * Criar endereço de depósito
 * POST /api/v3/deposit-address/create
 */
export async function addDepositAddress(currency: string, chain?: string): Promise<DepositAddress> {
  const body: Record<string, string> = { currency };
  if (chain) body.chain = chain;
  const response = await kucoinAccountRequester.executeRequest<DepositAddress>(
    'POST',
    '/api/v3/deposit-address/create',
    body,
  );
  return response.data;
}

/**
 * Obter endereço de depósito
 * GET /api/v3/deposit-addresses
 */
export async function getDepositAddress(currency: string, chain?: string): Promise<DepositAddress[]> {
  const endpoint = buildEndpoint('/api/v3/deposit-addresses', { currency, chain });
  const response = await kucoinAccountRequester.executeRequest<DepositAddress[]>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Histórico de depósitos
 * GET /api/v1/deposits
 */
export async function getDepositHistory(params?: Record<string, string | number | boolean | undefined>): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: DepositRecord[] }> {
  const endpoint = buildEndpoint('/api/v1/deposits', params);
  const response = await kucoinAccountRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: DepositRecord[] }>(
    'GET',
    endpoint,
  );
  return response.data;
}

// ============================================================================
// WITHDRAWALS
// ============================================================================

/**
 * Obter limites de withdrawal
 * GET /api/v1/withdrawals/quotas
 */
export async function getWithdrawalQuotas(currency: string, chain?: string): Promise<WithdrawalQuota> {
  const endpoint = buildEndpoint('/api/v1/withdrawals/quotas', { currency, chain });
  const response = await kucoinAccountRequester.executeRequest<WithdrawalQuota>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Executar withdrawal
 * POST /api/v3/withdrawals
 */
export async function withdraw(params: WithdrawParams): Promise<{ withdrawalId: string }> {
  const response = await kucoinAccountRequester.executeRequest<{ withdrawalId: string }>(
    'POST',
    '/api/v3/withdrawals',
    params as unknown as Record<string, unknown>,
  );
  return response.data;
}

/**
 * Cancelar withdrawal
 * DELETE /api/v1/withdrawals/{withdrawalId}
 */
export async function cancelWithdrawal(withdrawalId: string): Promise<void> {
  await kucoinAccountRequester.executeRequest<void>(
    'DELETE',
    `/api/v1/withdrawals/${withdrawalId}`,
  );
}

/**
 * Histórico de withdrawals
 * GET /api/v1/withdrawals
 */
export async function getWithdrawalHistory(params?: Record<string, string | number | boolean | undefined>): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: WithdrawalRecord[] }> {
  const endpoint = buildEndpoint('/api/v1/withdrawals', params);
  const response = await kucoinAccountRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: WithdrawalRecord[] }>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Detalhes de withdrawal por ID
 * GET /api/v1/withdrawals/{withdrawalId}
 */
export async function getWithdrawalById(withdrawalId: string): Promise<WithdrawalRecord> {
  const response = await kucoinAccountRequester.executeRequest<WithdrawalRecord>(
    'GET',
    `/api/v1/withdrawals/${withdrawalId}`,
  );
  return response.data;
}

// ============================================================================
// TRANSFERS
// ============================================================================

/**
 * Limites de transferência
 * GET /api/v1/accounts/transferable
 */
export async function getTransferQuotas(currency: string, type: string): Promise<TransferQuota> {
  const endpoint = buildEndpoint('/api/v1/accounts/transferable', { currency, type });
  const response = await kucoinAccountRequester.executeRequest<TransferQuota>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Flex Transfer (universal)
 * POST /api/v3/accounts/universal-transfer
 */
export async function flexTransfer(params: FlexTransferParams): Promise<TransferResponse> {
  const response = await kucoinAccountRequester.executeRequest<TransferResponse>(
    'POST',
    '/api/v3/accounts/universal-transfer',
    params as unknown as Record<string, unknown>,
  );
  return response.data;
}

// ============================================================================
// TRADE FEES
// ============================================================================

/**
 * Fee básica Spot/Margin
 * GET /api/v1/base-fee
 */
export async function getBasicFeeSpotMargin(currencyType?: string): Promise<BasicFee> {
  const endpoint = buildEndpoint('/api/v1/base-fee', { currencyType });
  const response = await kucoinAccountRequester.executeRequest<BasicFee>(
    'GET',
    endpoint,
  );
  return response.data;
}

/**
 * Fee real Futures por símbolo
 * GET /api/v1/trade-fees
 */
export async function getActualFeeFutures(symbol: string): Promise<TradeFee[]> {
  const endpoint = buildEndpoint('/api/v1/trade-fees', { symbol });
  const response = await kucoinAccountRequester.executeRequest<TradeFee[]>(
    'GET',
    endpoint,
  );
  return response.data;
}

// ============================================================================
// STATUS & CIRCUIT BREAKER
// ============================================================================

export function isAccountConfigured(): boolean {
  return Boolean(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

export function getAccountCircuitBreakerStatus() {
  return kucoinAccountRequester.getCircuitBreakerStatus();
}

// ============================================================================
// EXPORT
// ============================================================================

export default {
  // Account & Funding
  getAccountSummaryInfo,
  getApikeyInfo,
  getAccountTypeSpot,
  getAccountDetailSpot,
  getAccountLedgersSpotMargin,
  getAccountLedgersTradeHf,
  getAccountLedgersMarginHf,
  getAccountLedgersFutures,
  // Sub Accounts
  addSubAccount,
  addSubAccountMarginPermission,
  addSubAccountFuturesPermission,
  getSubAccountListSummary,
  getSubAccountDetailBalance,
  getSubAccountListSpotBalance,
  getSubAccountListFuturesBalance,
  // Deposits
  addDepositAddress,
  getDepositAddress,
  getDepositHistory,
  // Withdrawals
  getWithdrawalQuotas,
  withdraw,
  cancelWithdrawal,
  getWithdrawalHistory,
  getWithdrawalById,
  // Transfers
  getTransferQuotas,
  flexTransfer,
  // Trade Fees
  getBasicFeeSpotMargin,
  getActualFeeFutures,
  // Status
  isAccountConfigured,
  getAccountCircuitBreakerStatus,
  initKucoinAccountMetrics,
};

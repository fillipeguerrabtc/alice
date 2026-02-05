// Serviço Wise para Alice Enterprise Platform
// Implementa todas as funcionalidades da API Wise
// Documentação: https://docs.wise.com/api-docs/

import { wiseRequest, getWiseProfileId, isWiseSandbox } from './wiseClient.js';
import { createLogger } from '@alice/logger';
import crypto from 'crypto';

// Logger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('wise-service');

// Tipos para a API Wise

// Perfil
interface WiseProfile {
  id: number;
  type: 'personal' | 'business';
  details: {
    name?: string;
    firstName?: string;
    lastName?: string;
  };
}

// Saldo
interface WiseBalance {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  investmentState?: 'NOT_INVESTED' | 'INVESTED' | 'DIVESTING' | 'UNKNOWN';
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount?: {
    value: number;
    currency: string;
  };
  cashAmount?: {
    value: number;
    currency: string;
  };
  totalWorth?: {
    value: number;
    currency: string;
  };
  creationTime?: string;
  modificationTime?: string;
  visible?: boolean;
}

// Cotação
interface WiseQuoteRequest {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
  payOut?: 'BANK_TRANSFER' | 'BALANCE' | 'SWIFT' | 'SWIFT_OUR' | 'INTERAC' | null;
  preferredPayIn?: 'BANK_TRANSFER' | 'BALANCE' | null;
  targetAccount?: number;
}

interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fee: number;
  deliveryEstimate: string | null;
  formattedEstimatedDelivery: string | null;
  expirationTime: string | null;
}

interface WiseQuotePaymentOption {
  payIn: string;
  payOut: string;
  disabled: boolean;
  disabledReason?: { code?: string; message?: string };
  fee?: {
    transferwise?: number;
    payIn?: number;
    discount?: number;
    partner?: number;
    total?: number;
  };
  estimatedDelivery?: string;
  formattedEstimatedDelivery?: string;
}

interface WiseQuoteApiResponse {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  rateExpirationTime?: string;
  paymentOptions?: WiseQuotePaymentOption[];
}

// Destinatário
interface WiseRecipientRequest {
  currency: string;
  type: string;
  profile: number;
  accountHolderName: string;
  details: Record<string, string>;
}

interface WiseRecipient {
  id: number;
  profile: number;
  accountHolderName: string;
  type: string;
  currency: string;
  active: boolean;
  details: Record<string, string>;
}

// Transferência
interface WiseTransferRequest {
  targetAccount: number;
  quoteUuid: string;
  customerTransactionId: string;
  details: {
    reference: string;
    transferPurpose?: string;
    sourceOfFunds?: string;
  };
}

interface WiseTransfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount: number;
  quote: number;
  quoteUuid: string;
  status: string;
  reference: string;
  rate: number;
  created: string;
  business: number;
  transferRequest: number;
  details: {
    reference: string;
  };
  hasActiveIssues: boolean;
  sourceCurrency: string;
  sourceValue: number;
  targetCurrency: string;
  targetValue: number;
  customerTransactionId: string;
}

// Batch Group
interface WiseBatchGroupRequest {
  name: string;
  sourceCurrency: string;
}

interface WiseBatchGroup {
  id: string;
  version: number;
  name: string;
  sourceCurrency: string;
  status: 'NEW' | 'COMPLETED' | 'CANCELLED';
  transferIds: number[];
  payInDetails?: {
    type: string;
    bankAccount?: {
      bankName: string;
      accountNumber: string;
      sortCode?: string;
      iban?: string;
      bic?: string;
    };
  };
}

// Taxas de câmbio
interface WiseExchangeRate {
  rate: number;
  source: string;
  target: string;
  time: string;
}

interface WiseBalanceMovementRequest {
  quoteId?: string;
  sourceBalanceId?: number;
  targetBalanceId?: number;
  amount?: { value: number; currency: string };
}

interface WiseBalanceMovement {
  id: number;
  type: string;
  state: string;
  creationTime: string;
  sourceAmount?: { value: number; currency: string };
  targetAmount?: { value: number; currency: string };
  rate?: number;
  feeAmounts?: Array<{ value: number; currency: string }>;
}

interface WiseBalanceStatement {
  type: string;
  amount: { value: number; currency: string };
  date: string;
  note?: string;
  totalFees?: { value: number; currency: string };
  reference?: string;
  runningBalance?: { value: number; currency: string };
}

interface WiseBalanceStatementResponse {
  accountId: number;
  currency: string;
  intervalStart: string;
  intervalEnd: string;
  transactions: WiseBalanceStatement[];
}

interface WiseBalanceCapacity {
  hasLimit: boolean;
  depositLimit?: { amount: number; currency: string };
}

interface WiseTotalFunds {
  totalWorth: { value: number; currency: string };
  totalAvailable: { value: number; currency: string };
  totalCash: { value: number; currency: string };
  overdraft?: {
    limit?: { value: number; currency: string };
    used?: { value: number; currency: string };
    available?: { value: number; currency: string };
  };
}

// Classe de serviço Wise
export class WiseService {
  // Obter perfis
  async getProfiles(): Promise<WiseProfile[]> {
    logger.info('Obtendo perfis Wise');
    return wiseRequest<WiseProfile[]>('GET', '/v1/profiles');
  }

  // Obter saldos (conta multi-moeda)
  async getBalances(types: Array<'STANDARD' | 'SAVINGS'> = ['STANDARD', 'SAVINGS']): Promise<WiseBalance[]> {
    const profileId = getWiseProfileId();
    logger.info({ profileId }, 'Obtendo saldos Wise');

    const typesParam = types.join(',');
    return wiseRequest<WiseBalance[]>(
      'GET',
      `/v4/profiles/${profileId}/balances?types=${typesParam}`
    );
  }

  // Obter saldo por moeda
  async getBalanceByCurrency(currency: string): Promise<WiseBalance | null> {
    const balances = await this.getBalances();
    return balances.find(b => b.currency === currency) || null;
  }

  async getBalanceById(balanceId: number): Promise<WiseBalance> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, balanceId }, 'Obtendo saldo Wise');
    return wiseRequest<WiseBalance>('GET', `/v4/profiles/${profileId}/balances/${balanceId}`);
  }

  async createBalance(request: { currency: string; type: 'STANDARD' | 'SAVINGS'; name?: string }): Promise<WiseBalance> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, currency: request.currency, type: request.type }, 'Criando saldo Wise');
    const idempotenceKey = crypto.randomUUID();
    return wiseRequest<WiseBalance>(
      'POST',
      `/v4/profiles/${profileId}/balances`,
      request,
      { 'X-idempotence-uuid': idempotenceKey }
    );
  }

  async deleteBalance(balanceId: number): Promise<WiseBalance> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, balanceId }, 'Removendo saldo Wise');
    return wiseRequest<WiseBalance>('DELETE', `/v4/profiles/${profileId}/balances/${balanceId}`);
  }

  // Criar cotação
  async createQuote(request: WiseQuoteRequest): Promise<WiseQuote> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, ...request }, 'Criando cotação Wise');

    const payload: Record<string, unknown> = {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    };
    if (request.sourceAmount !== undefined) payload.sourceAmount = request.sourceAmount;
    if (request.targetAmount !== undefined) payload.targetAmount = request.targetAmount;
    if (request.payOut !== undefined) payload.payOut = request.payOut;
    if (request.preferredPayIn !== undefined) payload.preferredPayIn = request.preferredPayIn;
    if (request.targetAccount !== undefined) payload.targetAccount = request.targetAccount;

    const response = await wiseRequest<WiseQuoteApiResponse>('POST', `/v3/profiles/${profileId}/quotes`, payload);
    const paymentOptions = response.paymentOptions || [];
    const preferredPayIn = request.preferredPayIn ?? null;
    const preferredPayOut = request.payOut ?? null;

    const selectedOption = paymentOptions.find((option) => {
      if (option.disabled) return false;
      if (preferredPayIn && option.payIn !== preferredPayIn) return false;
      if (preferredPayOut && option.payOut !== preferredPayOut) return false;
      return true;
    }) ?? paymentOptions.find((option) => !option.disabled) ?? paymentOptions[0];

    const fee = selectedOption?.fee?.total
      ?? selectedOption?.fee?.transferwise
      ?? selectedOption?.fee?.payIn
      ?? 0;

    return {
      id: response.id,
      sourceCurrency: response.sourceCurrency,
      targetCurrency: response.targetCurrency,
      sourceAmount: response.sourceAmount,
      targetAmount: response.targetAmount,
      rate: response.rate,
      fee,
      deliveryEstimate: selectedOption?.estimatedDelivery ?? null,
      formattedEstimatedDelivery: selectedOption?.formattedEstimatedDelivery ?? null,
      expirationTime: response.rateExpirationTime ?? null,
    };
  }

  // Obter taxas de câmbio
  async getExchangeRates(source: string, target: string): Promise<WiseExchangeRate> {
    logger.info({ source, target }, 'Obtendo taxa de câmbio Wise');
    
    const rates = await wiseRequest<WiseExchangeRate[]>(
      'GET',
      `/v1/rates?source=${source}&target=${target}`
    );
    
    if (rates.length === 0) {
      throw new Error(`Taxa não encontrada para ${source}/${target}`);
    }
    
    return rates[0];
  }

  async createBalanceMovement(request: WiseBalanceMovementRequest): Promise<WiseBalanceMovement> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, request }, 'Executando movimento de saldo Wise');
    const idempotenceKey = crypto.randomUUID();
    return wiseRequest<WiseBalanceMovement>(
      'POST',
      `/v2/profiles/${profileId}/balance-movements`,
      request,
      { 'X-idempotence-uuid': idempotenceKey }
    );
  }

  async getBalanceStatement(params: {
    balanceId: number;
    intervalStart: string;
    intervalEnd: string;
    currency: string;
    type?: 'COMPACT' | 'FLAT';
  }): Promise<WiseBalanceStatementResponse> {
    const profileId = getWiseProfileId();
    const query = new URLSearchParams({
      currency: params.currency,
      intervalStart: params.intervalStart,
      intervalEnd: params.intervalEnd,
      type: params.type ?? 'COMPACT',
    });
    logger.info({ profileId, balanceId: params.balanceId }, 'Obtendo extrato Wise');
    return wiseRequest<WiseBalanceStatementResponse>(
      'GET',
      `/v1/profiles/${profileId}/balance-statements/${params.balanceId}/statement.json?${query.toString()}`
    );
  }

  async getBalanceCapacity(currency: string): Promise<WiseBalanceCapacity> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, currency }, 'Obtendo limite de depósito Wise');
    return wiseRequest<WiseBalanceCapacity>('GET', `/v1/profiles/${profileId}/balance-capacity?currency=${currency}`);
  }

  async getTotalFunds(currency: string): Promise<WiseTotalFunds> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, currency }, 'Obtendo total de fundos Wise');
    return wiseRequest<WiseTotalFunds>('GET', `/v1/profiles/${profileId}/total-funds/${currency}`);
  }

  // Listar destinatários
  async listRecipients(currency?: string): Promise<WiseRecipient[]> {
    const profileId = getWiseProfileId();
    let endpoint = `/v1/accounts?profile=${profileId}`;
    
    if (currency) {
      endpoint += `&currency=${currency}`;
    }
    
    logger.info({ profileId, currency }, 'Listando destinatários Wise');
    return wiseRequest<WiseRecipient[]>('GET', endpoint);
  }

  // Criar destinatário
  async createRecipient(request: Omit<WiseRecipientRequest, 'profile'>): Promise<WiseRecipient> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, accountHolderName: request.accountHolderName }, 'Criando destinatário Wise');
    
    return wiseRequest<WiseRecipient>('POST', '/v1/accounts', {
      ...request,
      profile: parseInt(profileId),
    });
  }

  // Obter destinatário por ID
  async getRecipient(recipientId: number): Promise<WiseRecipient> {
    logger.info({ recipientId }, 'Obtendo destinatário Wise');
    return wiseRequest<WiseRecipient>('GET', `/v1/accounts/${recipientId}`);
  }

  // Excluir destinatário
  async deleteRecipient(recipientId: number): Promise<void> {
    logger.info({ recipientId }, 'Excluindo destinatário Wise');
    await wiseRequest<void>('DELETE', `/v1/accounts/${recipientId}`);
  }

  // Criar transferência
  async createTransfer(request: WiseTransferRequest): Promise<WiseTransfer> {
    logger.info({ targetAccount: request.targetAccount, quoteUuid: request.quoteUuid }, 'Criando transferência Wise');
    return wiseRequest<WiseTransfer>('POST', '/v1/transfers', request);
  }

  // Obter transferência por ID
  async getTransfer(transferId: number): Promise<WiseTransfer> {
    logger.info({ transferId }, 'Obtendo transferência Wise');
    return wiseRequest<WiseTransfer>('GET', `/v1/transfers/${transferId}`);
  }

  // Listar transferências
  async listTransfers(limit = 20, offset = 0): Promise<WiseTransfer[]> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, limit, offset }, 'Listando transferências Wise');
    
    return wiseRequest<WiseTransfer[]>(
      'GET',
      `/v1/transfers?profile=${profileId}&limit=${limit}&offset=${offset}`
    );
  }

  // Financiar transferência (simular no sandbox)
  async fundTransfer(transferId: number): Promise<{ status: string }> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, transferId }, 'Financiando transferência Wise');
    
    return wiseRequest<{ status: string }>(
      'POST',
      `/v3/profiles/${profileId}/transfers/${transferId}/payments`,
      { type: 'BALANCE' }
    );
  }

  // Cancelar transferência
  async cancelTransfer(transferId: number): Promise<WiseTransfer> {
    logger.info({ transferId }, 'Cancelando transferência Wise');
    return wiseRequest<WiseTransfer>('PUT', `/v1/transfers/${transferId}/cancel`);
  }

  // Criar batch group (pagamentos em lote)
  async createBatchGroup(request: WiseBatchGroupRequest): Promise<WiseBatchGroup> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, name: request.name }, 'Criando batch group Wise');
    
    return wiseRequest<WiseBatchGroup>(
      'POST',
      `/v3/profiles/${profileId}/batch-groups`,
      request
    );
  }

  // Adicionar transferência ao batch
  async addTransferToBatch(
    batchGroupId: string,
    transferRequest: WiseTransferRequest
  ): Promise<WiseTransfer> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, batchGroupId }, 'Adicionando transferência ao batch Wise');
    
    return wiseRequest<WiseTransfer>(
      'POST',
      `/v3/profiles/${profileId}/batch-groups/${batchGroupId}/transfers`,
      transferRequest
    );
  }

  // Completar batch group
  async completeBatchGroup(batchGroupId: string, version: number): Promise<WiseBatchGroup> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, batchGroupId }, 'Completando batch group Wise');
    
    return wiseRequest<WiseBatchGroup>(
      'PATCH',
      `/v3/profiles/${profileId}/batch-groups/${batchGroupId}`,
      { status: 'COMPLETED', version }
    );
  }

  // Obter batch group
  async getBatchGroup(batchGroupId: string): Promise<WiseBatchGroup> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, batchGroupId }, 'Obtendo batch group Wise');
    
    return wiseRequest<WiseBatchGroup>(
      'GET',
      `/v3/profiles/${profileId}/batch-groups/${batchGroupId}`
    );
  }

  // Listar batch groups
  async listBatchGroups(): Promise<WiseBatchGroup[]> {
    const profileId = getWiseProfileId();
    logger.info({ profileId }, 'Listando batch groups Wise');
    
    return wiseRequest<WiseBatchGroup[]>(
      'GET',
      `/v3/profiles/${profileId}/batch-groups`
    );
  }

  // Obter tipos de contas disponíveis por moeda
  async getRecipientRequirements(
    sourceCurrency: string,
    targetCurrency: string,
    sourceAmount: number
  ): Promise<unknown[]> {
    const _profileId = getWiseProfileId(); // Validação de configuração
    logger.info({ sourceCurrency, targetCurrency, sourceAmount }, 'Obtendo requisitos de destinatário Wise');
    
    const quote = await this.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
    });
    
    return wiseRequest<unknown[]>(
      'GET',
      `/v1/quotes/${quote.id}/account-requirements`
    );
  }

  // Verificar se está em modo sandbox
  isSandboxMode(): boolean {
    return isWiseSandbox();
  }
}

// Singleton do serviço
export const wiseService = new WiseService();

// Tipos exportados
export type {
  WiseProfile,
  WiseBalance,
  WiseQuote,
  WiseQuoteRequest,
  WiseRecipient,
  WiseRecipientRequest,
  WiseTransfer,
  WiseTransferRequest,
  WiseBalanceMovement,
  WiseBalanceStatementResponse,
  WiseBalanceCapacity,
  WiseTotalFunds,
  WiseBatchGroup,
  WiseBatchGroupRequest,
  WiseExchangeRate,
};

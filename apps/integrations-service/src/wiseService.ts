// Serviço Wise para Alice Enterprise Platform
// Implementa todas as funcionalidades da API Wise
// Documentação: https://docs.wise.com/api-docs/

import {
  wiseRequest,
  wiseRequestRaw,
  requestWiseOAuthToken,
  type WiseOAuthTokenResponse,
  getWiseProfileId,
  isWiseSandbox,
} from './wiseClient.js';
import { createLogger } from '@alice/logger';
import { readOptionalStringEnv } from '@alice/config';
import crypto from 'crypto';

// Logger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('wise-service');

// Tipos para a API Wise

type WiseApiRecord = Record<string, unknown>;
type WiseApiList = WiseApiRecord[];

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
  private resolveProfileId(profileId?: number): number {
    if (profileId !== undefined) return profileId;
    return parseInt(getWiseProfileId(), 10);
  }

  private getClientCredentials(): { clientId: string; clientSecret: string } {
    const clientId = readOptionalStringEnv('WISE_CLIENT_ID');
    const clientSecret = readOptionalStringEnv('WISE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('WISE_CLIENT_ID/WISE_CLIENT_SECRET não configurados para OAuth');
    }
    return { clientId, clientSecret };
  }

  private getTwCardBaseUrl(): string {
    return isWiseSandbox() ? 'https://twcard.wise-sandbox.com' : 'https://twcard.wise.com';
  }

  async getClientCredentialsToken(): Promise<string> {
    const auth = this.getClientCredentials();
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await requestWiseOAuthToken(body, auth);
    return response.access_token;
  }

  // Obter perfis
  async getProfiles(): Promise<WiseProfile[]> {
    logger.info('Obtendo perfis Wise');
    return wiseRequest<WiseProfile[]>('GET', '/v1/profiles');
  }

  async getProfileById(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Obtendo perfil Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v1/profiles/${profileId}`);
  }

  async getCurrentUser(): Promise<WiseApiRecord> {
    logger.info('Obtendo usuário atual Wise');
    return wiseRequest<WiseApiRecord>('GET', '/v1/me');
  }

  async getUserById(userId: number): Promise<WiseApiRecord> {
    logger.info({ userId }, 'Obtendo usuário Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v1/users/${userId}`);
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

  async listActivities(params: {
    profileId?: number;
    monetaryResourceType?: string;
    status?: string;
    since?: string;
    until?: string;
    size?: number;
  }): Promise<WiseApiList> {
    const profileId = this.resolveProfileId(params.profileId);
    const query = new URLSearchParams();
    if (params.monetaryResourceType) query.set('monetaryResourceType', params.monetaryResourceType);
    if (params.status) query.set('status', params.status);
    if (params.since) query.set('since', params.since);
    if (params.until) query.set('until', params.until);
    if (params.size) query.set('size', params.size.toString());
    logger.info({ profileId }, 'Listando atividades Wise');
    return wiseRequest<WiseApiList>('GET', `/v1/profiles/${profileId}/activities?${query.toString()}`);
  }

  async getAccountDetails(profileId?: number): Promise<WiseApiRecord> {
    const resolvedProfileId = this.resolveProfileId(profileId);
    logger.info({ profileId: resolvedProfileId }, 'Obtendo detalhes de conta Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v1/profiles/${resolvedProfileId}/account-details`);
  }

  async listAccountDetailsOrders(profileId?: number): Promise<WiseApiList> {
    const resolvedProfileId = this.resolveProfileId(profileId);
    logger.info({ profileId: resolvedProfileId }, 'Listando account details orders Wise');
    return wiseRequest<WiseApiList>('GET', `/v1/profiles/${resolvedProfileId}/account-details-orders`);
  }

  async createAccountDetailsOrder(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando account details order Wise');
    const idempotenceKey = crypto.randomUUID();
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v1/profiles/${profileId}/account-details-orders`,
      payload,
      { 'X-idempotence-uuid': idempotenceKey }
    );
  }

  async listCards(profileId?: number): Promise<WiseApiList> {
    const resolvedProfileId = this.resolveProfileId(profileId);
    logger.info({ profileId: resolvedProfileId }, 'Listando cartões Wise');
    return wiseRequest<WiseApiList>('GET', `/v3/spend/profiles/${resolvedProfileId}/cards`);
  }

  async getCard(profileId: number, cardToken: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Obtendo cartão Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/cards/${cardToken}`);
  }

  async updateCardStatus(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Atualizando status do cartão Wise');
    return wiseRequest<WiseApiRecord>('PUT', `/v3/spend/profiles/${profileId}/cards/${cardToken}/status`, payload);
  }

  async resetCardPin(profileId: number, cardToken: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Resetando PIN do cartão Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v3/spend/profiles/${profileId}/cards/${cardToken}/pin/failed-attempts/reset`);
  }

  async getCardPermissions(profileId: number, cardToken: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Obtendo permissões do cartão Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/cards/${cardToken}/permissions`);
  }

  async updateCardPermission(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Atualizando permissão do cartão Wise');
    return wiseRequest<WiseApiRecord>('PUT', `/v3/spend/profiles/${profileId}/cards/${cardToken}/permissions`, payload);
  }

  async updateCardPermissionsBulk(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Atualizando permissões em lote Wise');
    return wiseRequest<WiseApiRecord>('PUT', `/v4/spend/profiles/${profileId}/cards/permissions`, payload);
  }

  async getTwCardEncryptionKey(): Promise<WiseApiRecord> {
    logger.info('Obtendo chave de criptografia TwCard');
    return wiseRequestRaw<WiseApiRecord>(
      'GET',
      '/twcard-data/v1/clientSideEncryption/fetchEncryptingKey',
      null,
      undefined,
      { baseUrl: this.getTwCardBaseUrl() }
    );
  }

  async getSensitiveCardDetails(cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ cardToken }, 'Obtendo dados sensíveis do cartão Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      '/twcard-data/v1/sensitive-card-data/details',
      JSON.stringify(payload),
      { 'x-tw-twcard-card-token': cardToken, 'Content-Type': 'application/json' },
      { includeContentType: false, baseUrl: this.getTwCardBaseUrl() }
    );
  }

  async getCardPin(cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ cardToken }, 'Obtendo PIN do cartão Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      '/twcard-data/v1/sensitive-card-data/pin',
      JSON.stringify(payload),
      { 'x-tw-twcard-card-token': cardToken, 'Content-Type': 'application/json' },
      { includeContentType: false, baseUrl: this.getTwCardBaseUrl() }
    );
  }

  async createCardOrder(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando card order Wise');
    const idempotenceKey = crypto.randomUUID();
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/card-orders`,
      payload,
      { 'X-idempotence-uuid': idempotenceKey }
    );
  }

  async getCardOrder(profileId: number, cardOrderId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardOrderId }, 'Obtendo card order Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/card-orders/${cardOrderId}`);
  }

  async listCardOrders(profileId: number, pageNumber = 1, pageSize = 10): Promise<WiseApiRecord> {
    logger.info({ profileId, pageNumber, pageSize }, 'Listando card orders Wise');
    const query = new URLSearchParams({ pageNumber: pageNumber.toString(), pageSize: pageSize.toString() });
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/card-orders?${query.toString()}`);
  }

  async listCardOrderAvailability(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Listando programas de cartão Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/card-orders/availability`);
  }

  async getCardOrderRequirements(profileId: number, cardOrderId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardOrderId }, 'Obtendo requisitos do card order Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/card-orders/${cardOrderId}/requirements`);
  }

  async validateCardOrderAddress(payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info('Validando endereço de card order Wise');
    return wiseRequest<WiseApiRecord>('POST', '/v3/spend/address/validate', payload);
  }

  async updateCardOrderStatus(profileId: number, cardOrderId: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardOrderId }, 'Atualizando status de card order Wise');
    return wiseRequest<WiseApiRecord>('PUT', `/v3/spend/profiles/${profileId}/card-orders/${cardOrderId}/status`, payload);
  }

  async setCardOrderPin(cardOrderId: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ cardOrderId }, 'Definindo PIN do card order Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      '/twcard-data/v1/sensitive-card-data/preset-pin',
      JSON.stringify(payload),
      { 'x-tw-twcard-order-id': cardOrderId, 'Content-Type': 'application/json' },
      { includeContentType: false, baseUrl: this.getTwCardBaseUrl() }
    );
  }

  async getCardTransaction(profileId: number, transactionId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, transactionId }, 'Obtendo transação de cartão Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/cards/transactions/${transactionId}`);
  }

  async listSpendControls(profileId: number): Promise<WiseApiList> {
    logger.info({ profileId }, 'Listando spend controls Wise');
    return wiseRequest<WiseApiList>('GET', `/v3/spend/profiles/${profileId}/spend-controls`);
  }

  async createSpendControl(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando spend control Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v3/spend/profiles/${profileId}/spend-controls`, payload);
  }

  async deleteSpendControl(profileId: number, ruleId: number): Promise<void> {
    logger.info({ profileId, ruleId }, 'Removendo spend control Wise');
    await wiseRequest<void>('DELETE', `/v3/spend/profiles/${profileId}/spend-controls/${ruleId}`);
  }

  async applySpendControl(profileId: number, ruleId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, ruleId }, 'Aplicando spend control Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v3/spend/profiles/${profileId}/spend-controls/${ruleId}/assign`, payload);
  }

  async unassignSpendControl(profileId: number, ruleId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, ruleId }, 'Removendo spend control do cartão');
    return wiseRequest<WiseApiRecord>('POST', `/v3/spend/profiles/${profileId}/spend-controls/${ruleId}/unassign`, payload);
  }

  async getSpendLimits(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Obtendo spend limits do perfil Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/spending-limits`);
  }

  async updateSpendLimits(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Atualizando spend limits do perfil Wise');
    return wiseRequest<WiseApiRecord>('PATCH', `/v3/spend/profiles/${profileId}/spending-limits`, payload);
  }

  async getCardSpendLimits(profileId: number, cardToken: string): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Obtendo spend limits do cartão Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/cards/${cardToken}/spending-limits`);
  }

  async updateCardSpendLimits(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Atualizando spend limits do cartão Wise');
    return wiseRequest<WiseApiRecord>('PATCH', `/v3/spend/profiles/${profileId}/cards/${cardToken}/spending-limits`, payload);
  }

  async deleteCardSpendLimits(profileId: number, cardToken: string): Promise<void> {
    logger.info({ profileId, cardToken }, 'Removendo spend limits do cartão Wise');
    await wiseRequest<void>('DELETE', `/v3/spend/profiles/${profileId}/cards/${cardToken}/spending-limits`);
  }

  async listDisputeReasons(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Listando razões de disputa Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/dispute-form/reasons`);
  }

  async getDisputeFlowStep(profileId: number, scheme: string, reason: string, transactionId: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, scheme, reason }, 'Obtendo step de disputa Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/dispute-form/flows/step/${scheme}/${reason}?transactionId=${transactionId}`,
      payload
    );
  }

  async submitDisputeFlow(profileId: number, scheme: string, reason: string, transactionId: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, scheme, reason }, 'Enviando disputa Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/dispute-form/flows/${scheme}/${reason}?transactionId=${transactionId}`,
      payload
    );
  }

  async uploadDisputeFile(profileId: number, formData: FormData): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Enviando arquivo de disputa Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v4/spend/profiles/${profileId}/dispute-form/file`,
      formData,
      undefined,
      { includeContentType: false }
    );
  }

  async listDisputes(profileId: number, status?: string): Promise<WiseApiRecord> {
    const query = status ? `?status=${status}` : '';
    logger.info({ profileId, status }, 'Listando disputas Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/disputes${query}`);
  }

  async getDispute(profileId: number, disputeId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, disputeId }, 'Obtendo disputa Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/spend/profiles/${profileId}/disputes/${disputeId}`);
  }

  async updateDisputeStatus(profileId: number, disputeId: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, disputeId }, 'Atualizando status de disputa Wise');
    return wiseRequest<WiseApiRecord>(
      'PUT',
      `/v3/spend/profiles/${profileId}/disputes/${disputeId}/status`,
      payload
    );
  }

  async getVerificationRequiredEvidences(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Obtendo evidências requeridas Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/profiles/${profileId}/verification-status/required-evidences`);
  }

  async uploadVerificationDocument(profileId: number, formData: FormData): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Enviando documento de verificação Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/profiles/${profileId}/verification-status/upload-document`,
      formData,
      undefined,
      { includeContentType: false }
    );
  }

  async uploadAdditionalEvidences(profileId: number, formData: FormData): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Enviando evidências adicionais Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v5/profiles/${profileId}/additional-verification/upload-evidences`,
      formData,
      undefined,
      { includeContentType: false }
    );
  }

  async createKycReview(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando KYC review Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v2/profiles/${profileId}/kyc-reviews`, payload);
  }

  async listKycReviews(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Listando KYC reviews Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v2/profiles/${profileId}/kyc-reviews`);
  }

  async getKycReview(profileId: number, kycReviewId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, kycReviewId }, 'Obtendo KYC review Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v2/profiles/${profileId}/kyc-reviews/${kycReviewId}`);
  }

  async getScaOneTimeToken(profileId: number): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Obtendo one-time token SCA Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v3/spend/profiles/${profileId}/one-time-token`);
  }

  async createScaSession(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando sessão SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/sessions`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async createPin(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando PIN SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/pin`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async verifyPin(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Verificando PIN SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/pin/verify`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async deletePin(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Excluindo PIN SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'DELETE',
      `/v3/spend/profiles/${profileId}/sca/pin`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async createDeviceFingerprint(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando device fingerprint SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/device-fingerprint`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async verifyDeviceFingerprint(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Verificando device fingerprint SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/device-fingerprint/verify`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async deleteDeviceFingerprint(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Excluindo device fingerprint SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'DELETE',
      `/v3/spend/profiles/${profileId}/sca/device-fingerprint`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async createFacemap(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Criando facemap SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/facemap`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async verifyFacemap(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Verificando facemap SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'POST',
      `/v3/spend/profiles/${profileId}/sca/facemap/verify`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async deleteFacemap(profileId: number, josePayload: string): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Excluindo facemap SCA Wise');
    return wiseRequestRaw<WiseApiRecord>(
      'DELETE',
      `/v3/spend/profiles/${profileId}/sca/facemap`,
      josePayload,
      { 'Content-Type': 'application/jose+json', 'X-TW-JOSE-METHOD': 'jwe' },
      { includeContentType: false }
    );
  }

  async listWebhooks(scope: { profileId?: number; application?: boolean }): Promise<WiseApiRecord> {
    if (scope.application) {
      logger.info('Listando webhooks de aplicação Wise');
      return wiseRequest<WiseApiRecord>('GET', '/v2/webhooks');
    }
    const profileId = this.resolveProfileId(scope.profileId);
    logger.info({ profileId }, 'Listando webhooks de perfil Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v3/profiles/${profileId}/subscriptions`);
  }

  async createWebhook(scope: { profileId?: number; application?: boolean }, payload: WiseApiRecord): Promise<WiseApiRecord> {
    if (scope.application) {
      logger.info('Criando webhook de aplicação Wise');
      return wiseRequest<WiseApiRecord>('POST', '/v2/webhooks', payload);
    }
    const profileId = this.resolveProfileId(scope.profileId);
    logger.info({ profileId }, 'Criando webhook de perfil Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v3/profiles/${profileId}/subscriptions`, payload);
  }

  async deleteWebhook(scope: { profileId?: number; application?: boolean }, subscriptionId: string): Promise<void> {
    if (scope.application) {
      logger.info({ subscriptionId }, 'Removendo webhook de aplicação Wise');
      await wiseRequest<void>('DELETE', `/v2/webhooks/${subscriptionId}`);
      return;
    }
    const profileId = this.resolveProfileId(scope.profileId);
    logger.info({ profileId, subscriptionId }, 'Removendo webhook de perfil Wise');
    await wiseRequest<void>('DELETE', `/v3/profiles/${profileId}/subscriptions/${subscriptionId}`);
  }

  async simulateTransfer(transferId: number, action: string): Promise<WiseApiRecord> {
    logger.info({ transferId, action }, 'Simulando estado de transferência Wise');
    return wiseRequest<WiseApiRecord>('GET', `/v1/simulation/transfers/${transferId}/${action}`);
  }

  async simulateVerification(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Simulando verificação de perfil Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v1/simulation/profiles/${profileId}/verifications`, payload);
  }

  async simulateBalanceTopup(payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info('Simulando topup de saldo Wise');
    return wiseRequest<WiseApiRecord>('POST', '/v1/simulation/balance/topup', payload);
  }

  async simulateCardTransaction(profileId: number, cardToken: string, action: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken, action }, 'Simulando transação de cartão Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v1/simulation/spend/profiles/${profileId}/cards/${cardToken}/transactions/${action}`,
      payload
    );
  }

  async simulateCardAuthorisation(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Simulando autorização de cartão Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v2/simulation/spend/profiles/${profileId}/cards/${cardToken}/transactions/authorisation`,
      payload
    );
  }

  async simulateCardRefund(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Simulando reembolso de cartão Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v2/simulation/spend/profiles/${profileId}/cards/${cardToken}/transactions/authorisation`,
      payload
    );
  }

  async simulateCardProduction(profileId: number, cardToken: string, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Simulando produção de cartão Wise');
    return wiseRequest<WiseApiRecord>(
      'POST',
      `/v1/simulation/spend/profiles/${profileId}/cards/${cardToken}/production`,
      payload
    );
  }

  async simulateCardRecentTransactions(profileId: number, cardToken: string, limit = 10): Promise<WiseApiRecord> {
    logger.info({ profileId, cardToken }, 'Listando transações simuladas do cartão Wise');
    return wiseRequest<WiseApiRecord>(
      'GET',
      `/v2/simulation/spend/profiles/${profileId}/cards/${cardToken}/transactions?limit=${limit}`
    );
  }

  async simulateKycRequirements(profileId: number, kycReviewId: string): Promise<WiseApiRecord> {
    logger.info({ profileId, kycReviewId }, 'Simulando requisitos KYC Wise');
    return wiseRequest<WiseApiRecord>(
      'GET',
      `/v2/simulation/profiles/${profileId}/kyc-reviews/${kycReviewId}/requirements`
    );
  }

  async simulateBankTransactionImport(profileId: number, payload: WiseApiRecord): Promise<WiseApiRecord> {
    logger.info({ profileId }, 'Simulando importação de transações bancárias Wise');
    return wiseRequest<WiseApiRecord>('POST', `/v1/simulation/profiles/${profileId}/bank-transactions/import`, payload);
  }

  async exchangeRegistrationCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<WiseOAuthTokenResponse> {
    const auth = this.getClientCredentials();
    const body = new URLSearchParams({
      grant_type: 'registration_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    logger.info('Trocando registration_code Wise');
    return requestWiseOAuthToken(body, auth);
  }

  async exchangeAuthorizationCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<WiseOAuthTokenResponse> {
    const auth = this.getClientCredentials();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    logger.info('Trocando authorization_code Wise');
    return requestWiseOAuthToken(body, auth);
  }

  async refreshUserToken(refreshToken: string): Promise<WiseOAuthTokenResponse> {
    const auth = this.getClientCredentials();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    logger.info('Renovando token Wise');
    return requestWiseOAuthToken(body, auth);
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

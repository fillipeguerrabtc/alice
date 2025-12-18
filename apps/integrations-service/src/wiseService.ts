// Serviço Wise para Alice Enterprise Platform
// Implementa todas as funcionalidades da API Wise
// Documentação: https://docs.wise.com/api-docs/

import { wiseRequest, getWiseProfileId, isWiseSandbox } from './wiseClient.js';
import { createLogger } from '@alice/logger';

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
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount: {
    value: number;
    currency: string;
  };
  bankDetails?: {
    accountNumber?: string;
    bankCode?: string;
    iban?: string;
    bic?: string;
  };
}

interface WiseBorderlessAccount {
  id: number;
  profileId: number;
  recipientId: number;
  creationTime: string;
  modificationTime: string;
  active: boolean;
  eligible: boolean;
  balances: WiseBalance[];
}

// Cotação
interface WiseQuoteRequest {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
}

interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fee: number;
  formattedEstimatedDelivery: string;
  expirationTime: string;
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

// Classe de serviço Wise
export class WiseService {
  // Obter perfis
  async getProfiles(): Promise<WiseProfile[]> {
    logger.info('Obtendo perfis Wise');
    return wiseRequest<WiseProfile[]>('GET', '/v1/profiles');
  }

  // Obter saldos (conta multi-moeda)
  async getBalances(): Promise<WiseBorderlessAccount> {
    const profileId = getWiseProfileId();
    logger.info({ profileId }, 'Obtendo saldos Wise');
    
    const accounts = await wiseRequest<WiseBorderlessAccount[]>(
      'GET',
      `/v1/borderless-accounts?profileId=${profileId}`
    );
    
    if (accounts.length === 0) {
      throw new Error('Nenhuma conta borderless encontrada');
    }
    
    return accounts[0];
  }

  // Obter saldo por moeda
  async getBalanceByCurrency(currency: string): Promise<WiseBalance | null> {
    const account = await this.getBalances();
    return account.balances.find(b => b.currency === currency) || null;
  }

  // Criar cotação
  async createQuote(request: WiseQuoteRequest): Promise<WiseQuote> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, ...request }, 'Criando cotação Wise');
    
    return wiseRequest<WiseQuote>('POST', `/v3/profiles/${profileId}/quotes`, {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      sourceAmount: request.sourceAmount,
      targetAmount: request.targetAmount,
    });
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
      `/v1/profiles/${profileId}/batch-groups`,
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
      'PUT',
      `/v1/profiles/${profileId}/batch-groups/${batchGroupId}/status`,
      { status: 'COMPLETED', version }
    );
  }

  // Obter batch group
  async getBatchGroup(batchGroupId: string): Promise<WiseBatchGroup> {
    const profileId = getWiseProfileId();
    logger.info({ profileId, batchGroupId }, 'Obtendo batch group Wise');
    
    return wiseRequest<WiseBatchGroup>(
      'GET',
      `/v1/profiles/${profileId}/batch-groups/${batchGroupId}`
    );
  }

  // Listar batch groups
  async listBatchGroups(): Promise<WiseBatchGroup[]> {
    const profileId = getWiseProfileId();
    logger.info({ profileId }, 'Listando batch groups Wise');
    
    return wiseRequest<WiseBatchGroup[]>(
      'GET',
      `/v1/profiles/${profileId}/batch-groups`
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
  WiseBorderlessAccount,
  WiseQuote,
  WiseQuoteRequest,
  WiseRecipient,
  WiseRecipientRequest,
  WiseTransfer,
  WiseTransferRequest,
  WiseBatchGroup,
  WiseBatchGroupRequest,
  WiseExchangeRate,
};

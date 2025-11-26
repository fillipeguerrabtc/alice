// Cliente Wise para Alice Enterprise Platform
// Documentação: https://docs.wise.com/api-docs/
// Produção: Hetzner Cloud com variáveis de ambiente padrão

import { logger } from '@alice/logger';

// URLs da API Wise
const WISE_API_URL = process.env.WISE_API_URL || 'https://api.transferwise.com';
const WISE_SANDBOX_URL = 'https://api.sandbox.transferwise.tech';

// Interface para configuração do cliente
interface WiseClientConfig {
  apiKey: string;
  profileId: string;
  useSandbox: boolean;
}

// Obtém configuração do Wise das variáveis de ambiente
function getWiseConfig(): WiseClientConfig {
  const apiKey = process.env.WISE_API_KEY;
  const profileId = process.env.WISE_PROFILE_ID;
  const useSandbox = process.env.WISE_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

  if (!apiKey) {
    throw new Error('WISE_API_KEY não configurada nas variáveis de ambiente');
  }

  if (!profileId) {
    throw new Error('WISE_PROFILE_ID não configurada nas variáveis de ambiente');
  }

  return { apiKey, profileId, useSandbox };
}

// Obtém URL base da API
function getBaseUrl(): string {
  const config = getWiseConfig();
  return config.useSandbox ? WISE_SANDBOX_URL : WISE_API_URL;
}

// Headers padrão para requisições
function getHeaders(): Record<string, string> {
  const config = getWiseConfig();
  return {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Cliente HTTP para API Wise
export async function wiseRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: unknown
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = getHeaders();

  logger.info({ method, endpoint }, 'Requisição Wise API');

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Erro na API Wise');
      throw new Error(`Wise API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as T;
    logger.info({ method, endpoint, success: true }, 'Resposta Wise API');
    return data;
  } catch (error) {
    logger.error({ error, method, endpoint }, 'Falha na requisição Wise');
    throw error;
  }
}

// Obtém o Profile ID configurado
export function getWiseProfileId(): string {
  const config = getWiseConfig();
  return config.profileId;
}

// Verifica se está usando sandbox
export function isWiseSandbox(): boolean {
  const config = getWiseConfig();
  return config.useSandbox;
}

// Valida assinatura de webhook Wise
export function validateWiseWebhook(
  signature: string,
  payload: string,
  webhookSecret: string
): boolean {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

// Tipos exportados para uso externo
export type { WiseClientConfig };

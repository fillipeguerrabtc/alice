/**
 * Mapeamento enterprise de erros KuCoin → HTTP
 *
 * Objetivo:
 * - Padronizar respostas ao frontend quando a dependência KuCoin falha (429/timeout/breaker open).
 * - Evitar que falhas transitórias virem 500 genérico.
 *
 * Author: Fillipe Guerra
 * Data: 15 de Janeiro de 2026
 */

import type { Response } from 'express';
import { createLogger } from '@alice/logger';
import { isKucoinRequestError, KucoinRequestError } from './kucoinClient.js';

const logger = createLogger('kucoin-error-mapper');

export type KucoinHttpErrorResponse = {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
};

function toRetryAfterSeconds(retryAfterMs?: number): number | undefined {
  if (!retryAfterMs || retryAfterMs <= 0) return undefined;
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

type KucoinApiErrorMapping = {
  status: number;
  retryAfterSeconds?: number;
  message: string;
};

/**
 * Mapeamento de códigos de erro da API KuCoin para respostas HTTP
 * 
 * Referências:
 * - https://www.kucoin.com/docs-new/error-code/futures
 * - https://www.kucoin.com/docs-new/error-code/spot
 * - https://www.kucoin.com/docs/errors-code/futures-errors-code
 * - tiagosiebler/kucoin-api (SDK community reference)
 * 
 * Atualizado: 07/02/2026
 */
function mapKucoinApiCodeToHttp(kucoinCode?: string): KucoinApiErrorMapping | null {
  if (!kucoinCode) return null;

  switch (kucoinCode) {
    // ============================================================================
    // RATE LIMIT / THROTTLING
    // ============================================================================
    case '1015':
      return {
        status: 429,
        retryAfterSeconds: 30,
        message: 'KuCoin rate limit excedido (Cloudflare WAF, aguarde 30s)',
      };
    case '200002':
      return {
        status: 429,
        retryAfterSeconds: 10,
        message: 'KuCoin rate limit excedido (camada de negócio, aguarde 10s)',
      };
    case '429000':
      return {
        status: 429,
        message: 'KuCoin rate limit excedido (genérico)',
      };

    // ============================================================================
    // AUTENTICAÇÃO / PERMISSÃO / ASSINATURA
    // ============================================================================
    case '400001':
      return { status: 503, message: 'KuCoin: qualquer erro de autenticação - verifique API key' };
    case '400002':
      return { status: 503, message: 'KuCoin: assinatura inválida (HMAC signature mismatch)' };
    case '400003':
      return { status: 503, message: 'KuCoin: API key não encontrada' };
    case '400004':
      return { status: 503, message: 'KuCoin: passphrase inválida' };
    case '400005':
      return { status: 503, message: 'KuCoin: timestamp expirado (diferença > 5s do servidor)' };
    case '400006':
      return { status: 503, message: 'KuCoin: IP não autorizado para esta API key' };
    case '400007':
      return { status: 503, message: 'KuCoin: permissão insuficiente na API key' };

    // ============================================================================
    // PARÂMETROS INVÁLIDOS / VALIDAÇÃO DE INPUT
    // ============================================================================
    case '100001':
      return { status: 400, message: 'KuCoin: erro interno do sistema (parâmetro inválido)' };
    case '100003':
      return { status: 400, message: 'KuCoin: parâmetro obrigatório ausente' };
    case '100004':
      return { status: 400, message: 'KuCoin: tipo de parâmetro inválido' };
    case '100005':
      return { status: 400, message: 'KuCoin: parâmetro fora do intervalo permitido' };
    case '200003':
      return { status: 400, message: 'KuCoin: parâmetro de negócio inválido' };
    case '200004':
      return { status: 400, message: 'KuCoin: saldo insuficiente para a operação' };
    case '300000':
      return { status: 400, message: 'KuCoin: parâmetros da requisição inválidos' };

    // ============================================================================
    // ERROS DE ORDENS - FUTURES
    // ============================================================================
    case '300001':
      return { status: 400, message: 'KuCoin: símbolo inválido ou contrato não encontrado' };
    case '300002':
      return { status: 400, message: 'KuCoin: preço inválido (fora do tick size ou limites)' };
    case '300003':
      return { status: 400, message: 'KuCoin: quantidade inválida (fora dos limites do contrato)' };
    case '300004':
      return { status: 400, message: 'KuCoin: margem insuficiente para abrir posição' };
    case '300005':
      return { status: 400, message: 'KuCoin: quantidade máxima de ordens abertas atingida' };
    case '300006':
      return { status: 400, message: 'KuCoin: limite de posição atingido (max open size)' };
    case '300007':
      return { status: 400, message: 'KuCoin: direção da ordem conflita com posição existente' };
    case '300008':
      return { status: 400, message: 'KuCoin: contrato suspenso ou em manutenção' };
    case '300009':
      return { status: 400, message: 'KuCoin: reduceOnly rejeitado - sem posição para reduzir' };
    case '300010':
      return { status: 400, message: 'KuCoin: closeOrder rejeitado - sem posição para fechar' };
    case '300011':
      return { status: 400, message: 'KuCoin: alavancagem inválida para o símbolo' };
    case '300012':
      return { status: 400, message: 'KuCoin: erro de precisão (price/size decimal places)' };
    case '300014':
      return { status: 400, message: 'KuCoin: ordem seria liquidada imediatamente (margem insuficiente)' };
    case '300015':
      return { status: 400, message: 'KuCoin: modo hedge requer positionSide (LONG/SHORT)' };
    case '300016':
      return { status: 400, message: 'KuCoin: positionSide inválido para modo one-way' };

    // ============================================================================
    // ERROS DE ORDENS - SPOT/MARGIN
    // ============================================================================
    case '400100':
      return { status: 400, message: 'KuCoin: parâmetro de ordem Spot inválido' };
    case '400200':
      return { status: 400, message: 'KuCoin: saldo Spot insuficiente' };
    case '400400':
      return { status: 400, message: 'KuCoin: mercado fechado ou símbolo desativado' };
    case '400500':
      return { status: 400, message: 'KuCoin: ordem rejeitada (self-trade prevention)' };
    case '400600':
      return { status: 400, message: 'KuCoin: limite de ordens abertas Spot atingido' };
    case '400700':
      return { status: 400, message: 'KuCoin: ordem Spot não encontrada (já cancelada/executada)' };

    // ============================================================================
    // ERROS DE MARGIN
    // ============================================================================
    case '500000':
      return { status: 400, message: 'KuCoin: empréstimo margin rejeitado (limite atingido ou ativo indisponível)' };

    // ============================================================================
    // ERROS INTERNOS KUCOIN
    // ============================================================================
    case '500001':
    case '500002':
    case '500003':
      return { status: 502, message: 'KuCoin: erro interno do servidor (tente novamente)' };

    // ============================================================================
    // MANUTENÇÃO
    // ============================================================================
    case '200001':
      return { status: 503, message: 'KuCoin: sistema em manutenção, tente novamente mais tarde' };

    default:
      // Logar códigos de erro desconhecidos para facilitar mapeamento futuro
      logger.warn({ kucoinCode }, 'Código de erro KuCoin não mapeado - adicionar ao kucoin-error-mapper.ts');
      return null;
  }
}

export function mapKucoinErrorToHttpResponse(
  error: unknown,
  opts: { isProduction: boolean }
): KucoinHttpErrorResponse | null {
  if (!isKucoinRequestError(error)) return null;

  const err = error as KucoinRequestError;
  const baseBody: Record<string, unknown> = {
    error: 'Falha ao comunicar com a KuCoin',
    upstream: 'kucoin',
    kind: err.kind,
  };

  // Detalhes adicionais apenas em dev/test (evita vazar internals em produção).
  if (!opts.isProduction) {
    baseBody.details = {
      method: err.method,
      endpoint: err.endpoint,
      status: err.status,
      kucoinCode: err.kucoinCode,
      retryAfterMs: err.retryAfterMs,
    };
  } else if (err.kind === 'http') {
    // Em produção, é útil expor pelo menos o status HTTP upstream em caso de 401/403/429/5xx.
    baseBody.upstreamStatus = err.status;
  }

  // Mapeamento por kind/HTTP status
  if (err.kind === 'breaker_open') {
    return { status: 503, body: { ...baseBody, error: 'KuCoin temporariamente indisponível (circuit breaker)' } };
  }

  if (err.kind === 'timeout') {
    return { status: 504, body: { ...baseBody, error: 'Timeout ao comunicar com a KuCoin' } };
  }

  if (err.kind === 'http') {
    // Rate limit: propagar 429 e Retry-After quando disponível.
    if (err.status === 429) {
      const retryAfterSeconds = toRetryAfterSeconds(err.retryAfterMs);
      const headers: Record<string, string> = {};
      if (retryAfterSeconds) headers['Retry-After'] = String(retryAfterSeconds);
      return {
        status: 429,
        headers,
        body: { ...baseBody, error: 'KuCoin rate limit excedido', retryAfterSeconds },
      };
    }

    // Credenciais inválidas / bloqueio no upstream: para o cliente, é indisponibilidade do serviço.
    if (err.status === 401 || err.status === 403) {
      return { status: 503, body: { ...baseBody, error: 'KuCoin indisponível (credenciais inválidas ou acesso negado)' } };
    }

    // Upstream 5xx: 502 (bad gateway)
    if (err.status && err.status >= 500 && err.status <= 599) {
      return { status: 502, body: { ...baseBody, error: 'KuCoin retornou erro (upstream 5xx)' } };
    }

    // Outros 4xx/unknown no upstream: tratar como 502 (falha no gateway)
    return { status: 502, body: { ...baseBody, error: 'KuCoin retornou erro (upstream)' } };
  }

  if (err.kind === 'network') {
    return { status: 502, body: { ...baseBody, error: 'Falha de rede ao comunicar com a KuCoin' } };
  }

  if (err.kind === 'parse') {
    return { status: 502, body: { ...baseBody, error: 'Resposta inválida da KuCoin (JSON)' } };
  }

  if (err.kind === 'api') {
    const mapped = mapKucoinApiCodeToHttp(err.kucoinCode);
    if (mapped) {
      const headers: Record<string, string> = {};
      if (mapped.retryAfterSeconds) {
        headers['Retry-After'] = String(mapped.retryAfterSeconds);
      }
      return {
        status: mapped.status,
        headers: Object.keys(headers).length ? headers : undefined,
        body: {
          ...baseBody,
          error: mapped.message,
          retryAfterSeconds: mapped.retryAfterSeconds,
          kucoinCode: err.kucoinCode,
        },
      };
    }
    return { status: 502, body: { ...baseBody, error: 'KuCoin retornou erro de API' } };
  }

  // Exhaustiveness fallback
  return { status: 502, body: baseBody };
}

export function sendKucoinErrorResponse(
  res: Response,
  error: unknown,
  opts?: { isProduction?: boolean }
): boolean {
  const isProduction = opts?.isProduction ?? process.env.NODE_ENV === 'production';
  const mapped = mapKucoinErrorToHttpResponse(error, { isProduction });
  if (!mapped) return false;

  if (mapped.headers) {
    for (const [k, v] of Object.entries(mapped.headers)) {
      res.setHeader(k, v);
    }
  }

  res.status(mapped.status).json(mapped.body);
  return true;
}


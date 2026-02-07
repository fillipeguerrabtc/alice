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

function mapKucoinApiCodeToHttp(kucoinCode?: string): KucoinApiErrorMapping | null {
  if (!kucoinCode) return null;

  switch (kucoinCode) {
    // Rate limit / throttling (docs oficiais)
    case '1015':
      return {
        status: 429,
        retryAfterSeconds: 30,
        message: 'KuCoin rate limit excedido (Cloudflare, aguarde 30s)',
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
        message: 'KuCoin rate limit excedido',
      };

    // Autenticação / permissão / assinatura (credenciais do serviço)
    case '400001':
    case '400002':
    case '400003':
    case '400004':
    case '400005':
    case '400006':
    case '400007':
      return {
        status: 503,
        message: 'KuCoin indisponível (credenciais inválidas, timestamp ou permissão)',
      };

    // Parâmetros inválidos (inputs rejeitados pelo upstream)
    case '100001':
    case '100003':
    case '200003':
    case '300000':
    case '400100':
      return {
        status: 400,
        message: 'KuCoin rejeitou parâmetros da requisição',
      };

    default:
      // CORREÇÃO M1: Logar códigos de erro desconhecidos para facilitar mapeamento futuro
      logger.warn({ kucoinCode }, 'Código de erro KuCoin não mapeado - adicionar ao KUCOIN_ERROR_MAP');
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


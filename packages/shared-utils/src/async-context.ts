/**
 * AsyncLocalStorage Context - Alice Enterprise Platform
 * 
 * Implementa propagação de contexto de requisição (correlation IDs, tenant, user)
 * usando AsyncLocalStorage do Node.js 20 LTS.
 * 
 * Referência: https://nodejs.org/docs/latest-v20.x/api/async_context.html
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// TIPOS DE CONTEXTO
// ============================================================================

export interface RequestContext {
  correlationId: string;
  requestId: string;
  tenantId?: string;
  userId?: string;
  userRole?: string;
  startTime: number;
  serviceName: string;
  path?: string;
  method?: string;
}

// ============================================================================
// ASYNC LOCAL STORAGE SINGLETON
// ============================================================================

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// ============================================================================
// FUNÇÕES DE ACESSO AO CONTEXTO
// ============================================================================

/**
 * Obtém o contexto da requisição atual
 * Retorna undefined se chamado fora de um contexto de requisição
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Obtém o correlation ID da requisição atual
 * Retorna 'no-context' se chamado fora de um contexto
 */
export function getCorrelationId(): string {
  const context = asyncLocalStorage.getStore();
  return context?.correlationId || 'no-context';
}

/**
 * Obtém o request ID da requisição atual
 */
export function getRequestId(): string {
  const context = asyncLocalStorage.getStore();
  return context?.requestId || 'no-request';
}

/**
 * Obtém o tenant ID da requisição atual
 */
export function getTenantId(): string | undefined {
  const context = asyncLocalStorage.getStore();
  return context?.tenantId;
}

/**
 * Executa uma função dentro de um contexto de requisição
 * Usado para criar contextos manuais (jobs, workers, etc.)
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Executa uma função async dentro de um contexto de requisição
 */
export async function runWithContextAsync<T>(
  context: RequestContext, 
  fn: () => Promise<T>
): Promise<T> {
  return asyncLocalStorage.run(context, fn);
}

// ============================================================================
// MIDDLEWARE EXPRESS
// ============================================================================

const CORRELATION_ID_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

export interface CorrelationMiddlewareOptions {
  serviceName: string;
  trustIncomingCorrelationId?: boolean;
}

/**
 * Middleware Express que cria contexto de requisição com AsyncLocalStorage
 * 
 * Extrai ou gera correlation ID e propaga para toda a cadeia de requisição.
 * Adiciona headers de resposta para rastreamento distribuído.
 * 
 * @example
 * app.use(createCorrelationMiddleware({ serviceName: 'chat-service' }));
 */
export function createCorrelationMiddleware(options: CorrelationMiddlewareOptions) {
  const { serviceName, trustIncomingCorrelationId = true } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Extrair ou gerar correlation ID
    let correlationId = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    
    if (!correlationId || !trustIncomingCorrelationId) {
      correlationId = randomUUID();
    }

    // Gerar request ID único para esta requisição específica
    const requestId = randomUUID();

    // Criar contexto da requisição
    const context: RequestContext = {
      correlationId,
      requestId,
      tenantId: req.tenantId,
      userId: req.user?.userId,
      userRole: req.user?.role,
      startTime: Date.now(),
      serviceName,
      path: req.path,
      method: req.method,
    };

    // Adicionar headers de resposta para rastreamento
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    // Executar próximo middleware dentro do contexto
    asyncLocalStorage.run(context, () => {
      next();
    });
  };
}

/**
 * Extrai headers de contexto para propagação inter-serviços
 * Usar ao fazer chamadas HTTP para outros microsserviços
 */
export function getContextHeaders(): Record<string, string> {
  const context = asyncLocalStorage.getStore();
  
  if (!context) {
    return {};
  }

  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: context.correlationId,
    [REQUEST_ID_HEADER]: context.requestId,
  };

  if (context.tenantId) {
    headers['x-tenant-id'] = context.tenantId;
  }

  if (context.userId) {
    headers['x-user-id'] = context.userId;
  }

  return headers;
}

/**
 * Cria um contexto para jobs/workers background
 * Permite rastreamento de operações assíncronas fora do ciclo HTTP
 */
export function createBackgroundContext(
  serviceName: string,
  parentCorrelationId?: string
): RequestContext {
  return {
    correlationId: parentCorrelationId || randomUUID(),
    requestId: randomUUID(),
    startTime: Date.now(),
    serviceName,
    method: 'BACKGROUND',
  };
}

// ============================================================================
// EXPORTS PARA USO DIRETO DO ASYNC LOCAL STORAGE
// ============================================================================

export { asyncLocalStorage };

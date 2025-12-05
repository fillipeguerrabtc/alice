/**
 * Sistema de Métricas - Alice Enterprise Platform
 * 
 * Registra métricas de uso para monitoramento e billing.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/metrics
 */

import { createLogger, Logger } from './logger.js';

const logger = createLogger('metrics');

/**
 * Tipos de métricas coletadas
 */
export type MetricType =
  | 'message'
  | 'chat_response'
  | 'embedding'
  | 'rag_search'
  | 'document_upload'
  | 'fine_tuning'
  | 'api_call'
  | 'error';

/**
 * Evento de métrica
 */
export interface MetricEvent {
  /** ID do tenant */
  tenantId?: string;
  /** ID do usuário */
  userId?: string;
  /** Tipo de métrica */
  type: MetricType;
  /** Tokens de prompt usados */
  tokensPrompt?: number;
  /** Tokens de completion usados */
  tokensCompletion?: number;
  /** Total de tokens */
  totalTokens?: number;
  /** Tempo de resposta em ms */
  responseTimeMs?: number;
  /** Modelo usado */
  model?: string;
  /** Se ocorreu erro */
  error?: boolean;
  /** Mensagem de erro */
  errorMessage?: string;
  /** Detalhes adicionais */
  details?: Record<string, unknown>;
}

/**
 * Interface para funções de inserção no banco
 */
export interface MetricsInsertFn {
  (event: {
    tenantId?: string;
    userId?: string;
    type: string;
    totalTokens?: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    responseTime?: number;
    model?: string;
    error?: boolean;
    errorMessage?: string;
  }): Promise<void>;
}

/**
 * Classe para gerenciar métricas
 */
export class MetricsCollector {
  private insertFn: MetricsInsertFn | null = null;
  private log: Logger;

  constructor(customLogger?: Logger) {
    this.log = customLogger || logger;
  }

  /**
   * Configura a função de inserção no banco
   * 
   * @param fn - Função que insere a métrica no banco de dados
   */
  setInsertFunction(fn: MetricsInsertFn): void {
    this.insertFn = fn;
  }

  /**
   * Registra uma métrica
   * 
   * @param event - Evento de métrica a ser registrado
   * 
   * @example
   * ```typescript
   * import { metricsCollector } from '@alice/shared-utils/metrics';
   * 
   * await metricsCollector.record({
   *   tenantId: 'tenant-123',
   *   userId: 'user-456',
   *   type: 'chat_response',
   *   tokensPrompt: 150,
   *   tokensCompletion: 350,
   *   totalTokens: 500,
   *   responseTimeMs: 1234,
   *   model: 'llama4-maverick',
   * });
   * ```
   */
  async record(event: MetricEvent): Promise<void> {
    const totalTokens = event.totalTokens ?? 
      ((event.tokensPrompt || 0) + (event.tokensCompletion || 0));

    const logData = {
      tenantId: event.tenantId,
      userId: event.userId,
      type: event.type,
      tokens: totalTokens,
      responseTimeMs: event.responseTimeMs,
      model: event.model,
      error: event.error,
    };

    if (event.error) {
      this.log.warn(logData, `Métrica com erro: ${event.type}`);
    } else {
      this.log.debug(logData, `Métrica registrada: ${event.type}`);
    }

    if (this.insertFn) {
      try {
        await this.insertFn({
          tenantId: event.tenantId,
          userId: event.userId,
          type: event.type,
          totalTokens,
          tokensPrompt: event.tokensPrompt,
          tokensCompletion: event.tokensCompletion,
          responseTime: event.responseTimeMs,
          model: event.model,
          error: event.error,
          errorMessage: event.errorMessage,
        });
      } catch (error) {
        this.log.error({ error, event }, 'Falha ao persistir métrica');
      }
    }
  }

  /**
   * Registra métrica de resposta de chat
   */
  async recordChatResponse(
    tenantId: string | undefined,
    userId: string | undefined,
    tokensPrompt: number,
    tokensCompletion: number,
    responseTimeMs: number,
    model: string
  ): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: 'chat_response',
      tokensPrompt,
      tokensCompletion,
      totalTokens: tokensPrompt + tokensCompletion,
      responseTimeMs,
      model,
    });
  }

  /**
   * Registra métrica de geração de embedding
   */
  async recordEmbedding(
    tenantId: string | undefined,
    userId: string | undefined,
    tokensUsed: number,
    responseTimeMs: number,
    model: string
  ): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: 'embedding',
      totalTokens: tokensUsed,
      responseTimeMs,
      model,
    });
  }

  /**
   * Registra métrica de busca RAG
   */
  async recordRagSearch(
    tenantId: string | undefined,
    userId: string | undefined,
    responseTimeMs: number,
    resultsCount: number
  ): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: 'rag_search',
      responseTimeMs,
      details: { resultsCount },
    });
  }

  /**
   * Registra métrica de upload de documento
   */
  async recordDocumentUpload(
    tenantId: string | undefined,
    userId: string | undefined,
    fileSize: number,
    chunksCreated: number
  ): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: 'document_upload',
      details: { fileSize, chunksCreated },
    });
  }

  /**
   * Registra erro
   */
  async recordError(
    type: MetricType,
    errorMessage: string,
    tenantId?: string,
    userId?: string,
    responseTimeMs?: number
  ): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type,
      error: true,
      errorMessage,
      responseTimeMs,
    });
  }
}

/**
 * Instância singleton do coletor de métricas
 */
export const metricsCollector = new MetricsCollector();

/**
 * Timer para medir tempo de execução
 */
export class Timer {
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Obtém tempo decorrido em milissegundos
   */
  elapsed(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /**
   * Reseta o timer
   */
  reset(): void {
    this.startTime = performance.now();
  }
}

/**
 * Cria um novo timer
 * 
 * @example
 * ```typescript
 * import { createTimer } from '@alice/shared-utils/metrics';
 * 
 * const timer = createTimer();
 * // ... operação demorada
 * const elapsed = timer.elapsed();
 * console.log(`Operação levou ${elapsed}ms`);
 * ```
 */
export function createTimer(): Timer {
  return new Timer();
}

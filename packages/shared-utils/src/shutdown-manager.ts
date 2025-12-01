/**
 * ShutdownManager Centralizado - Alice Enterprise Platform
 * 
 * Gerenciador enterprise-grade de graceful shutdown para microsserviços.
 * Elimina duplicação de listeners e coordena ordem de shutdown.
 * 
 * Padrão de uso:
 * 1. Serviço registra callbacks via registerCallback()
 * 2. ShutdownManager registra SIGTERM/SIGINT apenas UMA VEZ
 * 3. No shutdown, callbacks são executados em ordem de prioridade
 * 4. HTTP server fecha ANTES do pool de database
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * Enterprise-Grade (Regra 16 replit.md)
 * 
 * @module @alice/shared-utils/shutdown-manager
 */

import { Logger } from 'pino';
import { createLogger } from './logger.js';

/**
 * Prioridade de shutdown - maior número = executado primeiro
 */
export enum ShutdownPriority {
  HTTP_SERVER = 100,
  WEBSOCKET = 90,
  BACKGROUND_JOBS = 80,
  CACHE = 70,
  MESSAGE_QUEUE = 60,
  DATABASE = 50,
  EXTERNAL_CONNECTIONS = 40,
  LOGGING = 10,
}

/**
 * Opções para callback de shutdown
 */
export interface ShutdownCallbackOptions {
  priority?: number;
  timeoutMs?: number;
}

/**
 * Callback de shutdown registrado
 */
interface RegisteredCallback {
  name: string;
  fn: () => Promise<void>;
  priority: number;
  timeoutMs: number;
}

/**
 * Configuração do ShutdownManager
 */
export interface ShutdownManagerConfig {
  defaultTimeoutMs?: number;
  forceExitTimeoutMs?: number;
  logger?: Logger;
  /** Se true, não registra handlers de processo (para testes) */
  skipProcessHandlers?: boolean;
}

/**
 * ShutdownManager Singleton
 * 
 * Gerencia todos os callbacks de shutdown de forma centralizada.
 * Registra handlers de processo apenas UMA VEZ para evitar vazamento de listeners.
 */
class ShutdownManagerImpl {
  private callbacks: RegisteredCallback[] = [];
  private isShuttingDown = false;
  private handlersRegistered = false;
  private skipProcessHandlers = false;
  private logger: Logger;
  private defaultTimeoutMs: number;
  private forceExitTimeoutMs: number;

  constructor(config: ShutdownManagerConfig = {}) {
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10000;
    this.forceExitTimeoutMs = config.forceExitTimeoutMs ?? 30000;
    this.skipProcessHandlers = config.skipProcessHandlers ?? false;
    // Usa createLogger do singleton - não cria novo transport/listener
    this.logger = config.logger ?? createLogger('shutdown-manager');
  }

  /**
   * Registrar callback de shutdown
   * 
   * @param name - Nome identificador do callback (para logs)
   * @param fn - Função async de cleanup
   * @param options - Opções de prioridade e timeout
   */
  registerCallback(
    name: string, 
    fn: () => Promise<void>, 
    options: ShutdownCallbackOptions = {}
  ): void {
    const priority = options.priority ?? ShutdownPriority.EXTERNAL_CONNECTIONS;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const existingIndex = this.callbacks.findIndex(cb => cb.name === name);
    if (existingIndex >= 0) {
      this.logger.warn({ name }, 'Callback de shutdown já registrado - substituindo');
      this.callbacks[existingIndex] = { name, fn, priority, timeoutMs };
    } else {
      this.callbacks.push({ name, fn, priority, timeoutMs });
      this.logger.debug({ name, priority }, 'Callback de shutdown registrado');
    }

    this.ensureHandlersRegistered();
  }

  /**
   * Remover callback de shutdown
   */
  unregisterCallback(name: string): void {
    const index = this.callbacks.findIndex(cb => cb.name === name);
    if (index >= 0) {
      this.callbacks.splice(index, 1);
      this.logger.debug({ name }, 'Callback de shutdown removido');
    }
  }

  /**
   * Verificar se shutdown está em progresso
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Obter número de callbacks registrados
   */
  getCallbackCount(): number {
    return this.callbacks.length;
  }

  /**
   * Listar callbacks registrados (para diagnóstico)
   */
  listCallbacks(): Array<{ name: string; priority: number }> {
    return this.callbacks.map(cb => ({ name: cb.name, priority: cb.priority }));
  }

  /**
   * Garantir que handlers de processo estão registrados (apenas uma vez)
   */
  private ensureHandlersRegistered(): void {
    if (this.handlersRegistered || this.skipProcessHandlers) {
      return;
    }
    this.handlersRegistered = true;

    this.logger.info('Registrando handlers de shutdown centralizados');

    process.once('SIGTERM', () => {
      this.shutdown('SIGTERM').catch((error) => {
        this.logger.error({ error }, 'Erro durante shutdown por SIGTERM');
      });
    });
    process.once('SIGINT', () => {
      this.shutdown('SIGINT').catch((error) => {
        this.logger.error({ error }, 'Erro durante shutdown por SIGINT');
      });
    });

    process.on('uncaughtException', (error: Error, origin: string) => {
      this.logger.fatal({ 
        error: error.message, 
        stack: error.stack, 
        origin,
        pid: process.pid,
        uptime: process.uptime()
      }, `Exceção não tratada (${origin}): ${error.message}`);
      
      if (process.env.NODE_ENV === 'production') {
        this.shutdown('uncaughtException', { skipProcessExit: true })
          .catch((shutdownError) => {
            this.logger.error({ error: shutdownError }, 'Erro durante shutdown por uncaughtException');
          })
          .finally(() => {
            process.exit(1);
          });
      }
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);
      const errorStack = reason instanceof Error ? reason.stack : undefined;
      
      this.logger.error({ 
        reason: errorMessage,
        stack: errorStack,
        pid: process.pid,
        uptime: process.uptime()
      }, `Promise rejection não tratada: ${errorMessage}`);
      
      if (process.env.NODE_ENV === 'production') {
        this.logger.fatal({ reason: errorMessage }, 'Encerrando devido a promise rejection não tratada');
        this.shutdown('unhandledRejection', { skipProcessExit: true })
          .catch((shutdownError) => {
            this.logger.error({ error: shutdownError }, 'Erro durante shutdown por unhandledRejection');
          })
          .finally(() => {
            process.exit(1);
          });
      }
    });

    this.logger.debug('Handlers de shutdown registrados com sucesso');
  }

  /**
   * Executar shutdown graceful
   * 
   * @param signal - Sinal que disparou o shutdown (SIGTERM, SIGINT, etc)
   * @param options - Opções de execução
   * @param options.skipProcessExit - Se true, não chama process.exit (para testes)
   * @returns Resultado do shutdown com callbacks executados e erros
   */
  async shutdown(signal: string, options?: { skipProcessExit?: boolean }): Promise<{
    executedCallbacks: string[];
    errors: Array<{ name: string; error: string }>;
  }> {
    const executedCallbacks: string[] = [];
    const errors: Array<{ name: string; error: string }> = [];
    const skipProcessExit = options?.skipProcessExit ?? false;
    
    if (this.isShuttingDown) {
      this.logger.warn({ signal }, 'Shutdown já em progresso, ignorando sinal duplicado');
      return { executedCallbacks, errors };
    }

    this.isShuttingDown = true;
    this.logger.info({ signal, callbackCount: this.callbacks.length }, `Iniciando graceful shutdown (${signal})`);

    const forceExitTimer = setTimeout(() => {
      this.logger.error('Timeout de shutdown forçado - encerrando processo');
      if (!skipProcessExit) {
        process.exit(1);
      }
    }, this.forceExitTimeoutMs);

    const sortedCallbacks = [...this.callbacks].sort((a, b) => b.priority - a.priority);

    for (const callback of sortedCallbacks) {
      try {
        this.logger.debug({ name: callback.name, priority: callback.priority }, 'Executando callback de shutdown');
        
        await Promise.race([
          callback.fn(),
          new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), callback.timeoutMs)
          )
        ]);

        this.logger.debug({ name: callback.name }, 'Callback de shutdown concluído');
        executedCallbacks.push(callback.name);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error({ name: callback.name, error: errorMessage }, 'Erro no callback de shutdown');
        errors.push({ name: callback.name, error: errorMessage });
      }
    }

    clearTimeout(forceExitTimer);
    this.logger.info({ signal }, 'Graceful shutdown concluído');

    if (!skipProcessExit && (signal === 'SIGTERM' || signal === 'SIGINT')) {
      process.exit(0);
    }
    
    return { executedCallbacks, errors };
  }

  /**
   * Resetar manager (apenas para testes)
   */
  reset(): void {
    this.callbacks = [];
    this.isShuttingDown = false;
  }
}

let shutdownManagerInstance: ShutdownManagerImpl | null = null;

/**
 * Obter instância singleton do ShutdownManager
 */
export function getShutdownManager(config?: ShutdownManagerConfig): ShutdownManagerImpl {
  if (!shutdownManagerInstance) {
    shutdownManagerInstance = new ShutdownManagerImpl(config);
  }
  return shutdownManagerInstance;
}

// ============================================================================
// TESTING UTILITIES (Enterprise-Grade - Dependency Injection)
// Permite testes isolados sem afetar o singleton de produção
// ============================================================================

/**
 * Resetar singleton do ShutdownManager para testes
 * APENAS para uso em testes - não usar em código de produção
 * 
 * @internal
 */
export function _resetShutdownManagerForTesting(): void {
  if (shutdownManagerInstance) {
    shutdownManagerInstance.reset();
  }
  shutdownManagerInstance = null;
}

/**
 * Criar instância isolada do ShutdownManager para testes
 * APENAS para uso em testes - não registra handlers de processo
 * 
 * @internal
 */
export function _createTestableShutdownManager(config?: ShutdownManagerConfig): ShutdownManagerImpl {
  return new ShutdownManagerImpl(config);
}

/**
 * Registrar callback de shutdown (atalho para getShutdownManager().registerCallback)
 */
export function registerShutdownCallback(
  name: string,
  fn: () => Promise<void>,
  options?: ShutdownCallbackOptions
): void {
  getShutdownManager().registerCallback(name, fn, options);
}

/**
 * Verificar se shutdown está em progresso
 */
export function isShutdownInProgress(): boolean {
  return shutdownManagerInstance?.isShutdownInProgress() ?? false;
}

/**
 * Inicializar ShutdownManager
 * 
 * Atalho para getShutdownManager() que inicializa o singleton e registra os handlers.
 * Deve ser chamado no início do serviço para garantir que handlers estão registrados.
 * 
 * @param config - Configuração opcional do ShutdownManager
 * @returns A instância do ShutdownManager
 */
export function initializeShutdownManager(config?: ShutdownManagerConfig): ShutdownManagerImpl {
  return getShutdownManager(config);
}

export { ShutdownManagerImpl };

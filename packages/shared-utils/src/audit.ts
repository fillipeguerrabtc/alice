/**
 * Sistema de Auditoria - Alice Enterprise Platform
 * 
 * Registra logs de auditoria para compliance enterprise.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/audit
 */

import { createLogger, Logger } from './logger.js';

const logger = createLogger('audit');

/**
 * Tipos de ação auditáveis
 */
export type AuditAction =
  | 'login'
  | 'logout'
  | 'register'
  | 'password_change'
  | 'role_change'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'upload'
  | 'download'
  | 'sync'
  | 'payment'
  | 'transfer'
  | 'start_job'
  | 'cancel_job'
  | 'send_message'
  | 'create_conversation'
  | 'api_call'
  | 'webhook_received'
  | 'error';

/**
 * Recursos auditáveis
 */
export type AuditResource =
  | 'user'
  | 'session'
  | 'tenant'
  | 'namespace'
  | 'agent'
  | 'conversation'
  | 'message'
  | 'document'
  | 'training_data'
  | 'fine_tuning_job'
  | 'integration'
  | 'stripe_payment'
  | 'wise_transfer'
  | 'erpnext'
  | 'twilio'
  | 'email' // Gmail SMTP (substitui 'resend' - 30/12/2025)
  | 'llm'
  | 'embeddings';

/**
 * Evento de auditoria
 */
export interface AuditEvent {
  /** ID do tenant */
  tenantId?: string;
  /** ID do usuário que executou a ação */
  userId?: string;
  /** Ação executada */
  action: AuditAction;
  /** Recurso afetado */
  resource: AuditResource;
  /** ID do recurso específico */
  resourceId?: string;
  /** Detalhes adicionais da ação */
  details?: Record<string, unknown>;
  /** Endereço IP de origem */
  ip?: string;
  /** User agent do cliente */
  userAgent?: string;
  /** Resultado da ação (sucesso/falha) */
  success?: boolean;
  /** Mensagem de erro (se houver) */
  errorMessage?: string;
}

/**
 * Interface para funções de inserção no banco
 */
export interface AuditInsertFn {
  (event: {
    tenantId?: string;
    userId?: string;
    acao: string;
    recurso: string;
    recursoId?: string;
    detalhes?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }): Promise<void>;
}

/**
 * Classe para gerenciar auditoria
 */
export class AuditLogger {
  private insertFn: AuditInsertFn | null = null;
  private log: Logger;

  constructor(customLogger?: Logger) {
    this.log = customLogger || logger;
  }

  /**
   * Configura a função de inserção no banco
   * 
   * @param fn - Função que insere o evento no banco de dados
   */
  setInsertFunction(fn: AuditInsertFn): void {
    this.insertFn = fn;
  }

  /**
   * Registra um evento de auditoria
   * 
   * @param event - Evento a ser registrado
   * 
   * @example
   * ```typescript
   * import { auditLogger } from '@alice/shared-utils/audit';
   * 
   * await auditLogger.log({
   *   tenantId: 'tenant-123',
   *   userId: 'user-456',
   *   action: 'login',
   *   resource: 'session',
   *   ip: req.ip,
   *   success: true,
   * });
   * ```
   */
  async logEvent(event: AuditEvent): Promise<void> {
    const logData = {
      tenantId: event.tenantId,
      userId: event.userId,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      success: event.success ?? true,
      ip: event.ip,
    };

    if (event.success === false) {
      this.log.warn(logData, `Ação de auditoria falhou: ${event.action} em ${event.resource}`);
    } else {
      this.log.info(logData, `Ação auditada: ${event.action} em ${event.resource}`);
    }

    if (this.insertFn) {
      try {
        await this.insertFn({
          tenantId: event.tenantId,
          userId: event.userId,
          acao: event.action,
          recurso: event.resource,
          recursoId: event.resourceId,
          detalhes: {
            ...event.details,
            success: event.success ?? true,
            errorMessage: event.errorMessage,
          },
          ip: event.ip,
          userAgent: event.userAgent,
        });
      } catch (error) {
        this.log.error({ error, event }, 'Falha ao persistir log de auditoria');
      }
    }
  }

  /**
   * Atalho para registrar login
   */
  async logLogin(
    userId: string,
    tenantId: string | undefined,
    ip: string | undefined,
    success: boolean,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action: 'login',
      resource: 'session',
      ip,
      success,
      details,
    });
  }

  /**
   * Atalho para registrar logout
   */
  async logLogout(userId: string, tenantId: string | undefined, ip: string | undefined): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action: 'logout',
      resource: 'session',
      ip,
      success: true,
    });
  }

  /**
   * Atalho para registrar criação de recurso
   */
  async logCreate(
    resource: AuditResource,
    resourceId: string,
    userId: string | undefined,
    tenantId: string | undefined,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action: 'create',
      resource,
      resourceId,
      success: true,
      details,
    });
  }

  /**
   * Atalho para registrar exclusão de recurso
   */
  async logDelete(
    resource: AuditResource,
    resourceId: string,
    userId: string | undefined,
    tenantId: string | undefined,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action: 'delete',
      resource,
      resourceId,
      success: true,
      details,
    });
  }

  /**
   * Atalho para registrar upload de arquivo
   */
  async logUpload(
    resourceId: string,
    userId: string | undefined,
    tenantId: string | undefined,
    filename: string,
    size: number
  ): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action: 'upload',
      resource: 'document',
      resourceId,
      success: true,
      details: { filename, size },
    });
  }

  /**
   * Atalho para registrar erro
   */
  async logError(
    resource: AuditResource,
    action: AuditAction,
    errorMessage: string,
    userId?: string,
    tenantId?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logEvent({
      userId,
      tenantId,
      action,
      resource,
      success: false,
      errorMessage,
      details,
    });
  }
}

/**
 * Instância singleton do logger de auditoria
 */
export const auditLogger = new AuditLogger();

/**
 * Função auxiliar para extrair IP do request Express
 * 
 * @param req - Request Express
 * @returns Endereço IP
 */
export function getClientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/**
 * Função auxiliar para extrair User Agent do request
 * 
 * @param req - Request Express
 * @returns User Agent string
 */
export function getUserAgent(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const ua = req.headers?.['user-agent'];
  if (Array.isArray(ua)) return ua[0] || 'unknown';
  return ua || 'unknown';
}

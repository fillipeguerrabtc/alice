/**
 * Identity Provisioning Event Processor - Outbox Pattern
 * 
 * Processa eventos de usuários e sincroniza com Grafana/ERPNext
 * 
 * Padrão Outbox:
 * 1. Eventos são inseridos na tabela identity_provisioning_events
 * 2. Este processor busca eventos pendentes periodicamente
 * 3. Processa cada evento (cria/atualiza/deleta usuário nos sistemas externos)
 * 4. Atualiza status do evento (completed/failed/retrying)
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import { getDatabase, schema } from '@alice/database';
import { eq, and, lt, or, isNull, sql } from 'drizzle-orm';

const { identityProvisioningEvents, externalUserMappings } = schema;
import { createLogger } from '@alice/logger';
import { createGrafanaClient, GrafanaClient } from './grafana-client.js';
import { createERPNextClient, ERPNextClient } from './erpnext-client.js';

const logger = createLogger('identity-provisioning');

// Tipos de evento suportados
type EventType = 'user.created' | 'user.updated' | 'user.deleted' | 'user.role_changed' | 'user.disabled';

// Payload do evento
interface UserEventPayload {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  previousRole?: string;
  tenantId?: string;
}

// Configuração do processor
interface ProcessorConfig {
  batchSize: number;
  pollingIntervalMs: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: ProcessorConfig = {
  batchSize: 10,
  pollingIntervalMs: 5000, // 5 segundos
  retryDelayMs: 30000, // 30 segundos
};

/**
 * Processador de eventos de Identity Provisioning
 */
export class IdentityProvisioningProcessor {
  private grafana: GrafanaClient | null;
  private erpnext: ERPNextClient | null;
  private config: ProcessorConfig;
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<ProcessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.grafana = createGrafanaClient();
    this.erpnext = createERPNextClient();

    if (!this.grafana && !this.erpnext) {
      logger.warn('Nenhum sistema externo configurado para Identity Provisioning');
    }
  }

  /**
   * Iniciar processamento de eventos
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Processor já está rodando');
      return;
    }

    this.isRunning = true;
    logger.info({ config: this.config }, 'Iniciando Identity Provisioning Processor');

    // Processar eventos imediatamente
    this.processEvents().catch((error) => {
      logger.error({ error }, 'Erro ao processar eventos iniciais');
    });

    // Configurar polling
    this.pollInterval = setInterval(() => {
      this.processEvents().catch((error) => {
        logger.error({ error }, 'Erro no polling de eventos');
      });
    }, this.config.pollingIntervalMs);
  }

  /**
   * Parar processamento de eventos
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    logger.info('Identity Provisioning Processor parado');
  }

  /**
   * Processar lote de eventos pendentes
   */
  async processEvents(): Promise<void> {
    const db = getDatabase();

    try {
      // Buscar eventos pendentes ou para retry
      const now = new Date();
      const events = await db.select()
        .from(identityProvisioningEvents)
        .where(
          and(
            or(
              eq(identityProvisioningEvents.status, 'pending'),
              and(
                eq(identityProvisioningEvents.status, 'retrying'),
                or(
                  isNull(identityProvisioningEvents.proximaTentativa),
                  lt(identityProvisioningEvents.proximaTentativa, now),
                ),
              ),
            ),
            lt(identityProvisioningEvents.retryCount, identityProvisioningEvents.maxRetries),
          ),
        )
        .limit(this.config.batchSize);

      if (events.length === 0) {
        return;
      }

      logger.debug({ count: events.length }, 'Processando eventos de provisioning');

      // Processar cada evento
      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao buscar eventos para processamento');
    }
  }

  /**
   * Processar um único evento
   */
  private async processEvent(event: typeof identityProvisioningEvents.$inferSelect): Promise<void> {
    const db = getDatabase();

    try {
      // Marcar como processing
      await db.update(identityProvisioningEvents)
        .set({ status: 'processing' })
        .where(eq(identityProvisioningEvents.id, event.id));

      const payload = event.payload as UserEventPayload;
      const eventType = event.eventType as EventType;

      logger.info({ 
        eventId: event.id, 
        eventType, 
        userId: payload.userId,
        targetSystem: event.targetSystem,
      }, 'Processando evento');

      // Processar baseado no sistema de destino
      if (event.targetSystem === 'all' || event.targetSystem === 'grafana') {
        if (this.grafana) {
          await this.processGrafanaEvent(eventType, payload);
        }
      }

      if (event.targetSystem === 'all' || event.targetSystem === 'erpnext') {
        if (this.erpnext) {
          await this.processERPNextEvent(eventType, payload);
        }
      }

      // Marcar como completed
      await db.update(identityProvisioningEvents)
        .set({ 
          status: 'completed',
          processadoEm: new Date(),
        })
        .where(eq(identityProvisioningEvents.id, event.id));

      logger.info({ eventId: event.id }, 'Evento processado com sucesso');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error({ 
        eventId: event.id, 
        error: errorMessage,
        retryCount: event.retryCount,
      }, 'Erro ao processar evento');

      // Atualizar para retry ou failed
      const newRetryCount = event.retryCount + 1;
      const status = newRetryCount >= event.maxRetries ? 'failed' : 'retrying';
      const proximaTentativa = status === 'retrying' 
        ? new Date(Date.now() + this.config.retryDelayMs * newRetryCount)
        : null;

      await db.update(identityProvisioningEvents)
        .set({ 
          status,
          retryCount: newRetryCount,
          errorMessage,
          proximaTentativa,
        })
        .where(eq(identityProvisioningEvents.id, event.id));
    }
  }

  /**
   * Processar evento para Grafana
   */
  private async processGrafanaEvent(eventType: EventType, payload: UserEventPayload): Promise<void> {
    if (!this.grafana) {
      throw new Error('Grafana client não configurado');
    }

    const db = getDatabase();

    switch (eventType) {
      case 'user.created': {
        // Criar usuário no Grafana
        const result = await this.grafana.createUser({
          login: payload.email,
          email: payload.email,
          name: [payload.firstName, payload.lastName].filter(Boolean).join(' ') || payload.email,
        });

        // Atualizar role se especificado
        if (payload.role) {
          await this.grafana.updateUserOrgRole(result.id, 1, payload.role);
        }

        // Salvar mapeamento
        await db.insert(externalUserMappings).values({
          userId: payload.userId,
          externalSystem: 'grafana',
          externalUserId: String(result.id),
          externalUsername: payload.email,
          externalRole: GrafanaClient.mapRole(payload.role || 'viewer'),
          status: 'active',
          lastSyncAt: new Date(),
        });

        logger.info({ userId: payload.userId, grafanaId: result.id }, 'Usuário criado no Grafana');
        break;
      }

      case 'user.updated': {
        // Buscar mapeamento existente
        const [mapping] = await db.select()
          .from(externalUserMappings)
          .where(and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'grafana'),
          ))
          .limit(1);

        if (mapping) {
          await this.grafana.updateUser(parseInt(mapping.externalUserId), {
            name: [payload.firstName, payload.lastName].filter(Boolean).join(' '),
            email: payload.email,
          });

          // Atualizar último sync
          await db.update(externalUserMappings)
            .set({ lastSyncAt: new Date() })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.role_changed': {
        // Buscar mapeamento existente
        const [mappingRole] = await db.select()
          .from(externalUserMappings)
          .where(and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'grafana'),
          ))
          .limit(1);
        const mapping = mappingRole;

        if (mapping && payload.role) {
          await this.grafana.updateUserOrgRole(
            parseInt(mapping.externalUserId),
            1,
            payload.role,
          );

          // Atualizar mapeamento
          await db.update(externalUserMappings)
            .set({ 
              externalRole: GrafanaClient.mapRole(payload.role),
              lastSyncAt: new Date(),
            })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.deleted': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'grafana'),
          ),
        });

        if (mapping) {
          await this.grafana.deleteUser(parseInt(mapping.externalUserId));

          // Remover mapeamento
          await db.delete(externalUserMappings)
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.disabled': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'grafana'),
          ),
        });

        if (mapping) {
          await this.grafana.disableUser(parseInt(mapping.externalUserId));

          // Atualizar status no mapeamento
          await db.update(externalUserMappings)
            .set({ 
              status: 'disabled',
              lastSyncAt: new Date(),
            })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }
    }
  }

  /**
   * Processar evento para ERPNext
   */
  private async processERPNextEvent(eventType: EventType, payload: UserEventPayload): Promise<void> {
    if (!this.erpnext) {
      throw new Error('ERPNext client não configurado');
    }

    const db = getDatabase();

    switch (eventType) {
      case 'user.created': {
        // Criar usuário no ERPNext
        const result = await this.erpnext.createUser({
          email: payload.email,
          first_name: payload.firstName || payload.email.split('@')[0],
          last_name: payload.lastName,
          send_welcome_email: false,
        });

        // Atualizar roles se especificado
        if (payload.role) {
          await this.erpnext.updateUserRoles(payload.email, payload.role);
        }

        // Salvar mapeamento
        await db.insert(externalUserMappings).values({
          userId: payload.userId,
          externalSystem: 'erpnext',
          externalUserId: result.name,
          externalUsername: payload.email,
          externalRole: ERPNextClient.mapRoles(payload.role || 'viewer').join(','),
          status: 'active',
          lastSyncAt: new Date(),
        });

        logger.info({ userId: payload.userId, erpnextUser: result.name }, 'Usuário criado no ERPNext');
        break;
      }

      case 'user.updated': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'erpnext'),
          ),
        });

        if (mapping) {
          await this.erpnext.updateUser(payload.email, {
            first_name: payload.firstName,
            last_name: payload.lastName,
            full_name: [payload.firstName, payload.lastName].filter(Boolean).join(' '),
          });

          // Atualizar último sync
          await db.update(externalUserMappings)
            .set({ lastSyncAt: new Date() })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.role_changed': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'erpnext'),
          ),
        });

        if (mapping && payload.role) {
          await this.erpnext.updateUserRoles(payload.email, payload.role);

          // Atualizar mapeamento
          await db.update(externalUserMappings)
            .set({ 
              externalRole: ERPNextClient.mapRoles(payload.role).join(','),
              lastSyncAt: new Date(),
            })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.deleted': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'erpnext'),
          ),
        });

        if (mapping) {
          await this.erpnext.deleteUser(payload.email);

          // Remover mapeamento
          await db.delete(externalUserMappings)
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }

      case 'user.disabled': {
        // Buscar mapeamento existente
        const mapping = await db.query.externalUserMappings.findFirst({
          where: and(
            eq(externalUserMappings.userId, payload.userId),
            eq(externalUserMappings.externalSystem, 'erpnext'),
          ),
        });

        if (mapping) {
          await this.erpnext.disableUser(payload.email);

          // Atualizar status no mapeamento
          await db.update(externalUserMappings)
            .set({ 
              status: 'disabled',
              lastSyncAt: new Date(),
            })
            .where(eq(externalUserMappings.id, mapping.id));
        }
        break;
      }
    }
  }
}

/**
 * Publicar evento de provisioning
 * Chamado quando um usuário é criado/atualizado/deletado
 */
export async function publishProvisioningEvent(
  eventType: EventType,
  payload: UserEventPayload,
  targetSystem: 'grafana' | 'erpnext' | 'all' = 'all',
  correlationId?: string,
): Promise<void> {
  const db = getDatabase();

  await db.insert(identityProvisioningEvents).values({
    eventType,
    payload,
    targetSystem,
    correlationId,
    tenantId: payload.tenantId,
    status: 'pending',
    retryCount: 0,
    maxRetries: 5,
  });

  logger.info({ eventType, userId: payload.userId, targetSystem }, 'Evento de provisioning publicado');
}

// Instância singleton do processor
let processorInstance: IdentityProvisioningProcessor | null = null;

/**
 * Obter instância do processor
 */
export function getProcessor(): IdentityProvisioningProcessor {
  if (!processorInstance) {
    processorInstance = new IdentityProvisioningProcessor();
  }
  return processorInstance;
}

/**
 * Iniciar processor
 */
export function startProcessor(): void {
  const processor = getProcessor();
  processor.start();
}

/**
 * Parar processor
 */
export function stopProcessor(): void {
  if (processorInstance) {
    processorInstance.stop();
  }
}

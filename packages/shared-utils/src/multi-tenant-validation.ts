/**
 * Multi-Tenant Validation Helpers - Alice Enterprise Platform
 * 
 * Garante consistência de tenantId entre entidades relacionadas.
 * PostgreSQL não suporta CHECK constraints cross-table, então a validação
 * é feita na camada de aplicação antes de INSERT/UPDATE.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Autor: Fillipe Guerra
 * Data: 05 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('multi-tenant-validation');

/**
 * Erro lançado quando há inconsistência de tenant
 */
export class TenantConsistencyError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityTenantId: string | null | undefined,
    public readonly expectedTenantId: string,
    public readonly relatedEntity?: string
  ) {
    super(
      `Inconsistência de tenant: ${entityType} tem tenantId=${entityTenantId} mas deveria ser ${expectedTenantId}` +
      (relatedEntity ? ` (via ${relatedEntity})` : '')
    );
    this.name = 'TenantConsistencyError';
  }
}

/**
 * Interface para entidades que possuem tenantId
 */
interface TenantEntity {
  tenantId: string | null;
}

/**
 * Valida se o tenantId de uma entidade é consistente com o esperado
 * 
 * @param entityType - Nome da entidade sendo validada (para logs)
 * @param entity - Entidade com tenantId
 * @param expectedTenantId - TenantId esperado
 * @param relatedEntity - Nome da entidade relacionada (opcional, para contexto)
 * @throws TenantConsistencyError se houver inconsistência
 * 
 * @example
 * // Validar que namespace pertence ao tenant correto antes de criar agent
 * const namespace = await db.query.namespaces.findFirst({ where: eq(namespaces.id, namespaceId) });
 * validateTenantConsistency('namespace', namespace, tenantId, 'agent');
 */
export function validateTenantConsistency(
  entityType: string,
  entity: TenantEntity | null | undefined,
  expectedTenantId: string,
  relatedEntity?: string
): void {
  if (!entity) {
    throw new Error(`${entityType} não encontrado para validação de tenant`);
  }

  if (entity.tenantId !== expectedTenantId) {
    logger.warn({
      entityType,
      entityTenantId: entity.tenantId,
      expectedTenantId,
      relatedEntity,
    }, 'Tentativa de operação cross-tenant bloqueada');

    throw new TenantConsistencyError(
      entityType,
      entity.tenantId,
      expectedTenantId,
      relatedEntity
    );
  }
}

/**
 * Valida consistência de tenant para criação de Agent
 * 
 * @param namespaceId - ID do namespace onde o agent será criado
 * @param tenantId - TenantId do agent sendo criado
 * @param getNamespace - Função para buscar o namespace (injeção de dependência)
 * @throws TenantConsistencyError se namespace pertencer a outro tenant
 * 
 * @example
 * await validateAgentTenantConsistency(
 *   input.namespaceId,
 *   req.tenantId,
 *   async (id) => db.query.namespaces.findFirst({ where: eq(namespaces.id, id) })
 * );
 */
export async function validateAgentTenantConsistency(
  namespaceId: string | null | undefined,
  tenantId: string,
  getNamespace: (id: string) => Promise<TenantEntity | null | undefined>
): Promise<void> {
  if (!namespaceId) {
    // Agent sem namespace é válido (global ou legado)
    return;
  }

  const namespace = await getNamespace(namespaceId);
  validateTenantConsistency('namespace', namespace, tenantId, 'agent');
}

/**
 * Valida consistência de tenant para criação de Conversation
 * 
 * @param params - Parâmetros da conversation
 * @param tenantId - TenantId da conversation sendo criada
 * @param getters - Funções para buscar entidades relacionadas
 * @throws TenantConsistencyError se alguma entidade pertencer a outro tenant
 * 
 * @example
 * await validateConversationTenantConsistency(
 *   { agentId: input.agentId, namespaceId: input.namespaceId },
 *   req.tenantId,
 *   {
 *     getAgent: async (id) => db.query.agents.findFirst({ where: eq(agents.id, id) }),
 *     getNamespace: async (id) => db.query.namespaces.findFirst({ where: eq(namespaces.id, id) }),
 *   }
 * );
 */
export async function validateConversationTenantConsistency(
  params: {
    agentId?: string | null;
    namespaceId?: string | null;
  },
  tenantId: string,
  getters: {
    getAgent?: (id: string) => Promise<TenantEntity | null | undefined>;
    getNamespace?: (id: string) => Promise<TenantEntity | null | undefined>;
  }
): Promise<void> {
  const { agentId, namespaceId } = params;
  const { getAgent, getNamespace } = getters;

  // Validar agent se fornecido
  if (agentId && getAgent) {
    const agent = await getAgent(agentId);
    validateTenantConsistency('agent', agent, tenantId, 'conversation');
  }

  // Validar namespace se fornecido
  if (namespaceId && getNamespace) {
    const namespace = await getNamespace(namespaceId);
    validateTenantConsistency('namespace', namespace, tenantId, 'conversation');
  }
}

/**
 * Wrapper para validação em batch de múltiplas entidades
 * 
 * @param validations - Array de validações a executar
 * @returns Array de erros encontrados (vazio se tudo OK)
 */
export async function validateMultipleTenantConsistencies(
  validations: Array<{
    entityType: string;
    entity: TenantEntity | null | undefined;
    expectedTenantId: string;
    relatedEntity?: string;
  }>
): TenantConsistencyError[] {
  const errors: TenantConsistencyError[] = [];

  for (const validation of validations) {
    try {
      validateTenantConsistency(
        validation.entityType,
        validation.entity,
        validation.expectedTenantId,
        validation.relatedEntity
      );
    } catch (error) {
      if (error instanceof TenantConsistencyError) {
        errors.push(error);
      } else {
        throw error;
      }
    }
  }

  return errors;
}

import { eq, and, sql, asc, type Database, learningTasks, learningTaskEvents, type LearningTask } from '@alice/database';
import type { Logger } from 'pino';

// =============================================================================
// Learning Orchestrator (Fila priorizada, RLS-friendly, enterprise-grade)
// =============================================================================

export interface CreateLearningTaskInput {
  tenantId: string;
  tipo: string;
  prioridade?: number; // 1 (mais alta) a 10 (mais baixa)
  agentId?: string | null;
  namespaceId?: string | null;
  parametros?: Record<string, unknown>;
  maxTentativas?: number;
  agendadoPara?: Date | null;
  criadoPor?: string | null;
}

export interface UpdateLearningTaskStatusInput {
  taskId: string;
  tenantId: string;
  status: LearningTask['status'];
  progresso?: number;
  erro?: string | null;
  resultado?: Record<string, unknown> | null;
}

const DEFAULT_PRIORITY = 5;
const DEFAULT_MAX_TENTATIVAS = 3;

async function appendLearningEvent(db: Database, logger: Logger, params: { tenantId: string; learningTaskId: string; status: LearningTask['status']; mensagem?: string; payload?: Record<string, unknown>; }) {
  await db.insert(learningTaskEvents).values({
    tenantId: params.tenantId,
    learningTaskId: params.learningTaskId,
    status: params.status,
    mensagem: params.mensagem,
    payload: params.payload ?? {},
  });
  logger.info({ taskId: params.learningTaskId, status: params.status }, 'Evento de learning task registrado');
}

export async function createLearningTask(db: Database, logger: Logger, input: CreateLearningTaskInput): Promise<LearningTask> {
  const [task] = await db
    .insert(learningTasks)
    .values({
      tenantId: input.tenantId,
      tipo: input.tipo,
      prioridade: input.prioridade ?? DEFAULT_PRIORITY,
      agentId: input.agentId ?? null,
      namespaceId: input.namespaceId ?? null,
      parametros: input.parametros ?? {},
      maxTentativas: input.maxTentativas ?? DEFAULT_MAX_TENTATIVAS,
      agendadoPara: input.agendadoPara ?? null,
      criadoPor: input.criadoPor ?? null,
    })
    .returning();

  await appendLearningEvent(db, logger, {
    tenantId: input.tenantId,
    learningTaskId: task.id,
    status: 'pending',
    mensagem: 'Tarefa criada e aguardando processamento',
  });

  return task;
}

/**
 * Remove da fila a próxima tarefa apta (status pending, agendada ou sem agendamento)
 * usando lock pessimista SKIP LOCKED para evitar race em workers paralelos.
 */
export async function dequeueNextLearningTask(db: Database, logger: Logger, tenantId: string): Promise<LearningTask | null> {
  let selected: LearningTask | null = null;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(learningTasks)
      .where(
        and(
          eq(learningTasks.tenantId, tenantId),
          eq(learningTasks.status, 'pending'),
          sql`(${learningTasks.agendadoPara} IS NULL OR ${learningTasks.agendadoPara} <= NOW())`
        )
      )
      .orderBy(
        asc(learningTasks.prioridade),
        sql`${learningTasks.agendadoPara} NULLS FIRST`,
        asc(learningTasks.criadoEm)
      )
      .limit(1)
      .for('update', { skipLocked: true });

    if (!row) {
      selected = null;
      return;
    }

    await tx
      .update(learningTasks)
      .set({
        status: 'processing',
        tentativas: sql`${learningTasks.tentativas} + 1`,
        iniciadoEm: sql`NOW()`,
      })
      .where(eq(learningTasks.id, row.id));

    await appendLearningEvent(tx, logger, {
      tenantId,
      learningTaskId: row.id,
      status: 'processing',
      mensagem: 'Tarefa iniciada pelo orchestrator',
    });

    selected = {
      ...row,
      status: 'processing',
      tentativas: row.tentativas + 1,
      iniciadoEm: new Date(),
    };
  });

  if (!selected) {
    logger.debug({ tenantId }, 'Nenhuma learning task pendente encontrada');
  }

  return selected;
}

export async function updateLearningTaskStatus(db: Database, logger: Logger, input: UpdateLearningTaskStatusInput): Promise<void> {
  await db
    .update(learningTasks)
    .set({
      status: input.status,
      progresso: input.progresso ?? null,
      erro: input.erro ?? null,
      resultado: input.resultado ?? null,
      finalizadoEm: ['completed', 'failed', 'cancelled'].includes(input.status) ? sql`NOW()` : null,
    })
    .where(eq(learningTasks.id, input.taskId));

  await appendLearningEvent(db, logger, {
    tenantId: input.tenantId,
    learningTaskId: input.taskId,
    status: input.status,
    mensagem: input.erro ?? `Status atualizado para ${input.status}`,
  });

  logger.info({ taskId: input.taskId, status: input.status }, 'Learning task atualizada');
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLearningTask, dequeueNextLearningTask, updateLearningTaskStatus } from '../../../apps/rag-service/src/learning-orchestrator.js';
import { schema } from '@alice/database';
import type { Database } from '@alice/database';
import type { Logger } from 'pino';

// Tipos inferidos do schema Drizzle (Regra 2 CLAUDE.md - NÃO DUPLICAR)
type LearningTask = typeof schema.learningTasks.$inferSelect;
type LearningTaskEvent = typeof schema.learningTaskEvents.$inferSelect;

// Interface para mock do Database em testes unitários
// Segue padrão enterprise de tipagem explícita (Regra 8 CLAUDE.md)
interface MockDbQueryBuilder<T> {
  values: (val: Partial<T>) => { returning: () => T[] };
}

interface MockDbUpdateBuilder<T> {
  set: (val: Partial<T>) => { where: () => void };
}

interface MockDb {
  insert: (table: unknown) => MockDbQueryBuilder<LearningTask | LearningTaskEvent>;
  update: (table: unknown) => MockDbUpdateBuilder<LearningTask>;
  transaction: (fn: (tx: MockDb) => Promise<void>) => Promise<void>;
  execute?: (sql: unknown) => Promise<{ rows: LearningTask[] }>;
}

describe('learning-orchestrator', () => {
  let tasks: LearningTask[];
  let events: LearningTaskEvent[];
  let db: MockDb;
  
  // Logger mock tipado (Regra 8 CLAUDE.md - zero any)
  const logger: Pick<Logger, 'info' | 'error' | 'debug'> = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    tasks = [];
    events = [];

    db = {
      insert: (table: unknown) => ({
        values: (val: Partial<LearningTask | LearningTaskEvent>) => {
          const record = val as LearningTask | LearningTaskEvent;
          if (!('id' in record) || !record.id) {
            (record as LearningTask).id = `task-${tasks.length + 1}`;
          }
          const isEvent = table === schema.learningTaskEvents || 'learningTaskId' in record;
          if (isEvent) {
            events.push(record as LearningTaskEvent);
          } else {
            const taskRecord = record as LearningTask;
            if (!taskRecord.status) taskRecord.status = 'pending';
            if (typeof taskRecord.tentativas !== 'number') taskRecord.tentativas = 0;
            tasks.push(record as LearningTask);
          }
          return {
            returning: () => [record],
          };
        },
      }),
      update: () => ({
        set: (val: Partial<LearningTask>) => ({
          where: () => {
            const target = tasks[0];
            if (!target) return;
            const { tentativas, iniciadoEm, ...rest } = val;
            if (val.tentativas !== undefined) {
              const current = typeof target.tentativas === 'number' ? target.tentativas : 0;
              const next = typeof tentativas === 'number' ? tentativas : current + 1;
              target.tentativas = next;
            }
            if (val.status) {
              target.status = val.status;
            }
            if (val.iniciadoEm !== undefined) {
              target.iniciadoEm = iniciadoEm instanceof Date ? iniciadoEm : new Date();
            }
            Object.assign(target, rest);
          },
        }),
      }),
      transaction: async (fn: (tx: MockDb) => Promise<void>) => {
        const tx: MockDb = {
          ...db,
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: (n: number = 1) => ({
                    for: () => {
                      const now = new Date();
                      return tasks
                        .filter(
                          (t) =>
                            t.status === 'pending' &&
                            (!t.agendadoPara || new Date(t.agendadoPara) <= now)
                        )
                        // Ordenação equivalente ao orderBy do código
                        .sort((a, b) => {
                          const prio = (a.prioridade ?? 0) - (b.prioridade ?? 0);
                          if (prio !== 0) return prio;
                          const agA = a.agendadoPara ? new Date(a.agendadoPara).getTime() : -Infinity;
                          const agB = b.agendadoPara ? new Date(b.agendadoPara).getTime() : -Infinity;
                          if (agA !== agB) return agA - agB;
                          const cA = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
                          const cB = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
                          return cA - cB;
                        })
                        .map((t) => ({ ...t }))
                        .slice(0, n);
                    },
                  }),
                }),
              }),
            }),
          }),
          execute: async () => ({
            rows: tasks.filter(
              (t) =>
                t.status === 'pending' &&
                (!t.agendadoPara || new Date(t.agendadoPara) <= new Date())
            ),
          }),
        };
        await fn(tx);
      },
    };
  });

  it('cria tarefa e registra evento pending', async () => {
    const task = await createLearningTask(db as unknown as Database, logger as Logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    expect(task.tenantId).toBe('tenant-1');
    expect(events.at(-1)?.status).toBe('pending');
  });

  it('dequeue marca como processing e incrementa tentativas', async () => {
    await createLearningTask(db as unknown as Database, logger as Logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    const dequeued = await dequeueNextLearningTask(db as unknown as Database, logger as Logger, 'tenant-1');

    expect(dequeued?.status).toBe('processing');
    expect(dequeued?.tentativas).toBe(1);
  });

  it('atualiza status para completed e registra evento', async () => {
    const created = await createLearningTask(db as unknown as Database, logger as Logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    await updateLearningTaskStatus(db as unknown as Database, logger as Logger, {
      taskId: created.id,
      tenantId: 'tenant-1',
      status: 'completed',
      progresso: 100,
    });

    expect(tasks[0].status).toBe('completed');
    expect(events.at(-1)?.status).toBe('completed');
  });
});

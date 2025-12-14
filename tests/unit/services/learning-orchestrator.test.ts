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
        values: (val: Partial<LearningTask | LearningTaskEvent>) => ({
          returning: () => {
            const record = val as LearningTask | LearningTaskEvent;
            if (!('id' in record) || !record.id) {
              (record as LearningTask).id = `task-${tasks.length + 1}`;
            }
            if (table === schema.learningTaskEvents) {
              events.push(record as LearningTaskEvent);
            } else {
              tasks.push(record as LearningTask);
            }
            return [record];
          },
        }),
      }),
      update: () => ({
        set: (val: Partial<LearningTask>) => ({
          where: () => {
            if (tasks[0]) {
              Object.assign(tasks[0], val);
            }
          },
        }),
      }),
      transaction: async (fn: (tx: MockDb) => Promise<void>) => {
        const tx: MockDb = {
          ...db,
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

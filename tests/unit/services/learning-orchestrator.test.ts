import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLearningTask, dequeueNextLearningTask, updateLearningTaskStatus } from '../../../apps/rag-service/src/learning-orchestrator.js';
import { learningTaskEvents } from '@alice/database';

type Task = any;
type Event = any;

interface MockDb {
  insert: (table?: any) => any;
  update: (table?: any) => any;
  transaction: (fn: (tx: MockDb) => Promise<void>) => Promise<void>;
  execute?: (sql: any) => Promise<{ rows: Task[] }>;
}

describe('learning-orchestrator', () => {
  let tasks: Task[];
  let events: Event[];
  let db: MockDb;
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;

  beforeEach(() => {
    tasks = [];
    events = [];

    db = {
      insert: (table?: any) => ({
        values: (val: any) => ({
          returning: () => {
            if (!val.id) {
              val.id = `task-${tasks.length + 1}`;
            }
            if (table === learningTaskEvents) {
              events.push(val);
            } else {
              tasks.push(val);
            }
            return [val];
          },
        }),
      }),
      update: () => ({
        set: (val: any) => ({
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
                (!t.agendado_para || new Date(t.agendado_para) <= new Date())
            ),
          }),
        };
        await fn(tx);
      },
    };
  });

  it('cria tarefa e registra evento pending', async () => {
    const task = await createLearningTask(db as any, logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    expect(task.tenantId).toBe('tenant-1');
    expect(events.at(-1)?.status).toBe('pending');
  });

  it('dequeue marca como processing e incrementa tentativas', async () => {
    await createLearningTask(db as any, logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    const dequeued = await dequeueNextLearningTask(db as any, logger, 'tenant-1');

    expect(dequeued?.status).toBe('processing');
    expect(dequeued?.tentativas).toBe(1);
  });

  it('atualiza status para completed e registra evento', async () => {
    const created = await createLearningTask(db as any, logger, {
      tenantId: 'tenant-1',
      tipo: 'fine_tune',
    });

    await updateLearningTaskStatus(db as any, logger, {
      taskId: created.id,
      tenantId: 'tenant-1',
      status: 'completed',
      progresso: 100,
    });

    expect(tasks[0].status).toBe('completed');
    expect(events.at(-1)?.status).toBe('completed');
  });
});

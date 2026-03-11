import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('gpu runtime persistence guards', () => {
  it('define gpu_runtime_state and gpu_runtime_events in shared schema with operational indexes', () => {
    const schemaSource = read('packages/shared/src/schema.ts');

    expect(schemaSource.includes('"gpu_runtime_state"')).toBe(true);
    expect(schemaSource.includes('"gpu_runtime_events"')).toBe(true);
    expect(schemaSource.includes('uqGpuRuntimeStateRuntimeKey')).toBe(true);
    expect(schemaSource.includes('idxGpuRuntimeEventsStateCreated')).toBe(true);
    expect(schemaSource.includes('gpuRuntimeEventTypeEnum')).toBe(true);
  });

  it('ships SQL migration 0106 with enums, constraints and audit indexes', () => {
    const migrationSource = read('migrations/0106_gpu_runtime_state_and_events.sql');

    expect(migrationSource.includes('CREATE TYPE gpu_runtime_mode')).toBe(true);
    expect(migrationSource.includes('CREATE TABLE IF NOT EXISTS gpu_runtime_state')).toBe(true);
    expect(migrationSource.includes('CREATE TABLE IF NOT EXISTS gpu_runtime_events')).toBe(true);
    expect(migrationSource.includes('chk_gpu_runtime_state_active_services_array')).toBe(true);
    expect(migrationSource.includes('idx_gpu_runtime_events_failed_only')).toBe(true);
  });

  it('keeps transactional write path in gpu runtime state store', () => {
    const storeSource = read('apps/gpu-manager-service/src/gpu-runtime-state-store.ts');

    expect(storeSource.includes('db.transaction(async (tx) =>')).toBe(true);
    expect(storeSource.includes('tx.insert(schema.gpuRuntimeEvents)')).toBe(true);
    expect(storeSource.includes('tx.update(schema.gpuRuntimeState)')).toBe(true);
    expect(storeSource.includes('tx.insert(schema.gpuRuntimeState)')).toBe(true);
  });

  it('integrates durable snapshots on startup, queue switches and manual restore route', () => {
    const managerSource = read('apps/gpu-manager-service/src/index.ts');

    expect(managerSource.includes("eventType: 'switch_requested'")).toBe(true);
    expect(managerSource.includes("eventType: 'switch_completed'")).toBe(true);
    expect(managerSource.includes("eventType: 'switch_failed'")).toBe(true);
    expect(managerSource.includes("eventType: 'manual_restore_requested'")).toBe(true);
    expect(managerSource.includes("eventType: 'manual_restore_completed'")).toBe(true);
    expect(managerSource.includes("eventType: 'manual_restore_failed'")).toBe(true);
    expect(managerSource.includes('gpuRuntimeStateStore.getCurrentStateWithEvents(10)')).toBe(true);
    expect(managerSource.includes("triggerSource: 'startup'")).toBe(true);
  });
});

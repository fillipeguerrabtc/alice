import { describe, expect, it } from 'vitest';
import {
  RUNTIME_ANNOUNCEMENTS_CHANNEL,
  runtimeAnnouncementSchema,
} from '../../packages/shared-utils/src/runtime-announcements';

describe('runtime-announcements contract', () => {
  it('usa o canal Redis canônico de anúncios de runtime', () => {
    expect(RUNTIME_ANNOUNCEMENTS_CHANNEL).toBe('alice:runtime:announcements');
  });

  it('aceita payload válido de interrupção por treinamento', () => {
    const payload = {
      type: 'runtime_notice',
      version: 1,
      source: 'gpu_manager',
      code: 'serving_interrupted_for_training',
      occurredAt: new Date().toISOString(),
    };

    const parsed = runtimeAnnouncementSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('rejeita payload com código inválido', () => {
    const payload = {
      type: 'runtime_notice',
      version: 1,
      source: 'gpu_manager',
      code: 'invalid_code',
      occurredAt: new Date().toISOString(),
    };

    const parsed = runtimeAnnouncementSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});

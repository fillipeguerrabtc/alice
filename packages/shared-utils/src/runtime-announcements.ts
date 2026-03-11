import { z } from 'zod';

export const RUNTIME_ANNOUNCEMENTS_CHANNEL = 'alice:runtime:announcements';

export const runtimeNoticeCodeSchema = z.enum([
  'serving_interrupted_for_training',
  'training_in_progress',
  'serving_restored',
]);

export type RuntimeNoticeCode = z.infer<typeof runtimeNoticeCodeSchema>;

export const runtimeAnnouncementSchema = z.object({
  type: z.literal('runtime_notice'),
  version: z.literal(1),
  source: z.literal('gpu_manager'),
  code: runtimeNoticeCodeSchema,
  occurredAt: z.string().datetime(),
});

export type RuntimeAnnouncement = z.infer<typeof runtimeAnnouncementSchema>;

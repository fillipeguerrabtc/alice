import { z } from 'zod';

export const trainingHyperparamsSchema = z.object({
  epochs: z.number().int().min(1).max(50),
  learningRate: z.number().gt(0).lt(1),
  batchSize: z.number().int().min(1).max(64),
  maxSeqLen: z.number().int().min(256).max(32768),
  gradientAccumulationSteps: z.number().int().min(1).max(128),
  warmupSteps: z.number().int().min(0).max(10000),
  loraRank: z.number().int().min(4).max(128),
  loraAlpha: z.number().int().min(8).max(256),
  loraDropout: z.number().min(0).max(0.5),
});

export type TrainingHyperparams = z.infer<typeof trainingHyperparamsSchema>;

export type TrainingHyperparamsJsonErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_SHAPE';

export class TrainingHyperparamsJsonError extends Error {
  public readonly code: TrainingHyperparamsJsonErrorCode;
  public readonly raw: string;
  public readonly causeDetails?: unknown;

  public constructor(params: {
    code: TrainingHyperparamsJsonErrorCode;
    message: string;
    raw: string;
    causeDetails?: unknown;
  }) {
    super(params.message);
    this.name = 'TrainingHyperparamsJsonError';
    this.code = params.code;
    this.raw = params.raw;
    this.causeDetails = params.causeDetails;
  }
}

export function parseTrainingHyperparamsJson(raw: string): TrainingHyperparams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new TrainingHyperparamsJsonError({
      code: 'INVALID_JSON',
      message: 'JSON invalido para hyperparams de treinamento',
      raw,
      causeDetails: error,
    });
  }

  const result = trainingHyperparamsSchema.safeParse(parsed);
  if (!result.success) {
    throw new TrainingHyperparamsJsonError({
      code: 'INVALID_SHAPE',
      message: 'Shape invalido para hyperparams de treinamento',
      raw,
      causeDetails: result.error.flatten(),
    });
  }

  return result.data;
}

export function stringifyTrainingHyperparams(obj: TrainingHyperparams): string {
  const validated = trainingHyperparamsSchema.parse(obj);
  return JSON.stringify(validated);
}


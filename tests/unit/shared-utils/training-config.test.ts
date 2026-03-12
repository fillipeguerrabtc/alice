import { describe, expect, it } from 'vitest';
import {
  parseTrainingHyperparamsJson,
  stringifyTrainingHyperparams,
} from '../../../packages/shared-utils/src/training-config';

describe('shared training hyperparams contract', () => {
  it('preenche defaults dos novos campos ao ler payload legado sem scheduler/gradNorm/targetModules', () => {
    const parsed = parseTrainingHyperparamsJson(JSON.stringify({
      epochs: 2,
      learningRate: 0.0001,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 4,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
    }));

    expect(parsed.lrSchedulerType).toBe('linear');
    expect(parsed.maxGradNorm).toBe(1);
    expect(parsed.targetModules).toEqual(['q_proj', 'v_proj']);
  });

  it('rejeita valores fora das capacidades reais do trainer (dropout > 0.5)', () => {
    expect(() => parseTrainingHyperparamsJson(JSON.stringify({
      epochs: 2,
      learningRate: 0.0001,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 4,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.8,
      lrSchedulerType: 'linear',
      maxGradNorm: 1,
      targetModules: ['q_proj', 'v_proj'],
    }))).toThrow(/Shape invalido para hyperparams de treinamento/);
  });

  it('serializa e desserializa hiperparâmetros completos de forma estável', () => {
    const source = {
      epochs: 3,
      learningRate: 0.0002,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 2,
      warmupSteps: 0,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      lrSchedulerType: 'cosine' as const,
      maxGradNorm: 0.8,
      targetModules: ['q_proj', 'k_proj', 'v_proj'],
    };

    const encoded = stringifyTrainingHyperparams(source);
    const parsed = parseTrainingHyperparamsJson(encoded);
    expect(parsed).toEqual(source);
  });
});

import { describe, expect, it } from 'vitest';
import { NamespaceProfileConfigSchema } from '@alice/shared';
import { normalizeNamespaceProfileConfigAutoCollect } from '../../apps/chat-service/src/namespace-profiles';

describe('normalizeNamespaceProfileConfigAutoCollect', () => {
  it('preenche autoCollect parcial sem quebrar perfis legados', () => {
    const defaultConfig = NamespaceProfileConfigSchema.parse({
      autoCollect: {
        enabled: true,
        requiresUserConsent: true,
        sampling: {
          enabled: true,
          rate: 0.5,
          deterministicKey: 'semhash',
        },
        caps: {
          dailyTenantCap: 1000,
          dailyNamespaceCap: 300,
          dailyUserCap: 100,
        },
        minChars: {
          user: 8,
          assistant: 16,
        },
        alwaysNeedsHumanReview: false,
        rejectIfDuplicate: false,
      },
      privacy: {
        enabled: true,
        rules: [],
        logRedactionSummary: true,
      },
      quality: {
        enabled: true,
        minScore: 0.35,
        autoRejectBelowMin: true,
        ruleBased: {
          enabled: true,
          weights: {
            coherence: 0.25,
            informativeness: 0.35,
            safety: 0.4,
          },
          requiredPatterns: [],
          bannedPatterns: [],
        },
        llmJudge: {
          enabled: false,
          model: 'Qwen/Qwen3-8B-AWQ',
          temperature: 0.1,
          maxTokens: 512,
          promptSystemConfigKey: 'TRAINING_LLM_JUDGE_PROMPT',
          schemaVersion: 'v1',
        },
      },
      dedupe: {
        scope: 'tenant',
        similarityThreshold: 0.95,
      },
      history: {
        relevanceThreshold: 0.12,
        alwaysIncludeCount: 4,
        minMessages: 0,
        fallbackEnabled: false,
        searchLimit: 200,
        searchTokenBudget: 1200,
        searchConversationsLimit: 20,
      },
      sla: {
        syncSeconds: 18,
        streamSeconds: 12,
        websocketSeconds: 12,
        websocketMediaSeconds: 18,
        externalSeconds: 20,
        titleSeconds: 6,
      },
      routing: {
        threshold: 0.08,
        gpuPriority: 'medium',
        promptTokenBudget: 2800,
      },
    });

    const legacyConfig = {
      ...defaultConfig,
      autoCollect: {
        minChars: {
          assistant: 24,
        },
      },
    } as unknown as typeof defaultConfig;

    const normalized = normalizeNamespaceProfileConfigAutoCollect(legacyConfig, defaultConfig);

    expect(normalized.autoCollect.enabled).toBe(true);
    expect(normalized.autoCollect.sampling.enabled).toBe(true);
    expect(normalized.autoCollect.minChars.user).toBe(8);
    expect(normalized.autoCollect.minChars.assistant).toBe(24);
    expect(normalized.autoCollect.caps.dailyTenantCap).toBe(1000);
  });
});

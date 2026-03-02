import { describe, expect, it } from 'vitest';
import { NamespaceProfileConfigSchema } from '@alice/shared';
import { applyPrivacyPolicy, deterministicSample, incrementWithDailyCap } from '@alice/shared-utils';

class InMemoryRedisForTest {
  private values = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const current = this.values.get(key) ?? 0;
    const next = current + 1;
    this.values.set(key, next);
    return next;
  }

  async expire(): Promise<number> {
    return 1;
  }

  async decr(key: string): Promise<number> {
    const current = this.values.get(key) ?? 0;
    const next = current - 1;
    this.values.set(key, next);
    return next;
  }

  async del(key: string): Promise<number> {
    const existed = this.values.has(key);
    this.values.delete(key);
    return existed ? 1 : 0;
  }
}

const DEFAULT_PROFILE_CONFIG = {
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
      model: 'Qwen/Qwen2.5-7B-Instruct-AWQ',
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
} as const;

describe('training auto-collect governance', () => {
  it('valida config padrão de namespace profile seedada', () => {
    const parsed = NamespaceProfileConfigSchema.parse(DEFAULT_PROFILE_CONFIG);
    expect(parsed.autoCollect.enabled).toBe(true);
    expect(parsed.quality.minScore).toBe(0.35);
    expect(parsed.dedupe.scope).toBe('tenant');
  });

  it('aplica redação de privacidade sem guardar conteúdo sensível', () => {
    const result = applyPrivacyPolicy({
      messages: [{ role: 'user', content: 'Meu CPF é 123.456.789-00' }],
      privacyConfig: {
        enabled: true,
        rules: [
          {
            id: 'cpf-redact',
            action: 'redact',
            pattern: '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}',
            replacement: '[CPF_REDACTED]',
          },
        ],
        logRedactionSummary: true,
      },
    });
    expect(result.action).toBe('allow');
    expect(result.messagesRedacted[0]?.content).toContain('[CPF_REDACTED]');
    expect(result.summary.totalMatches).toBe(1);
  });

  it('quarentena quando regra de privacidade exige revisão', () => {
    const result = applyPrivacyPolicy({
      messages: [{ role: 'user', content: 'token secreto: sk-abc123' }],
      privacyConfig: {
        enabled: true,
        rules: [{ id: 'secret', action: 'quarantine', pattern: 'sk-[a-z0-9]+' }],
        logRedactionSummary: true,
      },
    });
    expect(result.action).toBe('quarantine');
  });

  it('deterministicSample é estável para o mesmo semhash', () => {
    const semhash = 'abcdef0123456789';
    const first = deterministicSample(semhash, 0.42);
    const second = deterministicSample(semhash, 0.42);
    expect(first).toBe(second);
  });

  it('deterministicSample com conversationId UUID respeita taxa e não aceita tudo', () => {
    const samples = Array.from({ length: 120 }, (_, idx) =>
      `00000000-0000-0000-0000-${String(idx).padStart(12, '0')}`
    );
    const accepted = samples.filter((seed) => deterministicSample(seed, 0.1)).length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(80);
  });

  it('incrementWithDailyCap bloqueia ao ultrapassar cap diário', async () => {
    const redis = new InMemoryRedisForTest() as unknown as Parameters<typeof incrementWithDailyCap>[0];
    const key = 'training:cap:tenant:test';
    const first = await incrementWithDailyCap(redis, key, 1);
    const second = await incrementWithDailyCap(redis, key, 1);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.current).toBe(1);
  });
});

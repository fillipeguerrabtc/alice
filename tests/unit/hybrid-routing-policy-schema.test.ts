/**
 * Testes de contrato - política híbrida de roteamento
 *
 * Author: Fillipe Guerra
 * Data: 06/03/2026
 */

import { describe, expect, it } from 'vitest';
import { HybridRoutingPolicySchema, TenantConfiguracoesSchema } from '../../packages/shared/src/schema';

function buildValidPolicy() {
  return {
    version: 1,
    enabled: true,
    thresholds: {
      autoAccept: 0.12,
      humanReview: 0.06,
      clusterAutoTagConfidence: 0.9,
      clusterAutoTagMinSize: 8,
    },
    transversalDefault: {
      enabled: true,
      defaultNamespaceSlug: 'default',
      greetingsToDefault: true,
      reuseGateToDefault: true,
      domainExceptionTerms: ['trading', 'btc'],
    },
    humanReview: {
      enabled: true,
      queueLowConfidenceRouting: true,
      highRiskRoutes: ['/trading'],
    },
    exceptions: [],
  } as const;
}

describe('Hybrid routing policy schema', () => {
  it('accepts a valid enterprise hybrid policy', () => {
    const parsed = HybridRoutingPolicySchema.parse(buildValidPolicy());
    expect(parsed.enabled).toBe(true);
    expect(parsed.thresholds.autoAccept).toBeGreaterThanOrEqual(parsed.thresholds.humanReview);
  });

  it('rejects policy when humanReview threshold is greater than autoAccept', () => {
    const invalid = buildValidPolicy();
    const result = HybridRoutingPolicySchema.safeParse({
      ...invalid,
      thresholds: {
        ...invalid.thresholds,
        humanReview: 0.2,
        autoAccept: 0.1,
      },
    });

    expect(result.success).toBe(false);
  });

  it('requires targetNamespaceSlug for force_namespace exceptions', () => {
    const invalid = buildValidPolicy();
    const result = HybridRoutingPolicySchema.safeParse({
      ...invalid,
      exceptions: [
        {
          id: 'force-trading',
          enabled: true,
          action: 'force_namespace',
          routePrefix: '/trading',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('allows tenant config override with hybridRouting', () => {
    const parsed = TenantConfiguracoesSchema.parse({
      hybridRouting: buildValidPolicy(),
    });

    expect(parsed.hybridRouting?.transversalDefault.defaultNamespaceSlug).toBe('default');
  });
});

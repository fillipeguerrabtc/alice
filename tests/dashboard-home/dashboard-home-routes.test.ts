import { describe, expect, it } from 'vitest';
import { buildPrioritizedAlerts } from '../../apps/chat-service/src/dashboard-home-routes';

describe('buildPrioritizedAlerts', () => {
  it('filtra alertas por permissão real do papel ativo', () => {
    const alerts = buildPrioritizedAlerts({
      fallbackSummary: {
        total: 9,
        last24h: 3,
        last7d: 7,
        unmappedContexts: 2,
        reviewQueue: 4,
      },
      observability: {
        avgLatencyMs: 120,
        servicesOnline: 5,
        servicesDegraded: 1,
        servicesOffline: 1,
        breakerOpen: 1,
        breakerHalfOpen: 1,
        breakerClosed: 2,
        sla: {
          breachedCount: 2,
          atRiskCount: 3,
          onTrackCount: 10,
        },
      },
      permissions: {
        manageConversations: true,
        openObservability: false,
        viewRouting: false,
        viewTraining: false,
      },
      takeoverSummary: {
        pendingHandoffs: 6,
        urgentHandoffs: 2,
        activeHumanAgents: 3,
      },
      trainingMetrics: {
        pending: 8,
        dlq: 1,
        inflight: 2,
        maxInflight: 4,
      },
    });

    expect(alerts.map((alert) => alert.id)).toEqual([
      'urgent-handoffs',
      'sla-breached',
      'sla-at-risk',
    ]);
  });

  it('inclui sinais de routing, training e observabilidade quando permitido', () => {
    const alerts = buildPrioritizedAlerts({
      fallbackSummary: {
        total: 9,
        last24h: 3,
        last7d: 7,
        unmappedContexts: 2,
        reviewQueue: 4,
      },
      observability: {
        avgLatencyMs: 120,
        servicesOnline: 5,
        servicesDegraded: 1,
        servicesOffline: 1,
        breakerOpen: 1,
        breakerHalfOpen: 1,
        breakerClosed: 2,
        sla: {
          breachedCount: 2,
          atRiskCount: 3,
          onTrackCount: 10,
        },
      },
      permissions: {
        manageConversations: true,
        openObservability: true,
        viewRouting: true,
        viewTraining: true,
      },
      takeoverSummary: {
        pendingHandoffs: 6,
        urgentHandoffs: 2,
        activeHumanAgents: 3,
      },
      trainingMetrics: {
        pending: 8,
        dlq: 1,
        inflight: 2,
        maxInflight: 4,
      },
    });

    expect(alerts.some((alert) => alert.id === 'offline-services')).toBe(true);
    expect(alerts.some((alert) => alert.id === 'unmapped-contexts')).toBe(true);
    expect(alerts.some((alert) => alert.id === 'training-queue')).toBe(true);
  });
});

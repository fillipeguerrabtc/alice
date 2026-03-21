import { describe, expect, it } from 'vitest';
import { sanitizeDashboardHomePreferences } from '../../packages/shared/src/schema/jsonb-contracts';
import {
  buildNextDashboardPreferences,
  getAvailableDashboardCardIds,
  getDashboardSourceIds,
  getEnabledDashboardCardIds,
  splitDashboardCardsByFold,
} from '../../apps/frontend-service/src/pages/Dashboard/dashboard-home-registry';
import type { DashboardHomeConfigResponse } from '../../apps/frontend-service/src/pages/Dashboard/types';

function buildConfigResponse(): DashboardHomeConfigResponse {
  const permissions = {
    role: 'manager',
    tenantId: 'tenant-1',
    canUploadDocuments: false,
    manageConversations: true,
    openObservability: false,
    viewTraining: false,
    viewRouting: false,
    viewFinance: false,
  } as const;

  return {
    meta: {
      generatedAt: '2026-03-21T00:00:00.000Z',
      preferenceVersion: 1,
    },
    permissions,
    preferences: sanitizeDashboardHomePreferences(undefined, permissions),
    enabledCardIds: [],
    availableCardIds: ['actionRequired', 'supportQueue', 'conversationTrend', 'recentActivity'],
  };
}

describe('dashboard home registry', () => {
  it('calcula cards disponíveis e ativos a partir do saneamento', () => {
    const config = buildConfigResponse();

    expect(getAvailableDashboardCardIds(config)).toEqual([
      'actionRequired',
      'supportQueue',
      'conversationTrend',
      'recentActivity',
    ]);
    expect(getEnabledDashboardCardIds(config)).toEqual([
      'actionRequired',
      'supportQueue',
      'conversationTrend',
      'recentActivity',
    ]);
  });

  it('deduplica fontes compartilhadas entre cards', () => {
    expect(getDashboardSourceIds(['actionRequired', 'supportQueue', 'recentActivity'])).toEqual([
      'priority',
      'recentActivity',
    ]);
  });

  it('recalcula a composição visível ao desabilitar um card', () => {
    const config = buildConfigResponse();
    const next = buildNextDashboardPreferences({
      current: config.preferences,
      permissions: config.permissions,
      updater: (current) => ({
        ...current,
        cards: {
          ...current.cards,
          supportQueue: {
            ...current.cards.supportQueue,
            enabled: false,
          },
        },
        visibleCardIds: current.visibleCardIds.filter((cardId) => cardId !== 'supportQueue'),
      }),
    });

    expect(next.visibleCardIds).toEqual(['actionRequired', 'conversationTrend', 'recentActivity']);
    expect(splitDashboardCardsByFold(next.visibleCardIds)).toEqual({
      aboveFold: ['actionRequired', 'conversationTrend'],
      belowFold: ['recentActivity'],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeDashboardHomePreferences } from '../../packages/shared/src/schema/jsonb-contracts';

describe('sanitizeDashboardHomePreferences', () => {
  it('aplica defaults enxutos para um usuário sem permissões adicionais', () => {
    const result = sanitizeDashboardHomePreferences(undefined, {});

    expect(result.visibleCardIds).toEqual(['actionRequired', 'recentActivity']);
    expect(result.cards.actionRequired.enabled).toBe(true);
    expect(result.cards.recentActivity.timeRange).toBe('24h');
    expect(result.cards.supportQueue).toBeUndefined();
  });

  it('remove cards sem permissão e corrige configurações inválidas', () => {
    const result = sanitizeDashboardHomePreferences({
      version: 999,
      visibleCardIds: ['financeSnapshot', 'conversationTrend', 'conversationTrend', 'ghost'],
      cards: {
        financeSnapshot: {
          enabled: true,
          metricSet: 'cashflow',
        },
        conversationTrend: {
          enabled: true,
          metricSet: 'invalid',
          timeRange: '24h',
        },
      },
    }, {
      manageConversations: true,
      viewFinance: false,
    });

    expect(result.cards.financeSnapshot).toBeUndefined();
    expect(result.visibleCardIds).toEqual(['conversationTrend', 'actionRequired', 'supportQueue', 'recentActivity']);
    expect(result.cards.conversationTrend.metricSet).toBe('conversations');
    expect(result.cards.conversationTrend.timeRange).toBe('7d');
  });

  it('preserva a ordem válida e exclui cards desativados da composição visível', () => {
    const result = sanitizeDashboardHomePreferences({
      visibleCardIds: ['recentActivity', 'actionRequired', 'supportQueue'],
      cards: {
        actionRequired: { enabled: true, limit: 3 },
        recentActivity: { enabled: false, limit: 10, timeRange: '7d' },
        supportQueue: { enabled: true, metricSet: 'urgent' },
      },
    }, {
      manageConversations: true,
    });

    expect(result.visibleCardIds).toEqual(['actionRequired', 'supportQueue', 'conversationTrend']);
    expect(result.cards.recentActivity.enabled).toBe(false);
    expect(result.cards.actionRequired.limit).toBe(3);
    expect(result.cards.supportQueue.metricSet).toBe('urgent');
  });
});

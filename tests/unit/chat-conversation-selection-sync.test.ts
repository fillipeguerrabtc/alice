import { describe, expect, it } from 'vitest';
import {
  buildConversationSelectionSyncKey,
  resolveConversationSelectionSyncState,
} from '../../apps/frontend-service/src/pages/Chat/useChatConversationSelectionSync';

describe('chat conversation selection sync', () => {
  it('preserva selecao canonica persistida e fixa roteamento manual quando existe agente definido', () => {
    expect(resolveConversationSelectionSyncState({
      activeConversation: {
        id: 'conv-1',
        agentId: 'agent-support',
        namespaceId: 'namespace-support',
        titulo: 'Conversa de suporte',
        criadoEm: '2026-03-18T00:00:00.000Z',
        atualizadoEm: '2026-03-18T00:00:00.000Z',
        metadata: {
          selection: {
            selectedAgentId: 'agent-support',
            selectedNamespaceId: 'namespace-support',
            reasoningMode: 'thinking',
          },
        },
      },
      canOverrideReasoningMode: true,
    })).toEqual({
      selectedAreaNamespaceId: 'namespace-support',
      selectedAgentId: 'agent-support',
      selectedReasoningMode: 'thinking',
      routingMode: 'manual',
      routingAgentIds: ['agent-support'],
    });
  });

  it('rebaixa reasoning manual para automatico quando o usuario nao pode sobrescrever', () => {
    expect(resolveConversationSelectionSyncState({
      activeConversation: {
        id: 'conv-2',
        agentId: null,
        namespaceId: 'namespace-sales',
        titulo: 'Conversa de vendas',
        criadoEm: '2026-03-18T00:00:00.000Z',
        atualizadoEm: '2026-03-18T00:00:00.000Z',
        metadata: {
          selection: {
            selectedAgentId: null,
            selectedNamespaceId: 'namespace-sales',
            reasoningMode: 'thinking',
          },
        },
      },
      canOverrideReasoningMode: false,
    })).toEqual({
      selectedAreaNamespaceId: 'namespace-sales',
      selectedAgentId: null,
      selectedReasoningMode: 'auto',
      routingMode: 'auto',
      routingAgentIds: [],
    });
  });

  it('gera estado automatico limpo quando a conversa ainda nao esta disponivel', () => {
    expect(resolveConversationSelectionSyncState({
      activeConversation: null,
      canOverrideReasoningMode: true,
    })).toEqual({
      selectedAreaNamespaceId: null,
      selectedAgentId: null,
      selectedReasoningMode: 'auto',
      routingMode: 'auto',
      routingAgentIds: [],
    });
  });

  it('usa fallback do topo da conversa quando metadata.selection ainda nao existe', () => {
    expect(resolveConversationSelectionSyncState({
      activeConversation: {
        id: 'conv-3',
        agentId: 'agent-legacy',
        namespaceId: 'namespace-legacy',
        titulo: 'Conversa legada',
        criadoEm: '2026-03-18T00:00:00.000Z',
        atualizadoEm: '2026-03-18T00:00:00.000Z',
        metadata: null,
      },
      canOverrideReasoningMode: true,
    })).toEqual({
      selectedAreaNamespaceId: 'namespace-legacy',
      selectedAgentId: 'agent-legacy',
      selectedReasoningMode: 'auto',
      routingMode: 'manual',
      routingAgentIds: ['agent-legacy'],
    });
  });

  it('preserva reasoning automatico quando nao existe override manual na selecao persistida', () => {
    expect(resolveConversationSelectionSyncState({
      activeConversation: {
        id: 'conv-4',
        agentId: null,
        namespaceId: null,
        titulo: 'Conversa automatica',
        criadoEm: '2026-03-18T00:00:00.000Z',
        atualizadoEm: '2026-03-18T00:00:00.000Z',
        metadata: {
          selection: {
            selectedAgentId: null,
            selectedNamespaceId: null,
            reasoningMode: 'auto',
          },
        },
      },
      canOverrideReasoningMode: false,
    })).toEqual({
      selectedAreaNamespaceId: null,
      selectedAgentId: null,
      selectedReasoningMode: 'auto',
      routingMode: 'auto',
      routingAgentIds: [],
    });
  });

  it('gera chave de sync diferente quando a permissao de override muda na mesma conversa', () => {
    expect(buildConversationSelectionSyncKey('conv-10', false)).not.toBe(
      buildConversationSelectionSyncKey('conv-10', true),
    );
  });
});

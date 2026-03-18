import { describe, expect, it } from 'vitest';
import {
  CHAT_AUTOMATIC_OPTION_VALUE,
  applyAgentSelectionChange,
  applyAreaSelectionChange,
  buildCanonicalChatSelectionPayload,
  buildChatAreaOptions,
  buildChatReasoningOptions,
  readConversationSelection,
  normalizeChatSelection,
} from '../../apps/frontend-service/src/pages/Chat/chat-selection';
import type { ChatAgentSummary, ChatNamespace } from '../../apps/frontend-service/src/pages/Chat/useChatQueryState';

const namespaces: ChatNamespace[] = [
  { id: 'namespace-sales', nome: 'Vendas', slug: 'vendas' },
  { id: 'namespace-support', nome: 'Suporte', slug: 'suporte' },
];

const agents: ChatAgentSummary[] = [
  { id: 'agent-sales', nome: 'Sales Agent', preferredName: 'Alice Sales', namespaceId: 'namespace-sales', slug: 'sales' },
  { id: 'agent-support', nome: 'Support Agent', preferredName: 'Alice Support', namespaceId: 'namespace-support', slug: 'support' },
  { id: 'agent-global', nome: 'Global Agent', preferredName: 'Alice Global', namespaceId: null, slug: 'global' },
];

describe('chat-selection', () => {
  it('reseta o agente quando a area muda', () => {
    expect(applyAreaSelectionChange('namespace-support')).toEqual({
      selectedAreaNamespaceId: 'namespace-support',
      selectedAgentId: null,
    });
  });

  it('deriva a area do namespace do agente quando um agente especifico e escolhido', () => {
    expect(applyAgentSelectionChange({
      agentsData: agents,
      namespaces,
      nextAgentId: 'agent-sales',
      selectedAreaNamespaceId: null,
    })).toEqual({
      selectedAreaNamespaceId: 'namespace-sales',
      selectedAgentId: 'agent-sales',
    });
  });

  it('filtra agentes pela area selecionada e invalida agente incoerente', () => {
    expect(normalizeChatSelection({
      agentsData: agents,
      namespaces,
      selectedAgentId: 'agent-support',
      selectedAreaNamespaceId: 'namespace-sales',
    })).toEqual({
      filteredAgents: [agents[1]],
      selectedAgent: agents[1],
      selectedAgentId: 'agent-support',
      selectedAreaNamespaceId: 'namespace-support',
    });
  });

  it('mantem area automatica para agente sem namespace', () => {
    expect(applyAgentSelectionChange({
      agentsData: agents,
      namespaces,
      nextAgentId: 'agent-global',
      selectedAreaNamespaceId: null,
    })).toEqual({
      selectedAreaNamespaceId: null,
      selectedAgentId: 'agent-global',
    });
  });

  it('monta opcoes com automatica em primeiro para areas e o rotulo canonico de raciocinio', () => {
    expect(buildChatAreaOptions(namespaces)[0]).toEqual({
      value: CHAT_AUTOMATIC_OPTION_VALUE,
      label: 'Automática',
      namespaceId: null,
    });
    expect(buildChatReasoningOptions()).toEqual([
      { value: 'auto', label: 'Automático' },
      { value: 'non_thinking', label: 'Rápido' },
      { value: 'thinking', label: 'Mais Profundo' },
    ]);
  });

  it('gera o payload canonico somente com namespaceId, agentId e reasoningMode', () => {
    expect(buildCanonicalChatSelectionPayload({
      agentId: 'agent-sales',
      namespaceId: 'namespace-sales',
      reasoningMode: 'thinking',
    })).toEqual({
      agentId: 'agent-sales',
      namespaceId: 'namespace-sales',
      reasoningMode: 'thinking',
    });

    expect(buildCanonicalChatSelectionPayload({
      agentId: null,
      namespaceId: null,
      reasoningMode: 'auto',
    })).toEqual({
      agentId: null,
      namespaceId: null,
      reasoningMode: 'auto',
    });
  });

  it('prioriza a selecao canonica persistida na conversa ao sincronizar a UI', () => {
    expect(readConversationSelection({
      id: 'conv-1',
      agentId: 'agent-support',
      namespaceId: 'namespace-support',
      titulo: 'Conversa',
      criadoEm: '2026-03-18T00:00:00.000Z',
      atualizadoEm: '2026-03-18T00:00:00.000Z',
      metadata: {
        selection: {
          selectedAgentId: null,
          selectedNamespaceId: 'namespace-sales',
          reasoningMode: 'thinking',
        },
      },
    })).toEqual({
      selectedAgentId: null,
      selectedAreaNamespaceId: 'namespace-sales',
      selectedReasoningMode: 'thinking',
    });
  });

  it('preserva o agente selecionado enquanto a lista de agentes ainda nao carregou', () => {
    expect(normalizeChatSelection({
      agentsData: undefined,
      namespaces: undefined,
      selectedAgentId: 'agent-support',
      selectedAreaNamespaceId: 'namespace-support',
    })).toEqual({
      filteredAgents: [],
      selectedAgent: null,
      selectedAgentId: 'agent-support',
      selectedAreaNamespaceId: 'namespace-support',
    });
  });

  it('remove o agente selecionado quando a lista carregada nao contem mais o agente persistido', () => {
    expect(normalizeChatSelection({
      agentsData: [
        {
          id: 'agent-sales',
          nome: 'Sales Agent',
          preferredName: 'Alice Sales',
          namespaceId: 'namespace-sales',
          slug: 'sales',
        },
      ],
      namespaces,
      selectedAgentId: 'agent-support',
      selectedAreaNamespaceId: 'namespace-support',
    })).toEqual({
      filteredAgents: [],
      selectedAgent: null,
      selectedAgentId: null,
      selectedAreaNamespaceId: 'namespace-support',
    });
  });
});

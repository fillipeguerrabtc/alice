import { describe, expect, it } from 'vitest';
import { resolveLegacyRoutingSelectionSync } from '../../apps/frontend-service/src/pages/Chat/useChatContainerBindings';
import type { ChatAgentSummary, ChatNamespace } from '../../apps/frontend-service/src/pages/Chat/useChatQueryState';

const namespaces: ChatNamespace[] = [
  { id: 'namespace-sales', nome: 'Vendas', slug: 'vendas' },
  { id: 'namespace-support', nome: 'Suporte', slug: 'suporte' },
];

const agents: ChatAgentSummary[] = [
  { id: 'agent-sales', nome: 'Sales Agent', preferredName: 'Alice Sales', namespaceId: 'namespace-sales', slug: 'sales' },
  { id: 'agent-support', nome: 'Support Agent', preferredName: 'Alice Support', namespaceId: 'namespace-support', slug: 'support' },
];

describe('chat container bindings', () => {
  it('nao sobrescreve a area canonica quando o roteamento legado nao informa agente fixo', () => {
    expect(resolveLegacyRoutingSelectionSync({
      agentsData: agents,
      namespaces,
      normalizedSelectedAgentId: null,
      normalizedSelectedAreaNamespaceId: 'namespace-support',
      routingAgentIds: [],
      routingMode: 'auto',
    })).toBeNull();
  });

  it('limpa somente o agente quando o roteamento legado volta para automatico', () => {
    expect(resolveLegacyRoutingSelectionSync({
      agentsData: agents,
      namespaces,
      normalizedSelectedAgentId: 'agent-support',
      normalizedSelectedAreaNamespaceId: 'namespace-support',
      routingAgentIds: [],
      routingMode: 'auto',
    })).toEqual({
      selectedAgentId: null,
      selectedAreaNamespaceId: 'namespace-support',
    });
  });

  it('sincroniza area e agente quando o roteamento legado fixa um agente valido', () => {
    expect(resolveLegacyRoutingSelectionSync({
      agentsData: agents,
      namespaces,
      normalizedSelectedAgentId: null,
      normalizedSelectedAreaNamespaceId: null,
      routingAgentIds: ['agent-sales'],
      routingMode: 'manual',
    })).toEqual({
      selectedAgentId: 'agent-sales',
      selectedAreaNamespaceId: 'namespace-sales',
    });
  });
});

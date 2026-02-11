/**
 * Hardening de isolamento por escopo - Alice Enterprise Platform
 *
 * Garante que namespace/agent geram isolamento determinístico em:
 * - nomes/caminhos de adapters LoRA ativados
 * - chaves de cache de resolução de adapter (chat/integrations)
 *
 * Objetivo: prevenir contaminação cross-namespace/cross-agent.
 */

import { describe, expect, it } from 'vitest';
import { buildCacheKey as buildIntegrationsCacheKey } from '../../../apps/integrations-service/src/lora-adapter-resolver';
import { buildCacheKey as buildChatCacheKey } from '../../../apps/chat-service/src/lora-adapter-resolver';
import { getScopedAdapterName, getScopedAdapterTargetDir } from '../../../apps/training-service/src/lora-job-manager';

describe('Scope Isolation Hardening - Cache Keys', () => {
  it('deve gerar chave única por tenant/namespace/agent no integrations-service', () => {
    const tradingAgentA = buildIntegrationsCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-trading',
      agentId: 'agent-a',
    });
    const tradingAgentB = buildIntegrationsCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-trading',
      agentId: 'agent-b',
    });
    const financeNamespace = buildIntegrationsCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-finance',
    });

    expect(tradingAgentA).not.toBe(tradingAgentB);
    expect(tradingAgentA).not.toBe(financeNamespace);
  });

  it('deve gerar chave única por tenant/namespace/agent no chat-service', () => {
    const keyA = buildChatCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-trading',
      agentId: 'agent-a',
    });
    const keyB = buildChatCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-trading',
      agentId: 'agent-b',
    });
    const keyNamespaceOnly = buildChatCacheKey({
      tenantId: 'tenant-1',
      namespaceId: 'ns-trading',
    });

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyNamespaceOnly);
  });
});

describe('Scope Isolation Hardening - Adapter Activation Paths', () => {
  it('deve priorizar escopo de agent no nome/caminho do adapter', () => {
    const agentScopedJob = {
      id: 'job-agent',
      scopeType: 'agent',
      scopeNamespaceId: 'ns-trading',
      scopeAgentId: 'agent-trader',
    };

    const adapterName = getScopedAdapterName(agentScopedJob as never);
    const adapterPath = getScopedAdapterTargetDir(agentScopedJob as never);

    expect(adapterName).toBe('agent-agent-trader');
    expect(adapterPath).toMatch(/[\\/]agents[\\/]agent-trader$/);
    expect(adapterPath).not.toMatch(/[\\/]namespaces[\\/]ns-trading$/);
  });

  it('deve isolar namespace quando não houver agent específico', () => {
    const namespaceScopedJob = {
      id: 'job-namespace',
      scopeType: 'namespace',
      scopeNamespaceId: 'ns-finance',
      scopeAgentId: null,
    };

    const adapterName = getScopedAdapterName(namespaceScopedJob as never);
    const adapterPath = getScopedAdapterTargetDir(namespaceScopedJob as never);

    expect(adapterName).toBe('namespace-ns-finance');
    expect(adapterPath).toMatch(/[\\/]namespaces[\\/]ns-finance$/);
    expect(adapterPath).not.toMatch(/[\\/]agents[\\/]/);
  });

  it('deve manter fallback determinístico por job quando escopo vier incompleto', () => {
    const incompleteScopeJob = {
      id: 'job-fallback',
      scopeType: 'namespace',
      scopeNamespaceId: null,
      scopeAgentId: null,
    };

    const adapterName = getScopedAdapterName(incompleteScopeJob as never);
    const adapterPath = getScopedAdapterTargetDir(incompleteScopeJob as never);

    expect(adapterName).toBe('job-job-fallback');
    expect(adapterPath).toMatch(/[\\/]namespaces[\\/]unknown$/);
  });
});

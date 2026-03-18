import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chatServicePaths } from '../../../apps/chat-service/src/openapi-specs';

function loadChatSource(): string {
  return readFileSync(
    path.join(process.cwd(), 'apps', 'chat-service', 'src', 'index.ts'),
    'utf-8',
  );
}

describe('Chat canonical selection contract', () => {
  it('aceita namespaceId e agentId anuláveis nos schemas principais do chat', () => {
    const source = loadChatSource();

    expect(source).toContain("agentId: z.string().uuid().nullable().optional()");
    expect(source).toContain("namespaceId: z.string().uuid().nullable().optional()");
    expect(source).toContain('reasoningMode: reasoningModeSchema.optional()');
  });

  it('persiste seleção canônica e mantém rastreabilidade do roteamento resolvido', () => {
    const source = loadChatSource();

    expect(source).toContain('selection: {');
    expect(source).toContain('selectedNamespaceId: params.selectedNamespaceId');
    expect(source).toContain('selectedAgentId: params.selectedAgentId');
    expect(source).toContain('reasoningMode: params.reasoningMode');
    expect(source).toContain('source: params.source');
    expect(source).toContain('updatedMetadata.routing = {');
    expect(source).toContain('selectedNamespaceId: activeNamespaceId ?? null');
  });

  it('restringe auto-routing por namespace e suporta agente fixo no helper de roteamento', () => {
    const source = loadChatSource();

    expect(source).toContain('fixedAgentId?: string | null;');
    expect(source).toContain('const scopedAgents = params.requestedNamespaceId');
    expect(source).toContain("source: 'fixed'");
    expect(source).toContain("source = 'namespace';");
  });
});

describe('Chat canonical selection OpenAPI', () => {
  it('documenta namespaceId, agentId e reasoningMode nos endpoints principais', () => {
    const createConversation = chatServicePaths['/api/chat/conversations']?.post as {
      requestBody?: { content?: { 'application/json'?: { schema?: { properties?: Record<string, { nullable?: boolean }> } } } };
    };
    const sendMessage = chatServicePaths['/api/chat/conversations/{id}/messages']?.post as {
      requestBody?: { content?: { 'application/json'?: { schema?: { properties?: Record<string, { nullable?: boolean }> } } } };
    };
    const streamChat = chatServicePaths['/api/chat/stream']?.post as {
      requestBody?: { content?: { 'application/json'?: { schema?: { properties?: Record<string, { nullable?: boolean }> } } } };
    };

    expect(createConversation.requestBody?.content?.['application/json']?.schema?.properties?.namespaceId?.nullable).toBe(true);
    expect(createConversation.requestBody?.content?.['application/json']?.schema?.properties?.agentId?.nullable).toBe(true);
    expect(sendMessage.requestBody?.content?.['application/json']?.schema?.properties?.namespaceId?.nullable).toBe(true);
    expect(sendMessage.requestBody?.content?.['application/json']?.schema?.properties?.agentId?.nullable).toBe(true);
    expect(streamChat.requestBody?.content?.['application/json']?.schema?.properties).toHaveProperty('reasoningMode');
    expect(streamChat.requestBody?.content?.['application/json']?.schema?.properties?.namespaceId?.nullable).toBe(true);
    expect(streamChat.requestBody?.content?.['application/json']?.schema?.properties?.agentId?.nullable).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeServerMessage } from '../../apps/frontend-service/src/pages/Chat/chat-message-normalization';

describe('chat message normalization', () => {
  const fallbackAgent = {
    id: 'agent-fallback',
    nome: 'Alice',
    preferredName: 'Alice',
    slug: 'alice',
    avatar: null,
  };

  it('preserva agent null explicito sem reaplicar fallback stale', () => {
    const message = normalizeServerMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Olá! Tudo certo por aí?',
      createdAt: '2026-03-21T09:00:00.000Z',
      agent: null,
    }, {
      fallbackUser: null,
      fallbackAgent,
    });

    expect(message.agent).toBeNull();
  });

  it('aplica fallback apenas quando o payload nao informa agent', () => {
    const message = normalizeServerMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: 'Resposta em stream',
      createdAt: '2026-03-21T09:00:00.000Z',
    }, {
      fallbackUser: null,
      fallbackAgent,
    });

    expect(message.agent).toEqual(fallbackAgent);
  });
});

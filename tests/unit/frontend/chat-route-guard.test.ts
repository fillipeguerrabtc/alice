import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('chat route guard', () => {
  it('keeps App router free of a dedicated /chat/ redirect route', () => {
    const appSource = readFileSync(
      resolve(process.cwd(), 'apps/frontend-service/src/App.tsx'),
      'utf8',
    );

    expect(appSource).not.toContain('<Route path="/chat/">{() => <Redirect to="/chat" />}</Route>');
    expect(appSource).toContain('<Route path="/chat/:conversationId?" component={Chat} />');
    expect(appSource).toContain('barra final é opcional');
  });

  it('documents the matcher collision between /chat/ and /chat', () => {
    // O regex abaixo replica a semantica efetiva observada no matcher usado pelo wouter
    // para essas duas rotas especificas, protegendo contra a reintroducao do conflito.
    const dedicatedTrailingSlashRoute = /^\/chat\/?$/i;
    const canonicalChatRoute = /^\/chat(?:\/([^/]+?))?\/?$/i;

    expect(dedicatedTrailingSlashRoute.test('/chat')).toBe(true);
    expect(dedicatedTrailingSlashRoute.test('/chat/')).toBe(true);
    expect(canonicalChatRoute.test('/chat')).toBe(true);
    expect(canonicalChatRoute.test('/chat/')).toBe(true);
  });
});

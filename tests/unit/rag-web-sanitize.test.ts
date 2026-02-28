import { describe, expect, it } from 'vitest';
import { sanitizeWebSnippet } from '../../apps/rag-service/src/web-sanitize';

describe('sanitizeWebSnippet', () => {
  it('remove HTML, decodifica entidades e limpa vazamento de CSS inline', () => {
    const snippet = [
      '<div>',
      'Tempo &amp; mar em <strong>Guarujá</strong>.',
      '<span style="color:red;font-weight:bold;">color:red;</span>',
      'background-color:#fff; font-size:14px;',
      '</div>',
    ].join(' ');

    const sanitized = sanitizeWebSnippet(snippet);

    expect(sanitized).toContain('Tempo & mar em Guarujá.');
    expect(sanitized).not.toMatch(/<[^>]+>/u);
    expect(sanitized).not.toMatch(/color\s*:\s*red/iu);
    expect(sanitized).not.toMatch(/background-color/iu);
    expect(sanitized).not.toMatch(/font-size/iu);
  });
});

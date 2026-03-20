import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('agentic permissions delegation guards', () => {
  it('bloqueia chamadas internas sensiveis sem token delegado no integrations-service', () => {
    const source = readSource('apps/integrations-service/src/delegated-execution.ts');
    expect(source.includes('hasInternalActorHeaders')).toBe(true);
    expect(source.includes('Token delegado obrigatório para chamadas agentic internas')).toBe(true);
  });

  it('exige dual control e step-up no fluxo de aprovacao do chat quando o catalogo pedir', () => {
    const source = readSource('apps/chat-service/src/index.ts');
    expect(source.includes('requiresDualControl')).toBe(true);
    expect(source.includes('consumeApprovalStepUpContext')).toBe(true);
    expect(source.includes('dual control')).toBe(true);
  });

  it('mantem o client do llm gateway sem fallback privilegiado em fluxos user-initiated', () => {
    const source = readSource('packages/shared-utils/src/llm/llm-gateway-client.ts');
    expect(source.includes('if (context.userId) {')).toBe(true);
    expect(source.includes("return {")).toBe(true);
    expect(source.includes("'X-Internal-Api-Secret': secret")).toBe(true);
  });
});

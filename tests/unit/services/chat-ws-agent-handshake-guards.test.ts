import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadChatServiceSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'chat-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('chat-service ws-agent handshake guards', () => {
  it('routes /ws/agent upgrades to agentWss and keeps /ws/chat isolated', () => {
    const source = loadChatServiceSource();
    expect(source.includes("if (pathname === '/ws/agent')")).toBe(true);
    expect(source.includes('agentWss.handleUpgrade(request, socket, head')).toBe(true);
    expect(source.includes("} else if (pathname === '/ws/chat')")).toBe(true);
    expect(source.includes('wss.handleUpgrade(request, socket, head')).toBe(true);
  });

  it('uses centralized ws-agent auth decision resolver before fallback/reject branches', () => {
    const source = loadChatServiceSource();
    const resolverPattern =
      /const authDecision = resolveWsAgentAuthDecision\(\{\s*hasWsToken,\s*tokenPayloadValid: Boolean\(tokenPayload\),\s*policy: WS_AGENT_AUTH_GOVERNANCE,\s*\}\);/;
    expect(resolverPattern.test(source)).toBe(true);
  });

  it('keeps explicit close reason mapping for missing vs invalid ws-agent token', () => {
    const source = loadChatServiceSource();
    expect(source.includes("resolveWsAgentCloseFrame(authRejectedReason ?? 'unknown')")).toBe(true);
    expect(source.includes('ws.close(closeFrame.code, closeFrame.reason);')).toBe(true);
  });

  it('enforces token claim and query param consistency for agentId and tenantId', () => {
    const source = loadChatServiceSource();
    expect(source.includes('queryAgentId && queryAgentId !== tokenPayload.userId')).toBe(true);
    expect(source.includes("ws.close(4002, 'agentId divergente do token');")).toBe(true);
    expect(source.includes('queryTenantId && queryTenantId !== tokenPayload.tenantId')).toBe(true);
    expect(source.includes("ws.close(4003, 'tenantId divergente do token');")).toBe(true);
  });

  it('derives tenant from DB and rejects claimed tenant mismatch', () => {
    const source = loadChatServiceSource();
    expect(source.includes('const safeTenantId = user.tenantId;')).toBe(true);
    expect(source.includes('if (claimedTenantId !== safeTenantId)')).toBe(true);
    expect(source.includes('ws.close(4005,')).toBe(true);
  });

  it('requires takeover permission and rejects unauthorized agents', () => {
    const source = loadChatServiceSource();
    expect(source.includes("'chat:takeover:write'")).toBe(true);
    expect(source.includes('if (!permissionCheck.allowed)')).toBe(true);
    expect(source.includes('ws.close(4006,')).toBe(true);
    expect(source.includes("wsAgentConnectionTotal.inc({ status: 'accepted' });")).toBe(true);
  });
});

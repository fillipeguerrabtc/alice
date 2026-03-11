import { describe, expect, it } from 'vitest';
import { loadChatSource } from './helpers/chat-source';

describe('chat-service ws-agent handshake guards', () => {
  it('routes /ws/agent upgrades to agentWss and keeps /ws/chat isolated', () => {
    const source = loadChatSource();
    expect(source.includes("if (pathname === '/ws/agent')")).toBe(true);
    expect(source.includes('agentWss.handleUpgrade(request, socket, head')).toBe(true);
    expect(source.includes("} else if (pathname === '/ws/chat')")).toBe(true);
    expect(source.includes('chatWebSocketServer.handleUpgrade(request, socket, head')).toBe(true);
  });

  it('uses centralized ws-agent auth decision resolver before fallback/reject branches', () => {
    const source = loadChatSource();
    const resolverPattern =
      /const authDecision = resolveWsAgentAuthDecision\(\{\s*hasWsToken,\s*tokenPayloadValid: Boolean\(tokenPayload\),\s*policy: [a-zA-Z0-9_]+,\s*\}\);/;
    expect(resolverPattern.test(source)).toBe(true);
  });

  it('does not allow legacy session fallback for /ws/agent handshake', () => {
    const source = loadChatSource();
    expect(source.includes('alice_ws_agent_legacy_session_fallback_total')).toBe(false);
    expect(source.includes('autenticada via fallback legado de sessao')).toBe(false);
  });

  it('keeps explicit close reason mapping for missing vs invalid ws-agent token', () => {
    const source = loadChatSource();
    expect(source.includes("resolveWsAgentCloseFrame(authRejectedReason ?? 'unknown')")).toBe(true);
    expect(source.includes('ws.close(closeFrame.code, closeFrame.reason);')).toBe(true);
  });

  it('enforces token claim and query param consistency for agentId and tenantId', () => {
    const source = loadChatSource();
    expect(source.includes('queryAgentId && queryAgentId !== tokenPayload.userId')).toBe(true);
    expect(source.includes("ws.close(4002, 'agentId divergente do token');")).toBe(true);
    expect(source.includes('queryTenantId && queryTenantId !== tokenPayload.tenantId')).toBe(true);
    expect(source.includes("ws.close(4003, 'tenantId divergente do token');")).toBe(true);
  });

  it('derives tenant from DB and rejects claimed tenant mismatch', () => {
    const source = loadChatSource();
    expect(source.includes('const safeTenantId = user.tenantId;')).toBe(true);
    expect(source.includes('if (claimedTenantId !== safeTenantId)')).toBe(true);
    expect(source.includes('ws.close(4005,')).toBe(true);
  });

  it('requires takeover permission and rejects unauthorized agents', () => {
    const source = loadChatSource();
    expect(source.includes("'chat:takeover:write'")).toBe(true);
    expect(source.includes('if (!permissionCheck.allowed)')).toBe(true);
    expect(source.includes('ws.close(4006,')).toBe(true);
    expect(source.includes("wsAgentConnectionTotal.inc({ status: 'accepted' });")).toBe(true);
  });
});

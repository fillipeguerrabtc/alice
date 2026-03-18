import { describe, expect, it } from 'vitest';
import { useChatWorkspacePresentation } from './useChatWorkspacePresentation';

describe('useChatWorkspacePresentation', () => {
  it('remove controles avançados do topo do chat principal', () => {
    const result = useChatWorkspacePresentation({
      appVersion: '1.0.0',
      conversationId: 'conv-123',
      t: (key) => key,
      versionData: undefined,
    });

    expect(result.showGovernanceControls).toBe(true);
    expect(result.showOperationsControls).toBe(true);
    expect(result.showDesktopActionMenu).toBe(true);
  });

  it('mantem o menu de conversa oculto quando nao existe conversa ativa', () => {
    const result = useChatWorkspacePresentation({
      appVersion: '1.0.0',
      t: (key) => key,
      versionData: undefined,
    });

    expect(result.showDesktopActionMenu).toBe(false);
    expect(result.showOperationsControls).toBe(false);
  });
});

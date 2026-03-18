import type { ChatVersionPayload } from './useChatQueryState';

type UseChatWorkspacePresentationOptions = {
  appVersion: string;
  conversationId?: string;
  t: (key: string) => string;
  versionData?: ChatVersionPayload;
};

export function useChatWorkspacePresentation({
  appVersion,
  conversationId,
  t: _t,
  versionData,
}: UseChatWorkspacePresentationOptions) {
  const resolvedVersion = versionData?.version || appVersion;
  const modelBadgeLabel = versionData?.publicModelName?.trim().length
    ? `Alice ${versionData.publicModelName.trim()}`
    : 'Alice Qwen3-8B';
  const showGovernanceControls = true;
  const showOperationsControls = Boolean(conversationId);
  const showDesktopActionMenu = Boolean(conversationId);

  return {
    modelBadgeLabel,
    resolvedVersion,
    showDesktopActionMenu,
    showGovernanceControls,
    showOperationsControls,
  };
}

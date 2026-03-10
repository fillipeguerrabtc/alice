import { useCallback, useEffect, useMemo } from 'react';
import { CHAT_WORKSPACES } from './chat-page-routing';
import { buildMessageUserSnapshot } from './chat-message-normalization';
import type { ChatApprovalPolicy } from './useChatQueryState';
import type { Dispatch, SetStateAction } from 'react';

type MessageUserSnapshotInput = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
} | null | undefined;

type UseChatContainerBindingsOptions = {
  bumpInputFocus: () => void;
  conversationId?: string;
  currentUser: MessageUserSnapshotInput;
  deleteTargetId: string | null;
  onDeleteConversation: (conversationId: string) => void;
  onUpdateApprovalPolicy: (policy: ChatApprovalPolicy) => void;
  setDeleteTargetId: Dispatch<SetStateAction<string | null>>;
};

export function useChatContainerBindings({
  bumpInputFocus,
  conversationId,
  currentUser,
  deleteTargetId,
  onDeleteConversation,
  onUpdateApprovalPolicy,
  setDeleteTargetId,
}: UseChatContainerBindingsOptions) {
  const workspaceOptions = useMemo(
    () => CHAT_WORKSPACES.map((workspace) => ({
      value: workspace.value,
      label: workspace.label,
    })),
    [],
  );

  const fallbackMessageUser = useMemo(
    () => buildMessageUserSnapshot(currentUser),
    [currentUser],
  );

  useEffect(() => {
    bumpInputFocus();
  }, [bumpInputFocus, conversationId]);

  const handleApprovalPolicyChange = useCallback((value: string) => {
    onUpdateApprovalPolicy(value as ChatApprovalPolicy);
  }, [onUpdateApprovalPolicy]);

  const handleConfirmDeleteTarget = useCallback(() => {
    if (deleteTargetId) {
      onDeleteConversation(deleteTargetId);
    }
    setDeleteTargetId(null);
  }, [deleteTargetId, onDeleteConversation, setDeleteTargetId]);

  return {
    fallbackMessageUser,
    handleApprovalPolicyChange,
    handleConfirmDeleteTarget,
    workspaceOptions,
  };
}

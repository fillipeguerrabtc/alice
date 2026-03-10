import { useMemo } from 'react';
import type { ChatWorkspaceKey } from './chat-page-routing';

type AgentSummary = {
  id: string;
  nome: string;
  preferredName?: string | null;
  slug?: string | null;
};

type ApprovalPolicy = 'always_confirm' | 'confirm_risky' | 'never_confirm';

type WorkspaceHint = {
  description: string;
  title: string;
} | null;

type UseChatWorkspacePresentationOptions = {
  activeWorkspace: ChatWorkspaceKey;
  agentsData?: AgentSummary[];
  appVersion: string;
  approvalPolicy: ApprovalPolicy;
  conversationId?: string;
  t: (key: string) => string;
  versionData?: { version: string | null };
};

export function useChatWorkspacePresentation({
  activeWorkspace,
  agentsData,
  appVersion,
  approvalPolicy,
  conversationId,
  t,
  versionData,
}: UseChatWorkspacePresentationOptions) {
  const resolvedVersion = versionData?.version || appVersion;
  const modelBadgeLabel = resolvedVersion ? `Alice ${resolvedVersion} 7B` : 'Alice 7B';
  const approvalPolicyForSelect: ApprovalPolicy =
    approvalPolicy === 'confirm_risky' ? 'always_confirm' : approvalPolicy;
  const approvalPolicyOptions = [
    { value: 'always_confirm', label: t('chat.approvalPolicy.alwaysConfirm') },
    { value: 'never_confirm', label: t('chat.approvalPolicy.neverConfirm') },
  ] as const;
  const showGovernanceControls = activeWorkspace === 'all' || activeWorkspace === 'governance';
  const showOperationsControls = activeWorkspace === 'all' || activeWorkspace === 'operations';
  const showDiagnosticsControls = activeWorkspace === 'all' || activeWorkspace === 'diagnostics';
  const showConversationWorkspaceHint = activeWorkspace !== 'all';
  const showDesktopActionMenu = Boolean(conversationId) && (showOperationsControls || showDiagnosticsControls);

  const workspaceHint = useMemo<WorkspaceHint>(() => {
    if (activeWorkspace === 'conversation') {
      return {
        title: 'Workspace Conversa',
        description: 'Foque no fluxo de mensagens e contexto da conversa ativa.',
      };
    }
    if (activeWorkspace === 'operations') {
      return {
        title: 'Workspace Operações',
        description: 'Acesse ações operacionais como envio para treinamento, seleção e exclusão.',
      };
    }
    if (activeWorkspace === 'governance') {
      return {
        title: 'Workspace Governança',
        description: 'Ajuste políticas de aprovação e roteamento de agentes por conversa.',
      };
    }
    if (activeWorkspace === 'diagnostics') {
      return {
        title: 'Workspace Diagnóstico',
        description: 'Ative e inspecione detalhes técnicos do stream de resposta.',
      };
    }
    return null;
  }, [activeWorkspace]);

  const agentOptions = useMemo(() => {
    return (agentsData ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.preferredName ?? agent.nome}${agent.slug ? ` (@${agent.slug})` : ''}`,
    }));
  }, [agentsData]);

  return {
    agentOptions,
    approvalPolicyForSelect,
    approvalPolicyOptions,
    modelBadgeLabel,
    resolvedVersion,
    showConversationWorkspaceHint,
    showDesktopActionMenu,
    showDiagnosticsControls,
    showGovernanceControls,
    showOperationsControls,
    workspaceHint,
  };
}

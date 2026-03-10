import type { ChatWorkspaceKey } from '../chat-page-routing';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';

type ChatWorkspaceOption = {
  label: string;
  value: ChatWorkspaceKey;
};

type ChatWorkspaceSectionProps = {
  activeWorkspace: ChatWorkspaceKey;
  onWorkspaceChange: (workspace: ChatWorkspaceKey) => void;
  workspaceOptions: ChatWorkspaceOption[];
};

export function ChatWorkspaceSection({
  activeWorkspace,
  onWorkspaceChange,
  workspaceOptions,
}: ChatWorkspaceSectionProps) {
  return (
    <div className="border-b bg-muted/20 px-2 py-2">
      <WorkspaceFilterBar
        activeWorkspace={activeWorkspace}
        options={workspaceOptions}
        onWorkspaceChange={onWorkspaceChange}
        getTestId={(workspace) => `chat-workspace-${workspace}`}
        buttonClassName="whitespace-nowrap"
        containerClassName="mb-0 flex-nowrap overflow-x-auto pb-1"
      />
    </div>
  );
}

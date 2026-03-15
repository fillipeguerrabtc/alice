import type { ChatWorkspaceKey } from '../chat-page-routing';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <div className="border-b bg-muted/10 px-3 py-2">
      <div className="ml-auto flex w-full justify-end md:max-w-[220px]">
        <Select value={activeWorkspace} onValueChange={(value) => onWorkspaceChange(value as ChatWorkspaceKey)}>
          <SelectTrigger className="h-8 w-full bg-background/80" data-testid="chat-workspace-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {workspaceOptions.map((workspace) => (
              <SelectItem
                key={workspace.value}
                value={workspace.value}
                data-testid={`chat-workspace-${workspace.value}`}
              >
                {workspace.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

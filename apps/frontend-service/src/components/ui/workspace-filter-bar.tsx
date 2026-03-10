import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type WorkspaceOption<TWorkspace extends string> = {
  disabled?: boolean;
  label: string;
  value: TWorkspace;
};

type WorkspaceFilterBarProps<TWorkspace extends string> = {
  activeWorkspace: TWorkspace;
  buttonClassName?: string;
  containerClassName?: string;
  getTestId?: (workspace: TWorkspace) => string;
  onWorkspaceChange: (workspace: TWorkspace) => void;
  options: WorkspaceOption<TWorkspace>[];
};

export function WorkspaceFilterBar<TWorkspace extends string>({
  activeWorkspace,
  buttonClassName,
  containerClassName,
  getTestId,
  onWorkspaceChange,
  options,
}: WorkspaceFilterBarProps<TWorkspace>) {
  return (
    <div className={cn('mb-3 flex flex-wrap gap-2', containerClassName)}>
      {options.map((workspace) => (
        <Button
          key={workspace.value}
          type="button"
          size="sm"
          variant={activeWorkspace === workspace.value ? 'default' : 'outline'}
          onClick={() => onWorkspaceChange(workspace.value)}
          data-testid={getTestId ? getTestId(workspace.value) : undefined}
          disabled={workspace.disabled}
          className={buttonClassName}
        >
          {workspace.label}
        </Button>
      ))}
    </div>
  );
}


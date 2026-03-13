import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  TradingWorkspaceEnvironmentMode,
  TradingWorkspaceOption,
  TradingWorkspacePrimaryMode,
  TradingWorkspacePrimaryModeOption,
} from './types';

type TradingWorkspaceTopBarProps = {
  activeMode: TradingWorkspacePrimaryMode;
  activeWorkspace: string;
  environmentMode: TradingWorkspaceEnvironmentMode;
  modeOptions: TradingWorkspacePrimaryModeOption[];
  onModeChange: (mode: TradingWorkspacePrimaryMode) => void;
  onWorkspaceChange: (workspace: string) => void;
  workspaceOptions: TradingWorkspaceOption[];
};

const ENVIRONMENT_LABEL: Record<TradingWorkspaceEnvironmentMode, string> = {
  real: 'Trading Real',
  demo: 'Trading Demo',
};

export function TradingWorkspaceTopBar({
  activeMode,
  activeWorkspace,
  environmentMode,
  modeOptions,
  onModeChange,
  onWorkspaceChange,
  workspaceOptions,
}: TradingWorkspaceTopBarProps) {
  return (
    <Card className="border-border/60 bg-gradient-to-r from-card via-card to-muted/30 shadow-sm">
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Trading Workspace V2</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-lg font-semibold">Operação estruturada por modo</h2>
              <Badge variant={environmentMode === 'real' ? 'default' : 'secondary'}>
                {ENVIRONMENT_LABEL[environmentMode]}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {modeOptions.map((mode) => {
            const Icon = mode.icon;
            const isActive = activeMode === mode.value;
            return (
              <Button
                key={mode.value}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                className={cn(
                  'h-auto min-h-20 justify-start px-3 py-2 text-left transition-colors',
                  !isActive && 'bg-background',
                )}
                onClick={() => onModeChange(mode.value)}
                data-testid={`workspace-v2-mode-${mode.value}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold leading-tight">{mode.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{mode.description}</span>
                  </span>
                </div>
              </Button>
            );
          })}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {workspaceOptions.map((workspace) => {
            const isActive = activeWorkspace === workspace.value;
            return (
              <Button
                key={workspace.value}
                type="button"
                variant={isActive ? 'secondary' : 'ghost'}
                className={cn('justify-start border text-left', !isActive && 'border-transparent')}
                onClick={() => onWorkspaceChange(workspace.value)}
                data-testid={`workspace-v2-scope-${workspace.value}`}
              >
                {workspace.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

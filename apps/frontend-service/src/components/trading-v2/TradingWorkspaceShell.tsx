import type { ReactNode } from 'react';
import { TradingWorkspaceBottomTray } from './TradingWorkspaceBottomTray';
import { TradingWorkspaceSidebar } from './TradingWorkspaceSidebar';
import { TradingWorkspaceTopBar } from './TradingWorkspaceTopBar';
import type {
  TradingWorkspaceEnvironmentMode,
  TradingWorkspaceOption,
  TradingWorkspacePrimaryMode,
  TradingWorkspacePrimaryModeOption,
  TradingWorkspaceQuickActionSection,
} from './types';

type TradingWorkspaceShellProps = {
  activeMode: TradingWorkspacePrimaryMode;
  activeWorkspace: string;
  bottomTraySections: TradingWorkspaceQuickActionSection[];
  children: ReactNode;
  environmentMode: TradingWorkspaceEnvironmentMode;
  modeOptions: TradingWorkspacePrimaryModeOption[];
  onModeChange: (mode: TradingWorkspacePrimaryMode) => void;
  onWorkspaceChange: (workspace: string) => void;
  sidebarSections: TradingWorkspaceQuickActionSection[];
  workspaceOptions: TradingWorkspaceOption[];
};

export function TradingWorkspaceShell({
  activeMode,
  activeWorkspace,
  bottomTraySections,
  children,
  environmentMode,
  modeOptions,
  onModeChange,
  onWorkspaceChange,
  sidebarSections,
  workspaceOptions,
}: TradingWorkspaceShellProps) {
  return (
    <div className="space-y-4 md:space-y-5">
      <TradingWorkspaceTopBar
        activeMode={activeMode}
        activeWorkspace={activeWorkspace}
        environmentMode={environmentMode}
        modeOptions={modeOptions}
        onModeChange={onModeChange}
        onWorkspaceChange={onWorkspaceChange}
        workspaceOptions={workspaceOptions}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-4">{children}</section>
        <aside className="hidden xl:block">
          <TradingWorkspaceSidebar sections={sidebarSections} />
        </aside>
      </div>

      <div className="xl:hidden">
        <TradingWorkspaceSidebar sections={sidebarSections} compact />
      </div>

      <TradingWorkspaceBottomTray sections={bottomTraySections} />
    </div>
  );
}

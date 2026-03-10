import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TradingTabsShellProps = {
  activeTab: string;
  activeWorkspace: string;
  children: ReactNode;
  onTabChange: (value: string) => void;
  onWorkspaceChange: (workspace: string) => void;
  tabs: Array<{
    icon: LucideIcon;
    label: string;
    testId: string;
    value: string;
  }>;
  workspaceOptions: Array<{
    label: string;
    value: string;
  }>;
};

export function TradingTabsShell({
  activeTab,
  activeWorkspace,
  children,
  onTabChange,
  onWorkspaceChange,
  tabs,
  workspaceOptions,
}: TradingTabsShellProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <WorkspaceFilterBar
        activeWorkspace={activeWorkspace}
        options={workspaceOptions}
        onWorkspaceChange={onWorkspaceChange}
        getTestId={(workspace) => `workspace-${workspace}`}
      />
      {/* MOBILE-FIRST 12/01/2026: Tabs com scroll horizontal para caber em mobile + sidebar */}
      <div className="w-full min-w-0 overflow-x-auto pb-2 -mx-2 px-2 md:mx-0 md:px-0">
        <TabsList className="inline-flex min-w-max flex-nowrap items-center gap-1 whitespace-nowrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                data-testid={tab.testId}
                className="whitespace-nowrap shrink-0"
              >
                <Icon className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {children}
    </Tabs>
  );
}

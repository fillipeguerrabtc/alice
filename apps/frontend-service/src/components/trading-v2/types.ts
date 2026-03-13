import type { LucideIcon } from 'lucide-react';

export type TradingWorkspaceEnvironmentMode = 'real' | 'demo';

export type TradingWorkspacePrimaryMode = 'operate' | 'ai-signals' | 'portfolio-auto' | 'post-trade';

export type TradingWorkspacePrimaryModeOption = {
  description: string;
  icon: LucideIcon;
  label: string;
  value: TradingWorkspacePrimaryMode;
};

export type TradingWorkspaceOption = {
  label: string;
  value: string;
};

export type TradingWorkspaceQuickAction = {
  description?: string;
  disabled?: boolean;
  id: string;
  label: string;
  onSelect: () => void;
  testId?: string;
};

export type TradingWorkspaceQuickActionSection = {
  actions: TradingWorkspaceQuickAction[];
  description?: string;
  id: string;
  title: string;
};

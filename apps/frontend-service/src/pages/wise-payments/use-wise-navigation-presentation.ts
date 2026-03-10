import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import {
  WISE_WORKSPACE_LABELS,
  type WiseTabDescriptor,
  type WiseWorkspaceKey,
} from './wise-payments-navigation';

type UseWiseNavigationPresentationOptions = {
  handleWiseWorkspaceChange: (workspace: WiseWorkspaceKey) => void;
  t: TFunction;
  visibleTabs: WiseTabDescriptor[];
};

/**
 * Isola mapeamentos de apresentação da navegação Wise (workspace + tabs)
 * para reduzir composição inline no container principal.
 */
export function useWiseNavigationPresentation(options: UseWiseNavigationPresentationOptions) {
  const { handleWiseWorkspaceChange, t, visibleTabs } = options;

  const wiseWorkspaceOptions = useMemo(() => (
    WISE_WORKSPACE_LABELS.map((workspace) => ({
      value: workspace.value,
      label: workspace.label,
    }))
  ), []);

  const wiseTabOptions = useMemo(() => (
    visibleTabs.map((tab) => ({
      value: tab.value,
      testId: tab.testId,
      icon: tab.icon,
      label: t(tab.labelKey),
    }))
  ), [t, visibleTabs]);

  const handleWiseWorkspaceSelectionChange = useCallback((workspace: string) => {
    handleWiseWorkspaceChange(workspace as WiseWorkspaceKey);
  }, [handleWiseWorkspaceChange]);

  return {
    handleWiseWorkspaceSelectionChange,
    wiseTabOptions,
    wiseWorkspaceOptions,
  };
}


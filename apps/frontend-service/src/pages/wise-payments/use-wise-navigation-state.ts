import { useCallback, useMemo, useState } from 'react';
import {
  WISE_TAB_DESCRIPTORS,
  WISE_WORKSPACE_TABS,
  type WiseTabKey,
  type WiseWorkspaceKey,
} from './wise-payments-navigation';

export function useWiseNavigationState() {
  const [activeTab, setActiveTab] = useState<WiseTabKey>('balances');
  const [activeWorkspace, setActiveWorkspace] = useState<WiseWorkspaceKey>('all');

  const visibleTabs = useMemo(() => {
    const allowed = WISE_WORKSPACE_TABS[activeWorkspace];
    return WISE_TAB_DESCRIPTORS.filter((tab) => allowed.includes(tab.value));
  }, [activeWorkspace]);

  const handleWiseWorkspaceChange = useCallback((workspace: WiseWorkspaceKey) => {
    setActiveWorkspace(workspace);
    if (workspace === 'all') return;
    const allowed = WISE_WORKSPACE_TABS[workspace];
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'balances');
    }
  }, [activeTab]);

  const handleWiseTabChange = useCallback((nextTab: string) => {
    const normalized = WISE_TAB_DESCRIPTORS.find((tab) => tab.value === nextTab)?.value;
    if (!normalized) return;
    setActiveTab(normalized);
    if (activeWorkspace !== 'all' && !WISE_WORKSPACE_TABS[activeWorkspace].includes(normalized)) {
      setActiveWorkspace('all');
    }
  }, [activeWorkspace]);

  return {
    activeTab,
    activeWorkspace,
    handleWiseTabChange,
    handleWiseWorkspaceChange,
    setActiveTab,
    setActiveWorkspace,
    visibleTabs,
  };
}

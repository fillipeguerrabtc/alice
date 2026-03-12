import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { emitTradingTelemetry } from '@/lib/tradingTelemetry';
import {
  TRADING_TAB_DESCRIPTORS,
  TRADING_WORKSPACE_TABS,
  findWorkspaceForTradingTab,
  type TradingTabKey,
  type TradingWorkspaceKey,
} from './TradingNavigationConfig';

type UseTradingWorkspaceNavigationResult = {
  activeTab: TradingTabKey;
  activeWorkspace: TradingWorkspaceKey;
  handleTabChange: (nextTab: string) => void;
  handleWorkspaceChange: (workspace: TradingWorkspaceKey) => void;
  setActiveTab: Dispatch<SetStateAction<TradingTabKey>>;
};

export function useTradingWorkspaceNavigation(): UseTradingWorkspaceNavigationResult {
  const [activeTab, setActiveTab] = useState<TradingTabKey>('portfolio-auto');
  const [activeWorkspace, setActiveWorkspace] = useState<TradingWorkspaceKey>('all');
  const usageRef = useRef<{ tab: TradingTabKey; workspace: TradingWorkspaceKey } | null>(null);

  const handleWorkspaceChange = useCallback((workspace: TradingWorkspaceKey) => {
    setActiveWorkspace(workspace);
    if (workspace === 'all') return;
    const allowed = TRADING_WORKSPACE_TABS[workspace];
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'overview');
    }
  }, [activeTab]);

  const handleTabChange = useCallback((nextTab: string) => {
    const normalized = TRADING_TAB_DESCRIPTORS.find((tab) => tab.value === nextTab)?.value;
    if (normalized) {
      setActiveTab(normalized);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspace === 'all') return;
    if (!TRADING_WORKSPACE_TABS[activeWorkspace].includes(activeTab)) {
      setActiveWorkspace(findWorkspaceForTradingTab(activeTab));
    }
  }, [activeTab, activeWorkspace]);

  useEffect(() => {
    const previous = usageRef.current;
    if (previous?.tab === activeTab && previous.workspace === activeWorkspace) {
      return;
    }
    emitTradingTelemetry('trading.workspace.usage', {
      source: 'trading',
      workspace: activeWorkspace,
      tab: activeTab,
      reason: previous
        ? (previous.workspace !== activeWorkspace ? 'workspace_change' : 'tab_change')
        : 'initial_mount',
    });
    usageRef.current = { tab: activeTab, workspace: activeWorkspace };
  }, [activeTab, activeWorkspace]);

  return {
    activeTab,
    activeWorkspace,
    handleTabChange,
    handleWorkspaceChange,
    setActiveTab,
  };
}

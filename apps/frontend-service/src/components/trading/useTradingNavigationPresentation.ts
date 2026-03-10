import { useCallback, useMemo } from 'react';
import {
  TRADING_TAB_DESCRIPTORS,
  TRADING_WORKSPACE_LABELS,
  TRADING_WORKSPACE_TABS,
  type TradingWorkspaceKey,
} from './TradingNavigationConfig';
import {
  AUTO_SIGNAL_MODE_OPTIONS,
  SIGNAL_INDICATOR_OPTIONS,
  TRADING_TECHNIQUE_OPTIONS,
} from './TradingSignalConfig';

type Translator = (key: string, options?: { defaultValue?: string }) => string;

type UseTradingNavigationPresentationOptions = {
  activeWorkspace: TradingWorkspaceKey;
  handleWorkspaceChange: (workspace: TradingWorkspaceKey) => void;
  t: Translator;
};

export function useTradingNavigationPresentation({
  activeWorkspace,
  handleWorkspaceChange,
  t,
}: UseTradingNavigationPresentationOptions) {
  const visibleTabs = useMemo(() => {
    const allowed = TRADING_WORKSPACE_TABS[activeWorkspace];
    return TRADING_TAB_DESCRIPTORS.filter((tab) => allowed.includes(tab.value));
  }, [activeWorkspace]);

  const tradingWorkspaceOptions = useMemo(() => (
    TRADING_WORKSPACE_LABELS.map((workspace) => ({
      value: workspace.value,
      label: workspace.labelKey
        ? t(workspace.labelKey, { defaultValue: workspace.fallbackLabel })
        : workspace.fallbackLabel,
    }))
  ), [t]);

  const visibleTabOptions = useMemo(() => (
    visibleTabs.map((tab) => ({
      value: tab.value,
      testId: tab.testId,
      icon: tab.icon,
      label: tab.labelKey
        ? t(tab.labelKey, { defaultValue: tab.fallbackLabel })
        : tab.fallbackLabel,
    }))
  ), [t, visibleTabs]);

  const autoModeOptions = useMemo(
    () => AUTO_SIGNAL_MODE_OPTIONS.map((mode) => ({ value: mode.value, label: mode.label })),
    [],
  );

  const signalIndicatorOptions = useMemo(
    () => SIGNAL_INDICATOR_OPTIONS.map((option) => ({ value: option.key, label: option.label })),
    [],
  );

  const signalTechniqueOptions = useMemo(
    () => TRADING_TECHNIQUE_OPTIONS.map((option) => ({
      value: option.key,
      label: t(option.labelKey),
    })),
    [t],
  );

  const handleWorkspaceSelectionChange = useCallback((workspace: string) => {
    handleWorkspaceChange(workspace as TradingWorkspaceKey);
  }, [handleWorkspaceChange]);

  return {
    autoModeOptions,
    handleWorkspaceSelectionChange,
    signalIndicatorOptions,
    signalTechniqueOptions,
    tradingWorkspaceOptions,
    visibleTabOptions,
  };
}

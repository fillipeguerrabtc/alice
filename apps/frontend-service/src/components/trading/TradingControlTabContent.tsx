import { HandoverPanel } from './HandoverPanel';
import type { ControlHistoryEntry, TradingControlMode } from './HandoverPanel';

type TradingControlTabContentProps = {
  circuitBreakerOpen: boolean;
  controlMode: TradingControlMode;
  controlHistory: ControlHistoryEntry[];
  isLoadingControlHistory: boolean;
  onModeChange: (mode: TradingControlMode, reason: string) => Promise<void>;
  onTradingToggle: (enabled: boolean) => Promise<void>;
  tradingEnabled: boolean;
};

export function TradingControlTabContent({
  circuitBreakerOpen,
  controlMode,
  controlHistory,
  isLoadingControlHistory,
  onModeChange,
  onTradingToggle,
  tradingEnabled,
}: TradingControlTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <HandoverPanel
        currentMode={controlMode}
        tradingEnabled={tradingEnabled}
        circuitBreakerOpen={circuitBreakerOpen}
        history={controlHistory}
        isLoading={isLoadingControlHistory}
        onModeChange={onModeChange}
        onTradingToggle={onTradingToggle}
      />
    </div>
  );
}

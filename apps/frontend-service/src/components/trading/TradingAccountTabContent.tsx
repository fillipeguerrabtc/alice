import { AccountOverview } from './AccountOverview';
import { DepositWithdraw } from './DepositWithdraw';
import { LedgerHistory } from './LedgerHistory';
import { SubAccountsPanel } from './SubAccountsPanel';
import { TradeFees } from './TradeFees';
import { TransferPanel } from './TransferPanel';

type TradingAccountTabContentProps = {
  defaultFuturesSymbol: string;
  onRefreshAccount: () => void;
};

export function TradingAccountTabContent({
  defaultFuturesSymbol,
  onRefreshAccount,
}: TradingAccountTabContentProps) {
  return (
    <div className="space-y-6 mt-6">
      <AccountOverview onRefresh={onRefreshAccount} />
      <DepositWithdraw defaultCurrency="USDT" />
      <TransferPanel defaultCurrency="USDT" />
      <SubAccountsPanel />
      <LedgerHistory />
      <TradeFees defaultFuturesSymbol={defaultFuturesSymbol} />
    </div>
  );
}

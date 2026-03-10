import { TabsContent } from '@/components/ui/tabs';
import { WiseStatementsFilterCard } from './wise-statements-filter-card';
import { WiseStatementsResultCard } from './wise-statements-result-card';
import type { WiseStatementsTabContentProps } from './wise-statements-tab-types';

export function WiseStatementsTabContent({
  balances,
  formatCurrency,
  formatDate,
  isPendingStatement,
  locale,
  onFetchStatement,
  onStatementFieldChange,
  statementCurrencies,
  statementData,
  statementForm,
  t,
  timeZone,
}: WiseStatementsTabContentProps) {
  return (
    <TabsContent value="statements" className="space-y-4 mt-6">
      <WiseStatementsFilterCard
        balances={balances}
        isPendingStatement={isPendingStatement}
        onFetchStatement={onFetchStatement}
        onStatementFieldChange={onStatementFieldChange}
        statementCurrencies={statementCurrencies}
        statementForm={statementForm}
        t={t}
      />
      <WiseStatementsResultCard
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        locale={locale}
        statementData={statementData}
        t={t}
        timeZone={timeZone}
      />
    </TabsContent>
  );
}

import type { ComponentProps } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { TradingAccountTabContent } from './TradingAccountTabContent';
import { TradingChartTabContent } from './TradingChartTabContent';
import { TradingControlTabContent } from './TradingControlTabContent';
import { TradingHistoryTabContent } from './TradingHistoryTabContent';
import { TradingOrderBookTabContent } from './TradingOrderBookTabContent';
import { TradingPostMortemsTabContent } from './TradingPostMortemsTabContent';

type TradingOperationalTabsSectionProps = {
  accountTabProps: ComponentProps<typeof TradingAccountTabContent>;
  chartTabProps: ComponentProps<typeof TradingChartTabContent>;
  controlTabProps: ComponentProps<typeof TradingControlTabContent>;
  historyTabProps: ComponentProps<typeof TradingHistoryTabContent>;
  orderBookTabProps: ComponentProps<typeof TradingOrderBookTabContent>;
  postMortemsTabProps: ComponentProps<typeof TradingPostMortemsTabContent>;
};

export function TradingOperationalTabsSection({
  accountTabProps,
  chartTabProps,
  controlTabProps,
  historyTabProps,
  orderBookTabProps,
  postMortemsTabProps,
}: TradingOperationalTabsSectionProps) {
  return (
    <>
      <TabsContent value="history">
        <TradingHistoryTabContent {...historyTabProps} />
      </TabsContent>

      <TabsContent value="postmortems">
        <TradingPostMortemsTabContent {...postMortemsTabProps} />
      </TabsContent>

      <TabsContent value="chart">
        <TradingChartTabContent {...chartTabProps} />
      </TabsContent>

      <TabsContent value="orderbook">
        <TradingOrderBookTabContent {...orderBookTabProps} />
      </TabsContent>

      <TabsContent value="control">
        <TradingControlTabContent {...controlTabProps} />
      </TabsContent>

      <TabsContent value="account">
        <TradingAccountTabContent {...accountTabProps} />
      </TabsContent>
    </>
  );
}

import type { ComponentProps } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { TradingAnalysisTabContent } from './TradingAnalysisTabContent';
import { TradingLabTabContent } from './TradingLabTabContent';
import { TradingOrdersTabContent } from './TradingOrdersTabContent';
import { TradingOverviewTabContent } from './TradingOverviewTabContent';
import { TradingPortfolioAutoTabContent } from './TradingPortfolioAutoTabContent';
import { TradingPositionsTabContent } from './TradingPositionsTabContent';
import { TradingSignalsAutoTabContent } from './TradingSignalsAutoTabContent';
import { TradingSignalsTabContent } from './TradingSignalsTabContent';

type TradingPrimaryTabsSectionProps = {
  analysisTabProps: ComponentProps<typeof TradingAnalysisTabContent>;
  labTabProps: ComponentProps<typeof TradingLabTabContent>;
  ordersTabProps: ComponentProps<typeof TradingOrdersTabContent>;
  overviewTabProps: ComponentProps<typeof TradingOverviewTabContent>;
  portfolioAutoTabProps: ComponentProps<typeof TradingPortfolioAutoTabContent>;
  positionsTabProps: ComponentProps<typeof TradingPositionsTabContent>;
  signalsAutoTabProps: ComponentProps<typeof TradingSignalsAutoTabContent>;
  signalsTabProps: ComponentProps<typeof TradingSignalsTabContent>;
};

export function TradingPrimaryTabsSection({
  analysisTabProps,
  labTabProps,
  ordersTabProps,
  overviewTabProps,
  portfolioAutoTabProps,
  positionsTabProps,
  signalsAutoTabProps,
  signalsTabProps,
}: TradingPrimaryTabsSectionProps) {
  return (
    <>
      <TabsContent value="overview">
        <TradingOverviewTabContent {...overviewTabProps} />
      </TabsContent>

      <TabsContent value="portfolio-auto">
        <TradingPortfolioAutoTabContent {...portfolioAutoTabProps} />
      </TabsContent>

      <TabsContent value="signals-auto">
        <TradingSignalsAutoTabContent {...signalsAutoTabProps} />
      </TabsContent>

      <TabsContent value="lab">
        <TradingLabTabContent {...labTabProps} />
      </TabsContent>

      <TabsContent value="orders">
        <TradingOrdersTabContent {...ordersTabProps} />
      </TabsContent>

      <TabsContent value="positions">
        <TradingPositionsTabContent {...positionsTabProps} />
      </TabsContent>

      <TabsContent value="signals" className="space-y-4 mt-6">
        <TradingSignalsTabContent {...signalsTabProps} />
      </TabsContent>

      <TabsContent value="analysis">
        <TradingAnalysisTabContent {...analysisTabProps} />
      </TabsContent>
    </>
  );
}

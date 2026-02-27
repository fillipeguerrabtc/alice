import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AGENTIC_MODULE_TABS, type AgenticModuleTab } from './types';

type AgenticConfigTabsProps = {
  activeTab: AgenticModuleTab;
  onTabChange: (tab: AgenticModuleTab) => void;
  contentByTab: Record<AgenticModuleTab, ReactNode>;
};

export function AgenticConfigTabs({ activeTab, onTabChange, contentByTab }: AgenticConfigTabsProps) {
  const { t } = useTranslation();

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as AgenticModuleTab)} className="space-y-6">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-2">
        {AGENTIC_MODULE_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="text-xs sm:text-sm">
            {t(`agenticConfig.tabs.${tab}`)}
          </TabsTrigger>
        ))}
      </TabsList>

      {AGENTIC_MODULE_TABS.map((tab) => (
        <TabsContent key={tab} value={tab} className="space-y-6 mt-0">
          {contentByTab[tab]}
        </TabsContent>
      ))}
    </Tabs>
  );
}

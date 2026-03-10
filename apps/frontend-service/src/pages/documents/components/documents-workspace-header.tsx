import { motion } from 'framer-motion';
import { CheckCircle2, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';
import { cn } from '@/lib/utils';

type DocumentsTabId = 'documents' | 'media';
type DocumentsWorkspaceId = 'all' | 'knowledge' | 'media';

type DocumentsWorkspaceHeaderProps = {
  activeTab: DocumentsTabId;
  activeWorkspace: DocumentsWorkspaceId;
  mediaTotal: number;
  onWorkspaceChange: (workspace: DocumentsWorkspaceId) => void;
  stats: {
    processed: number;
    total: number;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
  tabs: Array<{
    id: DocumentsTabId;
    labelKey: 'documents.tabs.documents' | 'documents.tabs.media';
    testId: string;
  }>;
  workspaceOptions: Array<{
    id: DocumentsWorkspaceId;
    label: string;
  }>;
};

export function DocumentsWorkspaceHeader({
  activeTab,
  activeWorkspace,
  mediaTotal,
  onWorkspaceChange,
  stats,
  t,
  tabs,
  workspaceOptions,
}: DocumentsWorkspaceHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="shrink-0 border-b bg-background/95 p-4 backdrop-blur"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-documents-title">
            {t('documents.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('documents.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'documents' && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Layers className="h-3 w-3" />
                {t('documents.stats.documentsCount', { count: stats.total })}
              </Badge>
              <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                {t('documents.stats.processedCount', { count: stats.processed })}
              </Badge>
            </>
          )}
          {activeTab === 'media' && (
            <Badge variant="secondary" className="gap-1">
              {t('documents.media.statsCount', { count: mediaTotal })}
            </Badge>
          )}
        </div>
      </div>

      <WorkspaceFilterBar
        activeWorkspace={activeWorkspace}
        options={workspaceOptions.map((workspace) => ({
          value: workspace.id,
          label: workspace.label,
        }))}
        onWorkspaceChange={onWorkspaceChange}
        getTestId={(workspace) => `documents-workspace-${workspace}`}
      />

      <TabsList
        className={cn(
          'grid w-full max-w-[280px]',
          tabs.length <= 1 ? 'max-w-[160px] grid-cols-1' : 'grid-cols-2'
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} data-testid={tab.testId}>
            {t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </motion.div>
  );
}

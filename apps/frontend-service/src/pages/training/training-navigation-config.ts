import { Brain, Database, Image, RefreshCw, Upload } from 'lucide-react';

export type TrainingTabKey = 'data' | 'auto-learning' | 'jobs' | 'bulk-import' | 'multimodal';
export type TrainingWorkspaceKey = 'all' | 'operations' | 'automation' | 'ingestion';

export const TRAINING_WORKSPACE_TABS: Record<TrainingWorkspaceKey, TrainingTabKey[]> = {
  all: ['data', 'auto-learning', 'jobs', 'bulk-import', 'multimodal'],
  operations: ['data', 'jobs'],
  automation: ['auto-learning', 'jobs'],
  ingestion: ['bulk-import', 'multimodal', 'data'],
};

export const TRAINING_WORKSPACE_LABELS: Array<{ value: TrainingWorkspaceKey; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'operations', label: 'Operações' },
  { value: 'automation', label: 'Automação' },
  { value: 'ingestion', label: 'Ingestão' },
];

type TrainingTabLabelFn = (params: {
  t: (key: string, options?: Record<string, unknown>) => string;
  statsTotal: number;
  jobsTotal: number;
}) => string;

export const TRAINING_TAB_DESCRIPTORS: Array<{
  value: TrainingTabKey;
  testId: string;
  icon: typeof Database;
  label: TrainingTabLabelFn;
}> = [
  {
    value: 'data',
    testId: 'tab-training-data',
    icon: Database,
    label: ({ t, statsTotal }) => t('training.tabs.data', { count: statsTotal }),
  },
  {
    value: 'auto-learning',
    testId: 'tab-auto-learning',
    icon: RefreshCw,
    label: ({ t }) => t('training.tabs.autoLearning'),
  },
  {
    value: 'jobs',
    testId: 'tab-jobs',
    icon: Brain,
    label: ({ t, jobsTotal }) => t('training.tabs.jobs', { count: jobsTotal }),
  },
  {
    value: 'bulk-import',
    testId: 'tab-bulk-import',
    icon: Upload,
    label: ({ t }) => t('training.bulkImport.title'),
  },
  {
    value: 'multimodal',
    testId: 'tab-multimodal',
    icon: Image,
    label: ({ t }) => t('training.multimodal.tabTitle'),
  },
];

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Database, Filter, Folder, Info, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';

type NamespaceOption = {
  id: string;
  nome: string;
};

type TrainingDataTabContentProps<TData> = {
  autoCollectFilter: string;
  dataLoading: boolean;
  duplicateFilter: string;
  filteredData: TData[];
  filteredPendingCount: number;
  filteredSelectedPendingCount: number;
  namespaceFilter: string;
  namespaces: NamespaceOption[];
  onApproveSelected: () => void;
  onAutoCollectFilterChange: (value: string) => void;
  onClearAllPendingSelection: () => void;
  onDuplicateFilterChange: (value: string) => void;
  onNamespaceFilterChange: (value: string) => void;
  onQuarantineFilterChange: (value: string) => void;
  onRejectSelected: () => void;
  onSelectAllFilteredPending: () => void;
  onSourceFilterChange: (value: string) => void;
  onSourceTypeFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onToggleSelectAllFilteredPending: (checked: boolean) => void;
  quarantineFilter: string;
  renderDataCard: (data: TData) => ReactNode;
  reviewMutationPending: boolean;
  sourceFilter: string;
  sourceOptions: string[];
  sourceTypeFilter: string;
  sourceTypeOptions: string[];
  statusFilter: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  totalSelectedPendingCount: number;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

export function TrainingDataTabContent<TData>({
  autoCollectFilter,
  dataLoading,
  duplicateFilter,
  filteredData,
  filteredPendingCount,
  filteredSelectedPendingCount,
  namespaceFilter,
  namespaces,
  onApproveSelected,
  onAutoCollectFilterChange,
  onClearAllPendingSelection,
  onDuplicateFilterChange,
  onNamespaceFilterChange,
  onQuarantineFilterChange,
  onRejectSelected,
  onSelectAllFilteredPending,
  onSourceFilterChange,
  onSourceTypeFilterChange,
  onStatusFilterChange,
  onToggleSelectAllFilteredPending,
  quarantineFilter,
  renderDataCard,
  reviewMutationPending,
  sourceFilter,
  sourceOptions,
  sourceTypeFilter,
  sourceTypeOptions,
  statusFilter,
  t,
  totalSelectedPendingCount,
}: TrainingDataTabContentProps<TData>) {
  const allFilteredPendingSelected =
    filteredPendingCount > 0 && filteredSelectedPendingCount === filteredPendingCount;

  return (
    <TabsContent value="data" className="flex-1 m-0">
      <div className="p-4 border-b flex items-center gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t('training.filter.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('training.filter.all')}</SelectItem>
            <SelectItem value="pending">{t('training.filter.pending')}</SelectItem>
            <SelectItem value="approved">{t('training.filter.approved')}</SelectItem>
            <SelectItem value="rejected">{t('training.filter.rejected')}</SelectItem>
            <SelectItem value="used">{t('training.filter.used')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={namespaceFilter} onValueChange={onNamespaceFilterChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-namespace-filter">
            <Folder className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t('training.filter.namespace')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('training.filter.allNamespaces')}</SelectItem>
            {namespaces.map((namespace) => (
              <SelectItem key={namespace.id} value={namespace.id}>
                {namespace.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-source-filter">
            <Database className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t('training.filter.source')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('training.filter.allSources')}</SelectItem>
            {sourceOptions.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceTypeFilter} onValueChange={onSourceTypeFilterChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-source-type-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t('training.filter.sourceType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('training.filter.allSources')}</SelectItem>
            {sourceTypeOptions.map((sourceType) => (
              <SelectItem key={sourceType} value={sourceType}>
                {sourceType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={quarantineFilter} onValueChange={onQuarantineFilterChange}>
          <SelectTrigger className="w-[180px]" data-testid="select-quarantine-filter">
            <SelectValue placeholder="Quarentena" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Quarentena: todos</SelectItem>
            <SelectItem value="only">Somente quarentena</SelectItem>
            <SelectItem value="exclude">Excluir quarentena</SelectItem>
          </SelectContent>
        </Select>
        <Select value={duplicateFilter} onValueChange={onDuplicateFilterChange}>
          <SelectTrigger className="w-[180px]" data-testid="select-duplicate-filter">
            <SelectValue placeholder="Duplicados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Duplicados: todos</SelectItem>
            <SelectItem value="only">Somente duplicados</SelectItem>
            <SelectItem value="exclude">Excluir duplicados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={autoCollectFilter} onValueChange={onAutoCollectFilterChange}>
          <SelectTrigger className="w-[180px]" data-testid="select-auto-collect-filter">
            <SelectValue placeholder="Auto-collect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Auto-collect: todos</SelectItem>
            <SelectItem value="only">Somente auto-collect</SelectItem>
            <SelectItem value="exclude">Excluir auto-collect</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {t('training.filter.results', { count: filteredData.length })}
        </span>
      </div>

      {(filteredPendingCount > 0 || totalSelectedPendingCount > 0) && (
        <div className="px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={
                  filteredPendingCount === 0
                    ? false
                    : filteredSelectedPendingCount === 0
                      ? false
                      : filteredSelectedPendingCount === filteredPendingCount
                        ? true
                        : 'indeterminate'
                }
                onCheckedChange={(checked) => onToggleSelectAllFilteredPending(Boolean(checked))}
                disabled={filteredPendingCount === 0 || reviewMutationPending}
                aria-label={t('training.batchSelection.selectAllFiltered')}
              />
              <span className="text-sm font-medium">
                {t('training.batchSelection.selected', { count: totalSelectedPendingCount })}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {t('training.batchSelection.filteredPending', { count: filteredPendingCount })}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectAllFilteredPending}
                disabled={filteredPendingCount === 0 || allFilteredPendingSelected || reviewMutationPending}
                data-testid="button-select-all-filtered"
              >
                {t('training.batchSelection.selectAll')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAllPendingSelection}
                disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
                data-testid="button-deselect-all"
              >
                {t('training.batchSelection.deselectAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-green-600"
                onClick={onApproveSelected}
                disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
              >
                <ThumbsUp className="mr-1 h-3 w-3" />
                {t('training.batchSelection.approveSelected')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600"
                onClick={onRejectSelected}
                disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
              >
                <ThumbsDown className="mr-1 h-3 w-3" />
                {t('training.batchSelection.rejectSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pt-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t('training.approval.title')}</AlertTitle>
          <AlertDescription>{t('training.approval.desc')}</AlertDescription>
        </Alert>
      </div>

      <ScrollArea className="flex-1 p-4">
        {dataLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-48" />
            ))}
          </div>
        ) : filteredData.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-64 text-center"
          >
            <Database className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">{t('training.empty.noData')}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('training.empty.noDataDesc')}
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {filteredData.map((data) => renderDataCard(data))}
          </motion.div>
        )}
      </ScrollArea>
    </TabsContent>
  );
}

import type { ChangeEvent, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Filter, Grid, Layers, List, Loader2, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type NamespaceOption = {
  id: string;
  nome: string;
};

type DocumentsTabStats = {
  total: number;
  processed: number;
  pending: number;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

type DocumentsTabContentProps<TDocument extends { id: string }> = {
  activeNamespaces: NamespaceOption[];
  filterStatus: 'all' | 'processed' | 'pending';
  filteredDocuments: TDocument[];
  isLoading: boolean;
  isLoadingNamespaces: boolean;
  isNamespaceReady: boolean;
  namespaceMap: Map<string, string>;
  onFilterStatusChange: (value: 'all' | 'processed' | 'pending') => void;
  onOpenUploadDialog: () => void;
  onSearchChange: (value: string) => void;
  onSelectedNamespaceChange: (value: string) => void;
  onViewModeChange: (value: 'grid' | 'list') => void;
  renderDocumentCard: (document: TDocument) => ReactNode;
  searchQuery: string;
  selectedNamespaceId: string;
  stats: DocumentsTabStats;
  t: TFunction;
  uploadPending: boolean;
  viewMode: 'grid' | 'list';
};

export function DocumentsTabContent<TDocument extends { id: string }>({
  activeNamespaces,
  filterStatus,
  filteredDocuments,
  isLoading,
  isLoadingNamespaces,
  isNamespaceReady,
  namespaceMap,
  onFilterStatusChange,
  onOpenUploadDialog,
  onSearchChange,
  onSelectedNamespaceChange,
  onViewModeChange,
  renderDocumentCard,
  searchQuery,
  selectedNamespaceId,
  stats,
  t,
  uploadPending,
  viewMode,
}: DocumentsTabContentProps<TDocument>) {
  return (
    <TabsContent value="documents" className="mt-0 p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t('documents.uploadDocument')}</CardTitle>
              <CardDescription>{t('documents.namespace.helper')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('documents.namespace.label')}</span>
                </div>
                <Select
                  value={selectedNamespaceId}
                  onValueChange={onSelectedNamespaceChange}
                  disabled={isLoadingNamespaces || activeNamespaces.length === 0}
                >
                  <SelectTrigger className="w-full" data-testid="select-namespace">
                    <SelectValue
                      placeholder={
                        activeNamespaces.length === 0
                          ? t('documents.namespace.empty')
                          : t('documents.namespace.placeholder')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {activeNamespaces.map((namespace) => (
                      <SelectItem key={namespace.id} value={namespace.id}>
                        {namespace.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  className="w-full"
                  onClick={onOpenUploadDialog}
                  disabled={!isNamespaceReady || uploadPending}
                  data-testid="button-open-upload-dialog"
                >
                  {uploadPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {t('documents.uploadDocument')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {selectedNamespaceId
                    ? `${t('documents.namespace.label')}: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
                    : t('documents.uploadZone.selectNamespaceFirst')}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('documents.stats.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t('documents.stats.processed')}</span>
                <span className="font-medium">
                  {stats.processed}/{stats.total}
                </span>
              </div>
              <Progress value={(stats.processed / Math.max(stats.total, 1)) * 100} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('documents.stats.pendingCount', { count: stats.pending })}</span>
                <span>{Math.round((stats.processed / Math.max(stats.total, 1)) * 100)}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col">
          <Card className="min-w-0">
            <CardHeader className="shrink-0 gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t('documents.search.placeholder')}
                    value={searchQuery}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
                    className="pl-9"
                    data-testid="input-search-documents"
                  />
                </div>

                <Select value={filterStatus} onValueChange={onFilterStatusChange}>
                  <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder={t('documents.search.filter')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('documents.search.all')}</SelectItem>
                    <SelectItem value="processed">{t('documents.search.processed')}</SelectItem>
                    <SelectItem value="pending">{t('documents.search.pending')}</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex rounded-lg border">
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('grid')}
                    data-testid="button-view-grid"
                  >
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('list')}
                    data-testid="button-view-list"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {isLoading ? (
                <div
                  className={cn(
                    'gap-4',
                    viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                  )}
                >
                  {Array.from({ length: 8 }).map((_, index) => (
                    <Skeleton key={index} className={viewMode === 'grid' ? 'h-48' : 'h-20'} />
                  ))}
                </div>
              ) : filteredDocuments.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex h-64 flex-col items-center justify-center text-center"
                >
                  <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
                  <EmptyState
                    title={searchQuery ? t('documents.empty.noResults') : t('documents.empty.noDocuments')}
                    description={searchQuery ? t('documents.empty.tryOtherTerms') : t('documents.empty.uploadToStart')}
                    className="py-0"
                  />
                </motion.div>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className={cn(
                    'gap-4',
                    viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
                  )}
                >
                  <AnimatePresence>{filteredDocuments.map((document) => renderDocumentCard(document))}</AnimatePresence>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TabsContent>
  );
}

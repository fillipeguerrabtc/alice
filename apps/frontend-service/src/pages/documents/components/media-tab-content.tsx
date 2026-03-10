import type { ChangeEvent, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Filter, Grid, ImageIcon, List, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type NamespaceOption = {
  id: string;
  nome: string;
};

type MediaStats = {
  total: number;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

type MediaTabContentProps<TMedia extends { id: string }> = {
  activeNamespaces: NamespaceOption[];
  filterMediaType: 'all' | 'image' | 'audio';
  filteredMediaUploads: TMedia[];
  isLoadingMedia: boolean;
  isLoadingNamespaces: boolean;
  mediaSearchQuery: string;
  mediaStats: MediaStats;
  namespaceMap: Map<string, string>;
  onFilterMediaTypeChange: (value: 'all' | 'image' | 'audio') => void;
  onMediaSearchChange: (value: string) => void;
  onSelectedNamespaceChange: (value: string) => void;
  onViewModeChange: (value: 'grid' | 'list') => void;
  renderMediaCard: (media: TMedia) => ReactNode;
  selectedNamespaceId: string;
  t: TFunction;
  viewMode: 'grid' | 'list';
};

export function MediaTabContent<TMedia extends { id: string }>({
  activeNamespaces,
  filterMediaType,
  filteredMediaUploads,
  isLoadingMedia,
  isLoadingNamespaces,
  mediaSearchQuery,
  mediaStats,
  namespaceMap,
  onFilterMediaTypeChange,
  onMediaSearchChange,
  onSelectedNamespaceChange,
  onViewModeChange,
  renderMediaCard,
  selectedNamespaceId,
  t,
  viewMode,
}: MediaTabContentProps<TMedia>) {
  return (
    <TabsContent value="media" className="mt-0 p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{t('documents.namespace.label')}</CardTitle>
              <CardDescription>{t('documents.namespace.helper')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={selectedNamespaceId || '__all__'}
                onValueChange={onSelectedNamespaceChange}
                disabled={isLoadingNamespaces || activeNamespaces.length === 0}
              >
                <SelectTrigger className="w-full" data-testid="select-media-namespace">
                  <SelectValue placeholder={t('documents.namespace.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('documents.search.all')}</SelectItem>
                  {activeNamespaces.map((namespace) => (
                    <SelectItem key={namespace.id} value={namespace.id}>
                      {namespace.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('documents.stats.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t('documents.media.statsCount', { count: mediaStats.total })}</span>
                <span className="font-medium">{mediaStats.total}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedNamespaceId
                  ? `${t('documents.namespace.label')}: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
                  : t('documents.search.all')}
              </p>
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
                    value={mediaSearchQuery}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => onMediaSearchChange(event.target.value)}
                    className="pl-9"
                    data-testid="input-search-media"
                  />
                </div>

                <Select value={filterMediaType} onValueChange={onFilterMediaTypeChange}>
                  <SelectTrigger className="w-[160px]" data-testid="select-media-type">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder={t('documents.media.filterType')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('documents.media.filterAll')}</SelectItem>
                    <SelectItem value="image">{t('documents.media.filterImage')}</SelectItem>
                    <SelectItem value="audio">{t('documents.media.filterAudio')}</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex rounded-lg border">
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('grid')}
                    data-testid="button-view-media-grid"
                  >
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('list')}
                    data-testid="button-view-media-list"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {isLoadingMedia ? (
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
              ) : filteredMediaUploads.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex h-64 flex-col items-center justify-center text-center"
                >
                  <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground/50" />
                  <EmptyState
                    title={mediaSearchQuery ? t('documents.empty.noResults') : t('documents.media.empty')}
                    description={mediaSearchQuery ? t('documents.empty.tryOtherTerms') : t('documents.media.emptyDesc')}
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
                  <AnimatePresence>{filteredMediaUploads.map((media) => renderMediaCard(media))}</AnimatePresence>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TabsContent>
  );
}

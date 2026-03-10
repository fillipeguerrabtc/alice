import type { TFunction } from 'i18next';
import { Brain, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { SignalApprovalPanel } from './SignalApprovalPanel';

type TradingSignalMetadata = {
  dataSources?: {
    news?: boolean;
  };
  entryPrice?: number;
  expectedDurationLabel?: string;
  expectedDurationMinutes?: number;
  generationSource?: 'on_demand' | 'scheduler' | 'chat';
  invalidationReasons?: string[];
  motivators?: string[];
  news?: {
    query: string;
    results: Array<{ title: string; url: string; score?: number }>;
  };
  operationType?: string;
  riskReward?: number;
  stopLoss?: number;
  takeProfit?: number;
  tradeSummary?: string;
  validationStatus?: 'pending' | 'validated' | 'failed';
};

type TradingSignalRow = {
  confidence: number;
  criadoEm: string;
  id: string;
  marketType: 'futures' | 'spot' | 'margin';
  metadata: TradingSignalMetadata;
  reasoning: string | null;
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  sourceModel: string | null;
  symbol: string;
};

type TradingSignalsResultsSectionProps = {
  formatDurationMinutes: (minutes?: number) => string | null;
  isLoadingSignals: boolean;
  locale: string;
  marketType: 'futures' | 'spot' | 'margin';
  onDeactivateSignal: (signalId: string) => void;
  onSelectSignal: (signalId: string) => void;
  renderSignalTypeBadge: (signalType: TradingSignalRow['signalType']) => ReactNode;
  selectedSignal: TradingSignalRow | null;
  selectedSignalId: string | null;
  signals: TradingSignalRow[];
  t: TFunction;
  timeZone: string;
};

export function TradingSignalsResultsSection({
  formatDurationMinutes,
  isLoadingSignals,
  locale,
  marketType,
  onDeactivateSignal,
  onSelectSignal,
  renderSignalTypeBadge,
  selectedSignal,
  selectedSignalId,
  signals,
  t,
  timeZone,
}: TradingSignalsResultsSectionProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('trading.signals.detail.title')}</CardTitle>
          <CardDescription>
            {selectedSignal
              ? t('trading.signals.detail.subtitle', { symbol: selectedSignal.symbol })
              : t('trading.signals.detail.empty')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedSignal ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.operationType')}</div>
                  <div className="text-sm font-medium">
                    {selectedSignal.metadata?.operationType
                      ? t(`trading.signals.operationType.${selectedSignal.metadata.operationType}`)
                      : t('common.notAvailable')}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.duration')}</div>
                  <div className="text-sm font-medium">
                    {selectedSignal.metadata?.expectedDurationLabel
                      ?? formatDurationMinutes(selectedSignal.metadata?.expectedDurationMinutes)
                      ?? t('common.notAvailable')}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.entry')}</div>
                  <div className="text-sm font-medium">
                    {Number.isFinite(selectedSignal.metadata?.entryPrice)
                      ? `$${formatNumber(Number(selectedSignal.metadata?.entryPrice), locale)}`
                      : t('common.notAvailable')}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.tp')}</div>
                  <div className="text-sm font-medium">
                    {Number.isFinite(selectedSignal.metadata?.takeProfit)
                      ? `$${formatNumber(Number(selectedSignal.metadata?.takeProfit), locale)}`
                      : t('common.notAvailable')}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.sl')}</div>
                  <div className="text-sm font-medium">
                    {Number.isFinite(selectedSignal.metadata?.stopLoss)
                      ? `$${formatNumber(Number(selectedSignal.metadata?.stopLoss), locale)}`
                      : t('common.notAvailable')}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.rr')}</div>
                  <div className="text-sm font-medium">
                    {Number.isFinite(selectedSignal.metadata?.riskReward)
                      ? formatNumber(Number(selectedSignal.metadata?.riskReward), locale, { maximumFractionDigits: 2 })
                      : t('common.notAvailable')}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t('trading.signals.detail.summary')}</div>
                <div className="text-sm">
                  {selectedSignal.metadata?.tradeSummary || selectedSignal.reasoning || t('trading.signals.noReasoning')}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-2">{t('trading.signals.detail.motivators')}</div>
                  {(selectedSignal.metadata?.motivators?.length ?? 0) > 0 ? (
                    <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                      {selectedSignal.metadata?.motivators?.map((item, index) => (
                        <li key={`${selectedSignal.id}-motivator-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('common.notAvailable')}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2">{t('trading.signals.detail.invalidations')}</div>
                  {(selectedSignal.metadata?.invalidationReasons?.length ?? 0) > 0 ? (
                    <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                      {selectedSignal.metadata?.invalidationReasons?.map((item, index) => (
                        <li key={`${selectedSignal.id}-invalidation-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('common.notAvailable')}</div>
                  )}
                </div>
              </div>

              {(selectedSignal.metadata?.news?.results?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t('trading.signals.detail.newsTitle')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('trading.signals.detail.newsQuery')}: {selectedSignal.metadata?.news?.query}
                  </div>
                  <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                    {selectedSignal.metadata?.news?.results.map((item) => (
                      <li key={`${selectedSignal.id}-news-${item.url}`}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline"
                        >
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                selectedSignal.metadata?.dataSources?.news ? (
                  <div className="text-sm text-muted-foreground">
                    {t('trading.signals.detail.newsEmpty')}
                  </div>
                ) : null
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">{t('trading.signals.detail.empty')}</div>
          )}
        </CardContent>
      </Card>

      {isLoadingSignals ? (
        <Skeleton className="h-64" />
      ) : signals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Brain className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('trading.signals.noSignals')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('trading.signals.table.type')}</TableHead>
                <TableHead>{t('trading.signals.table.symbol')}</TableHead>
                <TableHead>{t('trading.signals.table.market')}</TableHead>
                <TableHead>{t('trading.signals.table.confidence')}</TableHead>
                <TableHead>{t('trading.signals.table.validation')}</TableHead>
                <TableHead>{t('trading.signals.table.source')}</TableHead>
                <TableHead>{t('trading.signals.table.reasoning')}</TableHead>
                <TableHead>{t('trading.signals.table.created')}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map((signal) => {
                const isSelected = signal.id === selectedSignalId;
                return (
                  <TableRow
                    key={signal.id}
                    data-testid={`row-signal-${signal.id}`}
                    className={isSelected ? 'bg-muted/50' : undefined}
                    onClick={() => onSelectSignal(signal.id)}
                  >
                    <TableCell>{renderSignalTypeBadge(signal.signalType)}</TableCell>
                    <TableCell>{signal.symbol}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`trading.marketType.${signal.marketType}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.max(0, Math.min(1, signal.confidence)) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm">{(Math.max(0, Math.min(1, signal.confidence)) * 100).toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {signal.metadata?.validationStatus
                          ? t(`trading.signals.validation.${signal.metadata.validationStatus}`)
                          : t('common.notAvailable')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {signal.metadata?.generationSource
                          ? t(`trading.signals.source.${signal.metadata.generationSource}`)
                          : (signal.sourceModel || t('common.notAvailable'))}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">{signal.reasoning || '-'}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px]">
                          <p>{signal.reasoning || t('trading.signals.noReasoning')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateTime(signal.criadoEm, { locale, timeZone })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeactivateSignal(signal.id);
                        }}
                        data-testid={`button-deactivate-signal-${signal.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <SignalApprovalPanel marketType={marketType} />
    </>
  );
}

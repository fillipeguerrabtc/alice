import { Layers, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WiseCatalogTabContentProps } from './wise-catalog-tab-types';

type WiseCatalogExecutionPanelProps = Pick<
  WiseCatalogTabContentProps,
  | 'catalogBody'
  | 'catalogError'
  | 'catalogLoading'
  | 'catalogOperation'
  | 'catalogResponse'
  | 'onRunCatalogOperation'
  | 'setCatalogBody'
  | 't'
>;

export function WiseCatalogExecutionPanel({
  catalogBody,
  catalogError,
  catalogLoading,
  catalogOperation,
  catalogResponse,
  onRunCatalogOperation,
  setCatalogBody,
  t,
}: WiseCatalogExecutionPanelProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>{t('wise.catalog.payload')}</Label>
        <Textarea
          value={catalogBody}
          onChange={(event) => setCatalogBody(event.target.value)}
          placeholder="{ }"
          rows={10}
          data-testid="textarea-catalog-payload"
        />
        <p className="text-xs text-muted-foreground">{t('wise.catalog.payloadHint')}</p>
      </div>

      <div className="flex justify-between items-center gap-4">
        <Button onClick={onRunCatalogOperation} disabled={catalogLoading} data-testid="button-catalog-run">
          {catalogLoading ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Layers className="h-4 w-4 mr-2" />
          )}
          {t('wise.catalog.run')}
        </Button>
        {catalogOperation.method && (
          <Badge variant="outline">{catalogOperation.method}</Badge>
        )}
      </div>

      {catalogError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-semibold text-destructive">{t('wise.catalog.errors.title')}</p>
          <p className="text-destructive">{catalogError}</p>
        </div>
      )}

      <div className="space-y-2">
        <Label>{t('wise.catalog.response')}</Label>
        <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-4 text-xs">
          {catalogResponse ?? t('wise.catalog.responseEmpty')}
        </pre>
      </div>
    </>
  );
}

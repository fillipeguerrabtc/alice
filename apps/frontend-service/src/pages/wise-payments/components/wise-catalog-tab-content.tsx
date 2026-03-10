import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseCatalogExecutionPanel } from './wise-catalog-execution-panel';
import { WiseCatalogOperationConfig } from './wise-catalog-operation-config';
import { WiseCatalogParamsFields } from './wise-catalog-params-fields';
import type { WiseCatalogTabContentProps } from './wise-catalog-tab-types';

export function WiseCatalogTabContent({
  catalogBody,
  catalogEndpoint,
  catalogError,
  catalogLoading,
  catalogOperation,
  catalogOperationId,
  catalogParams,
  catalogResponse,
  onRunCatalogOperation,
  setCatalogBody,
  setCatalogEndpoint,
  setCatalogOperationId,
  setCatalogParams,
  t,
  wiseCatalogOperations,
}: WiseCatalogTabContentProps) {
  return (
    <TabsContent value="catalog" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('wise.catalog.title')}</CardTitle>
          <CardDescription>{t('wise.catalog.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WiseCatalogOperationConfig
            catalogEndpoint={catalogEndpoint}
            catalogOperation={catalogOperation}
            catalogOperationId={catalogOperationId}
            setCatalogEndpoint={setCatalogEndpoint}
            setCatalogOperationId={setCatalogOperationId}
            t={t}
            wiseCatalogOperations={wiseCatalogOperations}
          />

          <WiseCatalogParamsFields
            catalogOperation={catalogOperation}
            catalogParams={catalogParams}
            setCatalogParams={setCatalogParams}
            t={t}
          />

          <WiseCatalogExecutionPanel
            catalogBody={catalogBody}
            catalogError={catalogError}
            catalogLoading={catalogLoading}
            catalogOperation={catalogOperation}
            catalogResponse={catalogResponse}
            onRunCatalogOperation={onRunCatalogOperation}
            setCatalogBody={setCatalogBody}
            t={t}
          />
        </CardContent>
      </Card>
    </TabsContent>
  );
}

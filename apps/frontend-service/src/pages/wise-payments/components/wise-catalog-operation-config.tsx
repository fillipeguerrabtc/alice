import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseCatalogTabContentProps } from './wise-catalog-tab-types';

type WiseCatalogOperationConfigProps = Pick<
  WiseCatalogTabContentProps,
  | 'catalogEndpoint'
  | 'catalogOperation'
  | 'catalogOperationId'
  | 'setCatalogEndpoint'
  | 'setCatalogOperationId'
  | 't'
  | 'wiseCatalogOperations'
>;

export function WiseCatalogOperationConfig({
  catalogEndpoint,
  catalogOperation,
  catalogOperationId,
  setCatalogEndpoint,
  setCatalogOperationId,
  t,
  wiseCatalogOperations,
}: WiseCatalogOperationConfigProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t('wise.catalog.operation')}</Label>
        <Select value={catalogOperationId} onValueChange={setCatalogOperationId}>
          <SelectTrigger data-testid="select-catalog-operation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {wiseCatalogOperations.map((operation) => (
              <SelectItem key={operation.id} value={operation.id}>
                {t(operation.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t(catalogOperation.descriptionKey)}</p>
      </div>
      {catalogOperation.id === 'custom' && (
        <div className="space-y-2">
          <Label>{t('wise.catalog.endpoint')}</Label>
          <Input
            value={catalogEndpoint}
            onChange={(event) => setCatalogEndpoint(event.target.value)}
            placeholder="/api/integrations/wise/..."
            data-testid="input-catalog-endpoint"
          />
        </div>
      )}
    </div>
  );
}

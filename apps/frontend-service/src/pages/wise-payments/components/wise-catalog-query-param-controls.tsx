import type { TFunction } from 'i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseCatalogParams } from '../wise-catalog-types';

type WiseCatalogQueryParamControlsProps = {
  showApplication: boolean;
  catalogParams: WiseCatalogParams;
  setCatalogParams: (updater: (prev: WiseCatalogParams) => WiseCatalogParams) => void;
  t: TFunction;
};

export function WiseCatalogQueryParamControls({
  showApplication,
  catalogParams,
  setCatalogParams,
  t,
}: WiseCatalogQueryParamControlsProps) {
  if (!showApplication) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label>{t('wise.catalog.application')}</Label>
      <Select
        value={catalogParams.application}
        onValueChange={(value) => setCatalogParams((prev) => ({ ...prev, application: value }))}
      >
        <SelectTrigger data-testid="select-catalog-application">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="false">{t('common.no')}</SelectItem>
          <SelectItem value="true">{t('common.yes')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

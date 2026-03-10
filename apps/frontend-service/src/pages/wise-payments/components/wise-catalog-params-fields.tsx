import { WiseCatalogPathParamInputs } from './wise-catalog-path-param-inputs';
import { WiseCatalogQueryParamControls } from './wise-catalog-query-param-controls';
import type { WiseCatalogTabContentProps } from './wise-catalog-tab-types';

type WiseCatalogParamsFieldsProps = Pick<
  WiseCatalogTabContentProps,
  | 'catalogOperation'
  | 'catalogParams'
  | 'setCatalogParams'
  | 't'
>;

export function WiseCatalogParamsFields({
  catalogOperation,
  catalogParams,
  setCatalogParams,
  t,
}: WiseCatalogParamsFieldsProps) {
  const pathParamKeys = catalogOperation.pathParams ?? [];
  const profileIdIsRequired =
    catalogOperation.pathParams?.includes('profileId') ||
    catalogOperation.queryParams?.includes('profileId');
  const activeInputKeys = profileIdIsRequired
    ? (['profileId', ...pathParamKeys.filter((key) => key !== 'profileId')] as const)
    : pathParamKeys;
  const showApplicationParam = Boolean(catalogOperation.queryParams?.includes('application'));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <WiseCatalogPathParamInputs
        activeKeys={[...activeInputKeys]}
        catalogParams={catalogParams}
        setCatalogParams={setCatalogParams}
        t={t}
      />

      <WiseCatalogQueryParamControls
        showApplication={showApplicationParam}
        catalogParams={catalogParams}
        setCatalogParams={setCatalogParams}
        t={t}
      />
    </div>
  );
}

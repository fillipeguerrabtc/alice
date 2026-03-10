import type { TFunction } from 'i18next';
import type { WiseCatalogOperation, WiseCatalogParams } from '../wise-catalog-types';

export type WiseCatalogTabContentProps = {
  catalogBody: string;
  catalogEndpoint: string;
  catalogError: string | null;
  catalogLoading: boolean;
  catalogOperation: WiseCatalogOperation;
  catalogOperationId: string;
  catalogParams: WiseCatalogParams;
  catalogResponse: string | null;
  onRunCatalogOperation: () => void;
  setCatalogBody: (value: string) => void;
  setCatalogEndpoint: (value: string) => void;
  setCatalogOperationId: (value: string) => void;
  setCatalogParams: (updater: (prev: WiseCatalogParams) => WiseCatalogParams) => void;
  t: TFunction;
  wiseCatalogOperations: WiseCatalogOperation[];
};

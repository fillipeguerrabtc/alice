import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type {
  WiseCatalogOperation,
  WiseCatalogParamKey,
  WiseCatalogParams,
} from './wise-payments-constants';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type UseWiseCatalogWorkbenchOptions = {
  notify: NotifyFn;
  operations: WiseCatalogOperation[];
  profileIdDefault?: string | null;
  t: TFunction;
};

type UseWiseCatalogWorkbenchResult = {
  catalogBody: string;
  catalogEndpoint: string;
  catalogError: string | null;
  catalogLoading: boolean;
  catalogOperation: WiseCatalogOperation;
  catalogOperationId: string;
  catalogParams: WiseCatalogParams;
  catalogResponse: string | null;
  handleRunCatalogOperation: () => Promise<void>;
  setCatalogBody: (value: string) => void;
  setCatalogEndpoint: (value: string) => void;
  setCatalogOperationId: (value: string) => void;
  setCatalogParams: Dispatch<SetStateAction<WiseCatalogParams>>;
};

const EMPTY_CATALOG_OPERATION: WiseCatalogOperation = {
  descriptionKey: '',
  id: 'custom',
  labelKey: '',
  method: 'POST',
  pathTemplate: '',
};

const INITIAL_CATALOG_PARAMS: WiseCatalogParams = {
  action: '',
  application: 'false',
  cardToken: '',
  disputeId: '',
  kycReviewId: '',
  profileId: '',
  ruleId: '',
  subscriptionId: '',
  transferId: '',
};

export function useWiseCatalogWorkbench(
  options: UseWiseCatalogWorkbenchOptions,
): UseWiseCatalogWorkbenchResult {
  const { notify, operations, profileIdDefault, t } = options;
  const [catalogOperationId, setCatalogOperationId] = useState(operations[0]?.id ?? 'listProfiles');
  const [catalogEndpoint, setCatalogEndpoint] = useState('');
  const [catalogBody, setCatalogBody] = useState(operations[0]?.bodyDefault ?? '');
  const [catalogParams, setCatalogParams] = useState<WiseCatalogParams>(INITIAL_CATALOG_PARAMS);
  const [catalogResponse, setCatalogResponse] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const catalogOperation = useMemo(
    () => operations.find((operation) => operation.id === catalogOperationId) ?? operations[0] ?? EMPTY_CATALOG_OPERATION,
    [catalogOperationId, operations],
  );

  useEffect(() => {
    const defaultBody = catalogOperation?.bodyDefault ?? '';
    setCatalogBody(defaultBody);
    setCatalogError(null);
    setCatalogResponse(null);
  }, [catalogOperation?.bodyDefault, catalogOperation?.id]);

  useEffect(() => {
    if (profileIdDefault && !catalogParams.profileId) {
      setCatalogParams((previous) => ({
        ...previous,
        profileId: profileIdDefault,
      }));
    }
  }, [catalogParams.profileId, profileIdDefault]);

  const handleRunCatalogOperation = useCallback(async () => {
    if (!catalogOperation) {
      return;
    }

    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogResponse(null);

    try {
      let path = catalogOperation.pathTemplate || catalogEndpoint.trim();
      if (!path) {
        throw new Error(t('wise.catalog.errors.missingEndpoint'));
      }

      const paramValues: Record<WiseCatalogParamKey, string> = {
        action: catalogParams.action,
        cardToken: catalogParams.cardToken,
        disputeId: catalogParams.disputeId,
        kycReviewId: catalogParams.kycReviewId,
        profileId: catalogParams.profileId,
        ruleId: catalogParams.ruleId,
        subscriptionId: catalogParams.subscriptionId,
        transferId: catalogParams.transferId,
      };

      (catalogOperation.pathParams ?? []).forEach((param) => {
        const value = paramValues[param]?.trim();
        if (!value) {
          throw new Error(t('wise.catalog.errors.missingParam', { param }));
        }
        path = path.replace(`:${param}`, encodeURIComponent(value));
      });

      const query = new URLSearchParams();
      if (catalogOperation.queryParams?.includes('profileId')) {
        const profileId = catalogParams.profileId.trim();
        if (!profileId) {
          throw new Error(t('wise.catalog.errors.missingProfileId'));
        }
        query.set('profileId', profileId);
      }
      if (catalogOperation.queryParams?.includes('application')) {
        query.set('application', catalogParams.application === 'true' ? 'true' : 'false');
      }

      const url = query.toString() ? `${path}?${query.toString()}` : path;
      let payload: Record<string, unknown> | undefined;
      if (!['GET', 'DELETE'].includes(catalogOperation.method)) {
        const bodyText = catalogBody.trim();
        if (bodyText) {
          payload = JSON.parse(bodyText) as Record<string, unknown>;
        }
      }

      const response = await apiRequest(catalogOperation.method, url, payload);
      const data = response.status === 204 ? {} : await response.json();
      setCatalogResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('wise.catalog.errors.generic');
      setCatalogError(message);
      notify({
        title: t('wise.catalog.errors.title'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogBody, catalogEndpoint, catalogOperation, catalogParams, notify, t]);

  return {
    catalogBody,
    catalogEndpoint,
    catalogError,
    catalogLoading,
    catalogOperation,
    catalogOperationId,
    catalogParams,
    catalogResponse,
    handleRunCatalogOperation,
    setCatalogBody,
    setCatalogEndpoint,
    setCatalogOperationId,
    setCatalogParams,
  };
}

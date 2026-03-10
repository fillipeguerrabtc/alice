import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { JsonParser, NotifyFn } from './wise-transfer-and-card-types';

type UseWiseCardPermissionSecureOperationsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  t: TFunction;
  cardPermissionToken: string;
  cardPermissionPayload: string;
  cardPermissionsPayload: string;
  cardSecureToken: string;
  cardSecurePayload: string;
  cardSecurePinPayload: string;
  setCardPermissionResult: (value: string | null) => void;
  setCardPermissionsResult: (value: string | null) => void;
  setCardSecureKeyResult: (value: string | null) => void;
  setCardSecureDetailsResult: (value: string | null) => void;
  setCardSecurePinResult: (value: string | null) => void;
};

export function useWiseCardPermissionSecureOperations(
  options: UseWiseCardPermissionSecureOperationsOptions
) {
  const {
    notify,
    parseJsonSafe,
    profileFilter,
    t,
    cardPermissionToken,
    cardPermissionPayload,
    cardPermissionsPayload,
    cardSecureToken,
    cardSecurePayload,
    cardSecurePinPayload,
    setCardPermissionResult,
    setCardPermissionsResult,
    setCardSecureKeyResult,
    setCardSecureDetailsResult,
    setCardSecurePinResult,
  } = options;

  const handleFetchCardPermissions = useCallback(async () => {
    const token = cardPermissionToken.trim();
    if (!profileFilter || !token) {
      notify({ title: t('wise.cards.permissionsMissing'), variant: 'destructive' });
      return;
    }

    try {
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/cards/${encodeURIComponent(token)}/permissions?profileId=${encodeURIComponent(profileFilter)}`
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardPermissionResult(JSON.stringify(data.permissions ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [cardPermissionToken, notify, profileFilter, setCardPermissionResult, t]);

  const handleUpdateCardPermissions = useCallback(async () => {
    const token = cardPermissionToken.trim();
    if (!profileFilter || !token) {
      notify({ title: t('wise.cards.permissionsMissing'), variant: 'destructive' });
      return;
    }

    const body = parseJsonSafe(cardPermissionPayload, t('wise.errors.invalidJson'));
    if (!body) {
      return;
    }

    try {
      const response = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/${encodeURIComponent(token)}/permissions?profileId=${encodeURIComponent(profileFilter)}`,
        body
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardPermissionResult(JSON.stringify(data.permissions ?? data, null, 2));
      notify({ title: t('wise.cards.permissionsUpdated') });
    } catch {
      notify({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  }, [
    cardPermissionPayload,
    cardPermissionToken,
    notify,
    parseJsonSafe,
    profileFilter,
    setCardPermissionResult,
    t,
  ]);

  const handleUpdateCardPermissionsBulk = useCallback(async () => {
    if (!profileFilter) {
      notify({
        title: t('wise.cards.permissionsMissingProfile'),
        variant: 'destructive',
      });
      return;
    }

    const body = parseJsonSafe(cardPermissionsPayload, t('wise.errors.invalidJson'));
    if (!body) {
      return;
    }

    try {
      const response = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/permissions?profileId=${encodeURIComponent(profileFilter)}`,
        body
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardPermissionsResult(JSON.stringify(data.result ?? data, null, 2));
      notify({ title: t('wise.cards.permissionsUpdated') });
    } catch {
      notify({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  }, [
    cardPermissionsPayload,
    notify,
    parseJsonSafe,
    profileFilter,
    setCardPermissionsResult,
    t,
  ]);

  const handleFetchCardSecureKey = useCallback(async () => {
    try {
      const response = await apiRequest(
        'GET',
        '/api/integrations/wise/cards/secure/encryption-key'
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardSecureKeyResult(JSON.stringify(data.key ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [notify, setCardSecureKeyResult, t]);

  const handleFetchCardSecureDetails = useCallback(async () => {
    const token = cardSecureToken.trim();
    if (!token) {
      notify({ title: t('wise.cards.secureMissingToken'), variant: 'destructive' });
      return;
    }

    const body = parseJsonSafe(cardSecurePayload, t('wise.errors.invalidJson'));
    if (!body) {
      return;
    }

    try {
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/cards/secure/details?cardToken=${encodeURIComponent(token)}`,
        body
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardSecureDetailsResult(JSON.stringify(data.details ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [
    cardSecurePayload,
    cardSecureToken,
    notify,
    parseJsonSafe,
    setCardSecureDetailsResult,
    t,
  ]);

  const handleFetchCardSecurePin = useCallback(async () => {
    const token = cardSecureToken.trim();
    if (!token) {
      notify({ title: t('wise.cards.secureMissingToken'), variant: 'destructive' });
      return;
    }

    const body = parseJsonSafe(cardSecurePinPayload, t('wise.errors.invalidJson'));
    if (!body) {
      return;
    }

    try {
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/cards/secure/pin?cardToken=${encodeURIComponent(token)}`,
        body
      );
      const data = (await response.json()) as Record<string, unknown>;
      setCardSecurePinResult(JSON.stringify(data.pin ?? data, null, 2));
    } catch {
      notify({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  }, [
    cardSecurePinPayload,
    cardSecureToken,
    notify,
    parseJsonSafe,
    setCardSecurePinResult,
    t,
  ]);

  return {
    handleFetchCardPermissions,
    handleUpdateCardPermissions,
    handleUpdateCardPermissionsBulk,
    handleFetchCardSecureKey,
    handleFetchCardSecureDetails,
    handleFetchCardSecurePin,
  };
}

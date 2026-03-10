import type { TFunction } from 'i18next';
import type { JsonParser, NotifyFn } from './wise-transfer-and-card-types';
import { useWiseCardPermissionSecureOperations } from './use-wise-card-permission-secure-operations';
import { useWiseTransferOperations } from './use-wise-transfer-operations';

type UseWiseTransferAndCardOperationsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  t: TFunction;
  transferActionId: string;
  cardPermissionToken: string;
  cardPermissionPayload: string;
  cardPermissionsPayload: string;
  cardSecureToken: string;
  cardSecurePayload: string;
  cardSecurePinPayload: string;
  setTransferActionResult: (value: string | null) => void;
  setCardPermissionResult: (value: string | null) => void;
  setCardPermissionsResult: (value: string | null) => void;
  setCardSecureKeyResult: (value: string | null) => void;
  setCardSecureDetailsResult: (value: string | null) => void;
  setCardSecurePinResult: (value: string | null) => void;
};

export function useWiseTransferAndCardOperations(
  options: UseWiseTransferAndCardOperationsOptions
) {
  const {
    notify,
    parseJsonSafe,
    profileFilter,
    t,
    transferActionId,
    cardPermissionToken,
    cardPermissionPayload,
    cardPermissionsPayload,
    cardSecureToken,
    cardSecurePayload,
    cardSecurePinPayload,
    setTransferActionResult,
    setCardPermissionResult,
    setCardPermissionsResult,
    setCardSecureKeyResult,
    setCardSecureDetailsResult,
    setCardSecurePinResult,
  } = options;

  const { handleFundTransfer, handleCancelTransfer } = useWiseTransferOperations({
    notify,
    setTransferActionResult,
    t,
    transferActionId,
  });

  const {
    handleFetchCardPermissions,
    handleUpdateCardPermissions,
    handleUpdateCardPermissionsBulk,
    handleFetchCardSecureKey,
    handleFetchCardSecureDetails,
    handleFetchCardSecurePin,
  } = useWiseCardPermissionSecureOperations({
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
  });

  return {
    handleFundTransfer,
    handleCancelTransfer,
    handleFetchCardPermissions,
    handleUpdateCardPermissions,
    handleUpdateCardPermissionsBulk,
    handleFetchCardSecureKey,
    handleFetchCardSecureDetails,
    handleFetchCardSecurePin,
  };
}

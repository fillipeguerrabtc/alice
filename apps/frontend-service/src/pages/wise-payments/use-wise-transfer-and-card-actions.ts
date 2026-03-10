import { useState } from 'react';
import {
  type UseWiseTransferAndCardActionsOptions,
  type UseWiseTransferAndCardActionsResult,
} from './wise-transfer-and-card-types';
import { useWiseTransferAndCardOperations } from './use-wise-transfer-and-card-operations';

export function useWiseTransferAndCardActions(
  options: UseWiseTransferAndCardActionsOptions
): UseWiseTransferAndCardActionsResult {
  const { notify, parseJsonSafe, profileFilter, t } = options;
  const [transferActionId, setTransferActionId] = useState('');
  const [transferActionResult, setTransferActionResult] = useState<string | null>(
    null
  );
  const [cardPermissionToken, setCardPermissionToken] = useState('');
  const [cardPermissionPayload, setCardPermissionPayload] = useState('');
  const [cardPermissionResult, setCardPermissionResult] = useState<string | null>(
    null
  );
  const [cardPermissionsPayload, setCardPermissionsPayload] = useState('');
  const [cardPermissionsResult, setCardPermissionsResult] = useState<
    string | null
  >(null);
  const [cardSecureToken, setCardSecureToken] = useState('');
  const [cardSecurePayload, setCardSecurePayload] = useState('');
  const [cardSecurePinPayload, setCardSecurePinPayload] = useState('');
  const [cardSecureKeyResult, setCardSecureKeyResult] = useState<string | null>(
    null
  );
  const [cardSecureDetailsResult, setCardSecureDetailsResult] = useState<
    string | null
  >(null);
  const [cardSecurePinResult, setCardSecurePinResult] = useState<string | null>(
    null
  );

  const {
    handleFundTransfer,
    handleCancelTransfer,
    handleFetchCardPermissions,
    handleUpdateCardPermissions,
    handleUpdateCardPermissionsBulk,
    handleFetchCardSecureKey,
    handleFetchCardSecureDetails,
    handleFetchCardSecurePin,
  } = useWiseTransferAndCardOperations({
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
  });

  return {
    cardPermissionPayload,
    cardPermissionResult,
    cardPermissionToken,
    cardPermissionsPayload,
    cardPermissionsResult,
    cardSecureDetailsResult,
    cardSecureKeyResult,
    cardSecurePayload,
    cardSecurePinPayload,
    cardSecurePinResult,
    cardSecureToken,
    handleCancelTransfer,
    handleFetchCardPermissions,
    handleFetchCardSecureDetails,
    handleFetchCardSecureKey,
    handleFetchCardSecurePin,
    handleFundTransfer,
    handleUpdateCardPermissions,
    handleUpdateCardPermissionsBulk,
    setCardPermissionPayload,
    setCardPermissionToken,
    setCardPermissionsPayload,
    setCardSecurePayload,
    setCardSecurePinPayload,
    setCardSecureToken,
    setTransferActionId,
    transferActionId,
    transferActionResult,
  };
}

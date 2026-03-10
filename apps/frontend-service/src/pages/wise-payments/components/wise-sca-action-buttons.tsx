import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';

type WiseScaActionButtonsProps = {
  onRunSca: (endpoint: string) => void;
  onRunScaDelete: (endpoint: string) => void;
  t: TFunction;
};

type WiseScaActionButton = {
  endpoint: string;
  labelKey: string;
  testId: string;
  variant?: 'default' | 'outline';
  method?: 'delete';
};

const SCA_ACTION_BUTTONS: WiseScaActionButton[] = [
  { endpoint: 'one-time-token', labelKey: 'wise.sca.oneTimeToken', testId: 'button-sca-ott' },
  { endpoint: 'sca/sessions', labelKey: 'wise.sca.sessions', testId: 'button-sca-sessions' },
  { endpoint: 'sca/pin', labelKey: 'wise.sca.pin', testId: 'button-sca-pin' },
  { endpoint: 'sca/pin/verify', labelKey: 'wise.sca.pinVerify', testId: 'button-sca-pin-verify' },
  {
    endpoint: 'sca/pin',
    labelKey: 'wise.sca.pinDelete',
    testId: 'button-sca-pin-delete',
    method: 'delete',
    variant: 'outline',
  },
  { endpoint: 'sca/device-fingerprint', labelKey: 'wise.sca.device', testId: 'button-sca-device' },
  {
    endpoint: 'sca/device-fingerprint/verify',
    labelKey: 'wise.sca.deviceVerify',
    testId: 'button-sca-device-verify',
  },
  {
    endpoint: 'sca/device-fingerprint',
    labelKey: 'wise.sca.deviceDelete',
    testId: 'button-sca-device-delete',
    method: 'delete',
    variant: 'outline',
  },
  { endpoint: 'sca/facemap', labelKey: 'wise.sca.facemap', testId: 'button-sca-facemap' },
  {
    endpoint: 'sca/facemap/verify',
    labelKey: 'wise.sca.facemapVerify',
    testId: 'button-sca-facemap-verify',
  },
  {
    endpoint: 'sca/facemap',
    labelKey: 'wise.sca.facemapDelete',
    testId: 'button-sca-facemap-delete',
    method: 'delete',
    variant: 'outline',
  },
];

export function WiseScaActionButtons({
  onRunSca,
  onRunScaDelete,
  t,
}: WiseScaActionButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SCA_ACTION_BUTTONS.map((action) => (
        <Button
          key={action.testId}
          variant={action.variant ?? 'default'}
          onClick={() => {
            if (action.method === 'delete') {
              onRunScaDelete(action.endpoint);
              return;
            }
            onRunSca(action.endpoint);
          }}
          data-testid={action.testId}
        >
          {t(action.labelKey)}
        </Button>
      ))}
    </div>
  );
}

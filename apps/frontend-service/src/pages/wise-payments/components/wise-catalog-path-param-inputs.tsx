import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WiseCatalogParamKey, WiseCatalogParams } from '../wise-catalog-types';

type WiseCatalogPathParamInputsProps = {
  activeKeys: Array<WiseCatalogParamKey | 'profileId'>;
  catalogParams: WiseCatalogParams;
  setCatalogParams: (updater: (prev: WiseCatalogParams) => WiseCatalogParams) => void;
  t: TFunction;
};

type WiseCatalogParamFieldConfig = {
  labelKey: string;
  placeholder: string;
  testId: string;
};

const CATALOG_PARAM_FIELD_CONFIG: Record<WiseCatalogParamKey | 'profileId', WiseCatalogParamFieldConfig> = {
  profileId: {
    labelKey: 'wise.catalog.profileId',
    placeholder: '123456',
    testId: 'input-catalog-profile-id',
  },
  cardToken: {
    labelKey: 'wise.catalog.cardToken',
    placeholder: 'card_token',
    testId: 'input-catalog-card-token',
  },
  disputeId: {
    labelKey: 'wise.catalog.disputeId',
    placeholder: 'dispute_id',
    testId: 'input-catalog-dispute-id',
  },
  transferId: {
    labelKey: 'wise.catalog.transferId',
    placeholder: 'transfer_id',
    testId: 'input-catalog-transfer-id',
  },
  kycReviewId: {
    labelKey: 'wise.catalog.kycReviewId',
    placeholder: 'kyc_review_id',
    testId: 'input-catalog-kyc-review-id',
  },
  subscriptionId: {
    labelKey: 'wise.catalog.subscriptionId',
    placeholder: 'subscription_id',
    testId: 'input-catalog-subscription-id',
  },
  action: {
    labelKey: 'wise.catalog.action',
    placeholder: 'execute',
    testId: 'input-catalog-action',
  },
  ruleId: {
    labelKey: 'wise.catalog.ruleId',
    placeholder: 'rule_id',
    testId: 'input-catalog-rule-id',
  },
};

export function WiseCatalogPathParamInputs({
  activeKeys,
  catalogParams,
  setCatalogParams,
  t,
}: WiseCatalogPathParamInputsProps) {
  return (
    <>
      {activeKeys.map((key) => {
        const config = CATALOG_PARAM_FIELD_CONFIG[key];
        return (
          <div key={key} className="space-y-2">
            <Label>{t(config.labelKey)}</Label>
            <Input
              value={catalogParams[key]}
              onChange={(event) => setCatalogParams((prev) => ({ ...prev, [key]: event.target.value }))}
              placeholder={config.placeholder}
              data-testid={config.testId}
            />
          </div>
        );
      })}
    </>
  );
}

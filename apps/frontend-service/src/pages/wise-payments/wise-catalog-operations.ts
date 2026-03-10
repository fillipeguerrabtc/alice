export type WiseCatalogParamKey =
  | 'profileId'
  | 'cardToken'
  | 'disputeId'
  | 'transferId'
  | 'kycReviewId'
  | 'subscriptionId'
  | 'action'
  | 'ruleId';

export type WiseCatalogQueryParamKey = 'profileId' | 'application';

export interface WiseCatalogOperation {
  id: string;
  labelKey: string;
  descriptionKey: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pathTemplate: string;
  pathParams?: WiseCatalogParamKey[];
  queryParams?: WiseCatalogQueryParamKey[];
  bodyDefault?: string;
}

export const WISE_CATALOG_OPERATIONS: WiseCatalogOperation[] = [
  {
    id: 'listProfiles',
    labelKey: 'wise.catalog.operations.listProfiles',
    descriptionKey: 'wise.catalog.operations.listProfilesDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/profiles',
  },
  {
    id: 'getProfile',
    labelKey: 'wise.catalog.operations.getProfile',
    descriptionKey: 'wise.catalog.operations.getProfileDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/profiles/:profileId',
    pathParams: ['profileId'],
  },
  {
    id: 'listCards',
    labelKey: 'wise.catalog.operations.listCards',
    descriptionKey: 'wise.catalog.operations.listCardsDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/cards',
    queryParams: ['profileId'],
  },
  {
    id: 'getCard',
    labelKey: 'wise.catalog.operations.getCard',
    descriptionKey: 'wise.catalog.operations.getCardDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/cards/:cardToken',
    pathParams: ['cardToken'],
    queryParams: ['profileId'],
  },
  {
    id: 'updateCardStatus',
    labelKey: 'wise.catalog.operations.updateCardStatus',
    descriptionKey: 'wise.catalog.operations.updateCardStatusDesc',
    method: 'PUT',
    pathTemplate: '/api/integrations/wise/cards/:cardToken/status',
    pathParams: ['cardToken'],
    queryParams: ['profileId'],
    bodyDefault: '',
  },
  {
    id: 'listSpendControls',
    labelKey: 'wise.catalog.operations.listSpendControls',
    descriptionKey: 'wise.catalog.operations.listSpendControlsDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/spend-controls',
    queryParams: ['profileId'],
  },
  {
    id: 'createSpendControl',
    labelKey: 'wise.catalog.operations.createSpendControl',
    descriptionKey: 'wise.catalog.operations.createSpendControlDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/spend-controls',
    queryParams: ['profileId'],
    bodyDefault: '',
  },
  {
    id: 'assignSpendControl',
    labelKey: 'wise.catalog.operations.assignSpendControl',
    descriptionKey: 'wise.catalog.operations.assignSpendControlDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/spend-controls/:ruleId/assign',
    pathParams: ['ruleId'],
    queryParams: ['profileId'],
    bodyDefault: '',
  },
  {
    id: 'listDisputes',
    labelKey: 'wise.catalog.operations.listDisputes',
    descriptionKey: 'wise.catalog.operations.listDisputesDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/disputes',
    queryParams: ['profileId'],
  },
  {
    id: 'getDispute',
    labelKey: 'wise.catalog.operations.getDispute',
    descriptionKey: 'wise.catalog.operations.getDisputeDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/disputes/:disputeId',
    pathParams: ['disputeId'],
    queryParams: ['profileId'],
  },
  {
    id: 'updateDisputeStatus',
    labelKey: 'wise.catalog.operations.updateDisputeStatus',
    descriptionKey: 'wise.catalog.operations.updateDisputeStatusDesc',
    method: 'PUT',
    pathTemplate: '/api/integrations/wise/disputes/:disputeId/status',
    pathParams: ['disputeId'],
    queryParams: ['profileId'],
    bodyDefault: '',
  },
  {
    id: 'listKycReviews',
    labelKey: 'wise.catalog.operations.listKycReviews',
    descriptionKey: 'wise.catalog.operations.listKycReviewsDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/kyc-reviews',
    queryParams: ['profileId'],
  },
  {
    id: 'getKycReview',
    labelKey: 'wise.catalog.operations.getKycReview',
    descriptionKey: 'wise.catalog.operations.getKycReviewDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/kyc-reviews/:kycReviewId',
    pathParams: ['kycReviewId'],
    queryParams: ['profileId'],
  },
  {
    id: 'scaOneTimeToken',
    labelKey: 'wise.catalog.operations.scaOneTimeToken',
    descriptionKey: 'wise.catalog.operations.scaOneTimeTokenDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/one-time-token',
    queryParams: ['profileId'],
  },
  {
    id: 'scaSession',
    labelKey: 'wise.catalog.operations.scaSession',
    descriptionKey: 'wise.catalog.operations.scaSessionDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/sca/sessions',
    queryParams: ['profileId'],
    bodyDefault: '',
  },
  {
    id: 'webhooksList',
    labelKey: 'wise.catalog.operations.webhooksList',
    descriptionKey: 'wise.catalog.operations.webhooksListDesc',
    method: 'GET',
    pathTemplate: '/api/integrations/wise/webhooks',
    queryParams: ['profileId', 'application'],
  },
  {
    id: 'webhooksCreate',
    labelKey: 'wise.catalog.operations.webhooksCreate',
    descriptionKey: 'wise.catalog.operations.webhooksCreateDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/webhooks',
    queryParams: ['profileId', 'application'],
    bodyDefault: '',
  },
  {
    id: 'simulationTransfer',
    labelKey: 'wise.catalog.operations.simulationTransfer',
    descriptionKey: 'wise.catalog.operations.simulationTransferDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/simulation/transfers/:transferId/:action',
    pathParams: ['transferId', 'action'],
  },
  {
    id: 'oauthExchangeAuthorization',
    labelKey: 'wise.catalog.operations.oauthExchangeAuthorization',
    descriptionKey: 'wise.catalog.operations.oauthExchangeAuthorizationDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/oauth/exchange-authorization-code',
    bodyDefault: '',
  },
  {
    id: 'oauthRefresh',
    labelKey: 'wise.catalog.operations.oauthRefresh',
    descriptionKey: 'wise.catalog.operations.oauthRefreshDesc',
    method: 'POST',
    pathTemplate: '/api/integrations/wise/oauth/refresh-user-token',
    bodyDefault: '',
  },
  {
    id: 'custom',
    labelKey: 'wise.catalog.operations.custom',
    descriptionKey: 'wise.catalog.operations.customDesc',
    method: 'POST',
    pathTemplate: '',
  },
];

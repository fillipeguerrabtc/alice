import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  Wallet,
  Send,
  Users,
  Calculator,
  Layers,
  History,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  ArrowLeftRight,
  FileText,
  Webhook,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ApiError, apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';

interface WiseBalance {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount?: {
    value: number;
    currency: string;
  };
  totalWorth?: {
    value: number;
    currency: string;
  };
}

interface WiseTransfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount: number;
  quote: number;
  status: string;
  reference: string;
  rate: number;
  created: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceValue: number;
  targetValue: number;
  customerTransactionId: string;
}

interface WiseProfile {
  id: number;
  type: string;
  details?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
}

interface WiseRecipient {
  id: number;
  business: number | null;
  profile: number;
  accountHolderName: string;
  type: string;
  country: string;
  currency: string;
  active: boolean;
}

interface WiseCard {
  cardToken: string;
  status: string;
  type?: string;
  profileId?: number;
  lastFourDigits?: string;
  expiryDate?: string;
  nameOnCard?: string;
}

interface WiseCardOrder {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
  cardType?: string;
}

interface WiseCardOrderAvailability {
  cardType?: string;
  available?: boolean;
  reasons?: string[];
}

interface WiseCardTransaction {
  id?: string;
  status?: string;
  amount?: { value: number; currency: string };
  created?: string;
}

interface WiseAccountDetail {
  id?: number;
  profileId?: number;
  currency?: string;
  accountHolderName?: string;
}

interface WiseSpendControl {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  maxAmount?: number;
  period?: string;
  cardToken?: string;
}

interface WiseDispute {
  id?: string;
  status?: string;
  reason?: string;
  scheme?: string;
  created?: string;
  updated?: string;
}

interface WiseKycReview {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
}

interface WiseQuote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fee: number;
  expirationTime: string | null;
  deliveryEstimate: string | null;
  formattedEstimatedDelivery: string | null;
}

interface WiseBatchGroup {
  id: string;
  name: string;
  status: string;
  sourceCurrency: string;
  version: number;
  created: string;
}

interface WiseBalanceStatement {
  type: string;
  amount: { value: number; currency: string };
  date: string;
  note?: string;
  totalFees?: { value: number; currency: string };
  reference?: string;
  runningBalance?: { value: number; currency: string };
}

interface WiseBalanceStatementResponse {
  accountId: number;
  currency: string;
  intervalStart: string;
  intervalEnd: string;
  transactions: WiseBalanceStatement[];
}

interface WiseStatus {
  configured: boolean;
  sandbox: boolean;
  profileId: string | null;
}

interface WiseBalancesResponse {
  balances: WiseBalance[];
  sandbox: boolean;
}

interface WiseTransfersResponse {
  transfers: WiseTransfer[];
}

interface WiseRecipientsResponse {
  recipients: WiseRecipient[];
}

interface WiseBatchGroupsResponse {
  batchGroups: WiseBatchGroup[];
}

interface WiseProfilesResponse {
  profiles: WiseProfile[];
}

interface WiseCardsResponse {
  cards: WiseCard[];
}

interface WiseCardOrdersResponse {
  orders: { content?: WiseCardOrder[] } & Record<string, unknown>;
}

interface WiseCardOrderAvailabilityResponse {
  availability: WiseCardOrderAvailability[];
}

interface WiseCardTransactionResponse {
  transaction: WiseCardTransaction;
}

interface WiseAccountDetailsResponse {
  details: WiseAccountDetail[];
}

interface WiseAccountDetailsOrdersResponse {
  orders: Record<string, unknown>[];
}

interface WiseSpendControlsResponse {
  rules: WiseSpendControl[];
}

interface WiseDisputesResponse {
  disputes: WiseDispute[];
}

interface WiseKycReviewsResponse {
  reviews: WiseKycReview[];
}

type WiseCatalogParamKey =
  | 'profileId'
  | 'cardToken'
  | 'disputeId'
  | 'transferId'
  | 'kycReviewId'
  | 'subscriptionId'
  | 'action'
  | 'ruleId';

interface WiseCatalogOperation {
  id: string;
  labelKey: string;
  descriptionKey: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pathTemplate: string;
  pathParams?: WiseCatalogParamKey[];
  queryParams?: Array<'profileId' | 'application'>;
  bodyDefault?: string;
}

const WISE_CATALOG_OPERATIONS: WiseCatalogOperation[] = [
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

const CURRENCIES = [
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
];

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'outgoing_payment_sent':
    case 'funds_converted':
      return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Completed</Badge>;
    case 'processing':
    case 'incoming_payment_waiting':
    case 'waiting_recipient_input_to_proceed':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Processing</Badge>;
    case 'cancelled':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Cancelled</Badge>;
    case 'failed':
    case 'bounced_back':
      return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function WisePayments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const [activeTab, setActiveTab] = useState('balances');
  const [quoteForm, setQuoteForm] = useState({
    sourceCurrency: 'EUR',
    targetCurrency: 'USD',
    sourceAmount: '',
  });
  const [exchangeForm, setExchangeForm] = useState({
    sourceCurrency: 'EUR',
    targetCurrency: 'USD',
    sourceAmount: '',
  });
  const [statementForm, setStatementForm] = useState({
    balanceId: '',
    currency: 'EUR',
    intervalStart: '',
    intervalEnd: '',
  });
  const [statementData, setStatementData] = useState<WiseBalanceStatementResponse | null>(null);
  const [showNewRecipientDialog, setShowNewRecipientDialog] = useState(false);
  const [showNewBalanceDialog, setShowNewBalanceDialog] = useState(false);
  const [newBalanceForm, setNewBalanceForm] = useState({
    currency: 'EUR',
    type: 'STANDARD' as 'STANDARD' | 'SAVINGS',
    name: '',
  });
  const [profileFilter, setProfileFilter] = useState('');
  const [cardStatusUpdates, setCardStatusUpdates] = useState<Record<string, string>>({});
  const [spendControlForm, setSpendControlForm] = useState({
    name: '',
    maxAmount: '',
    currency: '',
    period: '',
  });
  const [spendControlAssignment, setSpendControlAssignment] = useState({
    ruleId: '',
    cardToken: '',
  });
  const [spendControlDeleteId, setSpendControlDeleteId] = useState('');
  const [spendLimitsProfileId, setSpendLimitsProfileId] = useState('');
  const [spendLimitsPayload, setSpendLimitsPayload] = useState('');
  const [spendLimitsCardToken, setSpendLimitsCardToken] = useState('');
  const [spendLimitsCardPayload, setSpendLimitsCardPayload] = useState('');
  const [spendLimitsProfileResult, setSpendLimitsProfileResult] = useState<string | null>(null);
  const [spendLimitsCardResult, setSpendLimitsCardResult] = useState<string | null>(null);
  const [spendLimitsDeleteCardToken, setSpendLimitsDeleteCardToken] = useState('');
  const [balanceCapacityCurrency, setBalanceCapacityCurrency] = useState('');
  const [balanceCapacityResult, setBalanceCapacityResult] = useState<string | null>(null);
  const [totalFundsCurrency, setTotalFundsCurrency] = useState('');
  const [totalFundsResult, setTotalFundsResult] = useState<string | null>(null);
  const [ratesForm, setRatesForm] = useState({ sourceCurrency: '', targetCurrency: '' });
  const [ratesResult, setRatesResult] = useState<string | null>(null);
  const [recipientRequirementsForm, setRecipientRequirementsForm] = useState({
    sourceCurrency: '',
    targetCurrency: '',
    sourceAmount: '',
  });
  const [recipientRequirementsResult, setRecipientRequirementsResult] = useState<string | null>(null);
  const [transferActionId, setTransferActionId] = useState('');
  const [transferActionResult, setTransferActionResult] = useState<string | null>(null);
  const [cardPermissionToken, setCardPermissionToken] = useState('');
  const [cardPermissionPayload, setCardPermissionPayload] = useState('');
  const [cardPermissionResult, setCardPermissionResult] = useState<string | null>(null);
  const [cardPermissionsPayload, setCardPermissionsPayload] = useState('');
  const [cardPermissionsResult, setCardPermissionsResult] = useState<string | null>(null);
  const [cardSecureToken, setCardSecureToken] = useState('');
  const [cardSecurePayload, setCardSecurePayload] = useState('');
  const [cardSecurePinPayload, setCardSecurePinPayload] = useState('');
  const [cardSecureKeyResult, setCardSecureKeyResult] = useState<string | null>(null);
  const [cardSecureDetailsResult, setCardSecureDetailsResult] = useState<string | null>(null);
  const [cardSecurePinResult, setCardSecurePinResult] = useState<string | null>(null);
  const [wiseUserId, setWiseUserId] = useState('');
  const [wiseUserResult, setWiseUserResult] = useState<string | null>(null);
  const [activityFilters, setActivityFilters] = useState({
    profileId: '',
    status: '',
    monetaryResourceType: '',
    since: '',
    until: '',
    size: '',
  });
  const [activityResults, setActivityResults] = useState<string | null>(null);
  const [disputeStatusUpdate, setDisputeStatusUpdate] = useState({
    disputeId: '',
    status: '',
  });
  const [cardOrdersPage, setCardOrdersPage] = useState({ pageNumber: '1', pageSize: '10' });
  const [cardOrderId, setCardOrderId] = useState('');
  const [cardOrderPayload, setCardOrderPayload] = useState('');
  const [cardOrderStatusPayload, setCardOrderStatusPayload] = useState('');
  const [cardOrderValidationPayload, setCardOrderValidationPayload] = useState('');
  const [cardOrderPinPayload, setCardOrderPinPayload] = useState('');
  const [cardOrderAvailability, setCardOrderAvailability] = useState<string | null>(null);
  const [cardOrderDetails, setCardOrderDetails] = useState<string | null>(null);
  const [cardOrderRequirements, setCardOrderRequirements] = useState<string | null>(null);
  const [cardTransactionId, setCardTransactionId] = useState('');
  const [cardTransactionDetails, setCardTransactionDetails] = useState<string | null>(null);
  const [disputeFlowForm, setDisputeFlowForm] = useState({
    scheme: '',
    reason: '',
    transactionId: '',
    payload: '',
  });
  const [disputeFlowStepResult, setDisputeFlowStepResult] = useState<string | null>(null);
  const [disputeFlowSubmitResult, setDisputeFlowSubmitResult] = useState<string | null>(null);
  const [disputeUpload, setDisputeUpload] = useState({
    fileBase64: '',
    fileName: '',
    contentType: '',
  });
  const [kycRequiredEvidences, setKycRequiredEvidences] = useState<string | null>(null);
  const [kycUploadDocument, setKycUploadDocument] = useState({
    fileBase64: '',
    fileName: '',
    contentType: '',
  });
  const [kycUploadAdditional, setKycUploadAdditional] = useState({
    fileBase64: '',
    fileName: '',
    contentType: '',
  });
  const [webhookApplication, setWebhookApplication] = useState('false');
  const [webhookPayload, setWebhookPayload] = useState('');
  const [webhookDeleteId, setWebhookDeleteId] = useState('');
  const [webhookResponse, setWebhookResponse] = useState<string | null>(null);
  const [accountDetailsPayload, setAccountDetailsPayload] = useState('');
  const [accountDetailsResponse, setAccountDetailsResponse] = useState<string | null>(null);
  const [simulationOperation, setSimulationOperation] = useState('transferState');
  const [simulationTransfer, setSimulationTransfer] = useState({ transferId: '', action: '' });
  const [simulationCard, setSimulationCard] = useState({ cardToken: '', action: '' });
  const [simulationKyc, setSimulationKyc] = useState({ kycReviewId: '' });
  const [simulationPayload, setSimulationPayload] = useState('');
  const [simulationResponse, setSimulationResponse] = useState<string | null>(null);
  const [scaJosePayload, setScaJosePayload] = useState('');
  const [scaResponse, setScaResponse] = useState<string | null>(null);
  const [catalogOperationId, setCatalogOperationId] = useState(WISE_CATALOG_OPERATIONS[0]?.id ?? 'listProfiles');
  const [catalogEndpoint, setCatalogEndpoint] = useState('');
  const [catalogBody, setCatalogBody] = useState(WISE_CATALOG_OPERATIONS[0]?.bodyDefault ?? '');
  const [catalogParams, setCatalogParams] = useState({
    profileId: '',
    cardToken: '',
    disputeId: '',
    transferId: '',
    kycReviewId: '',
    subscriptionId: '',
    action: '',
    ruleId: '',
    application: 'false',
  });
  const [catalogResponse, setCatalogResponse] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [wiseBlockedUntil, setWiseBlockedUntil] = useState<number | null>(null);

  const catalogOperation = WISE_CATALOG_OPERATIONS.find((op) => op.id === catalogOperationId) ?? WISE_CATALOG_OPERATIONS[0];

  useEffect(() => {
    const defaultBody = catalogOperation?.bodyDefault ?? '';
    setCatalogBody(defaultBody);
    setCatalogError(null);
    setCatalogResponse(null);
  }, [catalogOperation?.id, catalogOperation?.bodyDefault]);

  const { data: statusData, isLoading: isLoadingStatus } = useQuery<WiseStatus>({
    queryKey: ['/api/integrations/wise/status'],
  });

  const isWiseBlocked = wiseBlockedUntil !== null && Date.now() < wiseBlockedUntil;
  const wiseQueryEnabled = Boolean(statusData?.configured) && !isWiseBlocked;

  const blockWiseRequests = useCallback((seconds: number, reason: string) => {
    const safeSeconds = Math.max(30, seconds);
    setWiseBlockedUntil(Date.now() + safeSeconds * 1000);
    toast({
      title: 'Wise temporariamente bloqueado',
      description: `${reason} Nova tentativa em ${safeSeconds}s.`,
      variant: 'destructive',
    });
  }, [toast]);

  const handleWiseQueryError = useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) {
      return;
    }

    if (error.status === 401) {
      blockWiseRequests(300, 'Token Wise inválido ou expirado.');
      return;
    }

    if (error.status === 429) {
      const retrySeconds = error.retryAfterSeconds ?? 120;
      blockWiseRequests(retrySeconds, 'Rate limit do Wise atingido.');
    }
  }, [blockWiseRequests]);

  useEffect(() => {
    if (!statusData?.configured) {
      setWiseBlockedUntil(null);
    }
  }, [statusData?.configured]);

  const { data: balancesData, isLoading: isLoadingBalances, refetch: refetchBalances, error: balancesError } = useQuery<WiseBalancesResponse>({
    queryKey: ['/api/integrations/wise/balances'],
    enabled: wiseQueryEnabled,
  });

  const { data: transfersData, isLoading: isLoadingTransfers, refetch: refetchTransfers, error: transfersError } = useQuery<WiseTransfersResponse>({
    queryKey: ['/api/integrations/wise/transfers'],
    enabled: wiseQueryEnabled,
  });

  const { data: recipientsData, isLoading: isLoadingRecipients, refetch: refetchRecipients, error: recipientsError } = useQuery<WiseRecipientsResponse>({
    queryKey: ['/api/integrations/wise/recipients'],
    enabled: wiseQueryEnabled,
  });

  useEffect(() => {
    if (statusData?.profileId && !catalogParams.profileId) {
      setCatalogParams((prev) => ({ ...prev, profileId: statusData.profileId ?? '' }));
    }
  }, [statusData?.profileId, catalogParams.profileId]);

  useEffect(() => {
    if (statusData?.profileId && !profileFilter) {
      setProfileFilter(statusData.profileId);
    }
  }, [statusData?.profileId, profileFilter]);

  useEffect(() => {
    if (!spendControlForm.currency && balancesData?.balances?.length) {
      const firstCurrency = balancesData.balances[0]?.currency;
      if (firstCurrency) {
        setSpendControlForm((prev) => ({ ...prev, currency: firstCurrency }));
      }
    }
  }, [balancesData?.balances, spendControlForm.currency]);

  const { data: batchGroupsData, isLoading: isLoadingBatchGroups, refetch: refetchBatchGroups, error: batchGroupsError } = useQuery<WiseBatchGroupsResponse>({
    queryKey: ['/api/integrations/wise/batch-groups'],
    enabled: wiseQueryEnabled,
  });

  const { data: profilesData, isLoading: isLoadingProfiles, refetch: refetchProfiles, error: profilesError } = useQuery<WiseProfilesResponse>({
    queryKey: ['/api/integrations/wise/profiles'],
    enabled: wiseQueryEnabled,
  });

  const { data: wiseUserMeData, isLoading: isLoadingWiseUserMe, refetch: refetchWiseUserMe, error: wiseUserMeError } = useQuery<{ user: Record<string, unknown> }>({
    queryKey: ['/api/integrations/wise/users/me'],
    enabled: wiseQueryEnabled,
  });

  const { data: cardsData, isLoading: isLoadingCards, refetch: refetchCards, error: cardsError } = useQuery<WiseCardsResponse>({
    queryKey: ['/api/integrations/wise/cards', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/cards?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseCardsResponse>;
    },
  });

  const { data: spendControlsData, isLoading: isLoadingSpendControls, refetch: refetchSpendControls, error: spendControlsError } = useQuery<WiseSpendControlsResponse>({
    queryKey: ['/api/integrations/wise/spend-controls', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/spend-controls?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseSpendControlsResponse>;
    },
  });

  const { data: disputesData, isLoading: isLoadingDisputes, refetch: refetchDisputes, error: disputesError } = useQuery<WiseDisputesResponse>({
    queryKey: ['/api/integrations/wise/disputes', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/disputes?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseDisputesResponse>;
    },
  });

  const { data: kycReviewsData, isLoading: isLoadingKycReviews, refetch: refetchKycReviews, error: kycReviewsError } = useQuery<WiseKycReviewsResponse>({
    queryKey: ['/api/integrations/wise/kyc-reviews', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/kyc-reviews?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseKycReviewsResponse>;
    },
  });

  const { data: cardOrdersData, isLoading: isLoadingCardOrders, refetch: refetchCardOrders, error: cardOrdersError } = useQuery<WiseCardOrdersResponse>({
    queryKey: ['/api/integrations/wise/card-orders', profileFilter, cardOrdersPage.pageNumber, cardOrdersPage.pageSize],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const params = new URLSearchParams({
        profileId: profileFilter,
        pageNumber: cardOrdersPage.pageNumber,
        pageSize: cardOrdersPage.pageSize,
      });
      const res = await apiRequest('GET', `/api/integrations/wise/card-orders?${params.toString()}`);
      return res.json() as Promise<WiseCardOrdersResponse>;
    },
  });

  const { data: disputeReasonsData, isLoading: isLoadingDisputeReasons, error: disputeReasonsError } = useQuery<{ reasons: Record<string, unknown> }>({
    queryKey: ['/api/integrations/wise/disputes/reasons', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/disputes/reasons?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<{ reasons: Record<string, unknown> }>;
    },
  });

  const { data: accountDetailsData, isLoading: isLoadingAccountDetails, refetch: refetchAccountDetails, error: accountDetailsError } = useQuery<WiseAccountDetailsResponse>({
    queryKey: ['/api/integrations/wise/account-details', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/account-details?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseAccountDetailsResponse>;
    },
  });

  const { data: accountDetailsOrdersData, isLoading: isLoadingAccountDetailsOrders, refetch: refetchAccountDetailsOrders, error: accountDetailsOrdersError } = useQuery<WiseAccountDetailsOrdersResponse>({
    queryKey: ['/api/integrations/wise/account-details/orders', profileFilter],
    enabled: wiseQueryEnabled && Boolean(profileFilter),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/wise/account-details/orders?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseAccountDetailsOrdersResponse>;
    },
  });

  useEffect(() => {
    const firstError = [
      balancesError,
      transfersError,
      recipientsError,
      batchGroupsError,
      profilesError,
      wiseUserMeError,
      cardsError,
      spendControlsError,
      disputesError,
      kycReviewsError,
      cardOrdersError,
      disputeReasonsError,
      accountDetailsError,
      accountDetailsOrdersError,
    ].find(Boolean);

    if (firstError) {
      handleWiseQueryError(firstError);
    }
  }, [
    balancesError,
    transfersError,
    recipientsError,
    batchGroupsError,
    profilesError,
    wiseUserMeError,
    cardsError,
    spendControlsError,
    disputesError,
    kycReviewsError,
    cardOrdersError,
    disputeReasonsError,
    accountDetailsError,
    accountDetailsOrdersError,
    handleWiseQueryError,
  ]);

  const createQuoteMutation = useMutation({
    mutationFn: async (data: { sourceCurrency: string; targetCurrency: string; sourceAmount: number }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/quotes', data);
      return res.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      toast({
        title: t('wise.success.quoteCreated'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: () => {
      toast({
        title: t('wise.errors.quoteFailed'),
        variant: 'destructive',
      });
    },
  });

  const createBalanceMutation = useMutation({
    mutationFn: async (payload: { currency: string; type: 'STANDARD' | 'SAVINGS'; name?: string }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balances', payload);
      return res.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      setShowNewBalanceDialog(false);
      setNewBalanceForm({ currency: 'EUR', type: 'STANDARD', name: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.balances.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.balanceCreateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteBalanceMutation = useMutation({
    mutationFn: async (balanceId: number) => {
      const res = await apiRequest('DELETE', `/api/integrations/wise/balances/${balanceId}`);
      return res.json() as Promise<{ balance: WiseBalance }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.balances.deleted') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.balanceDeleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateCardStatusMutation = useMutation({
    mutationFn: async (payload: { cardToken: string; status: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/${encodeURIComponent(payload.cardToken)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        { status: payload.status }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/cards', profileFilter] });
      toast({ title: t('wise.cards.updated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const createSpendControlMutation = useMutation({
    mutationFn: async (payload: { name: string; currency: string; maxAmount: number; period: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return res.json();
    },
    onSuccess: () => {
      setSpendControlForm({ name: '', currency: '', maxAmount: '', period: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/spend-controls', profileFilter] });
      toast({ title: t('wise.spendControls.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const assignSpendControlMutation = useMutation({
    mutationFn: async (payload: { ruleId: string; cardToken: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(payload.ruleId)}/assign?profileId=${encodeURIComponent(profileFilter)}`,
        { cardToken: payload.cardToken }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/spend-controls', profileFilter] });
      toast({ title: t('wise.spendControls.assigned') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteSpendControlMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'DELETE',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(ruleId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/spend-controls', profileFilter] });
      toast({ title: t('wise.spendControls.deleted') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const unassignSpendControlMutation = useMutation({
    mutationFn: async (payload: { ruleId: string; cardToken: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(payload.ruleId)}/unassign?profileId=${encodeURIComponent(profileFilter)}`,
        { cardToken: payload.cardToken }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/spend-controls', profileFilter] });
      toast({ title: t('wise.spendControls.unassigned') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getSpendLimitsProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await apiRequest('GET', `/api/integrations/wise/spend-limits/profile?profileId=${encodeURIComponent(profileId)}`);
      return res.json() as Promise<{ limits: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setSpendLimitsProfileResult(JSON.stringify(data.limits, null, 2));
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateSpendLimitsProfileMutation = useMutation({
    mutationFn: async (payload: { profileId: string; body: Record<string, unknown> }) => {
      const res = await apiRequest(
        'PATCH',
        `/api/integrations/wise/spend-limits/profile?profileId=${encodeURIComponent(payload.profileId)}`,
        payload.body
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.spendLimits.updated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: { profileId: string; cardToken: string }) => {
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`
      );
      return res.json() as Promise<{ limits: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setSpendLimitsCardResult(JSON.stringify(data.limits, null, 2));
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: { profileId: string; cardToken: string; body: Record<string, unknown> }) => {
      const res = await apiRequest(
        'PATCH',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`,
        payload.body
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.spendLimits.updated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: { profileId: string; cardToken: string }) => {
      const res = await apiRequest(
        'DELETE',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.spendLimits.deleted') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getWiseUserByIdMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('GET', `/api/integrations/wise/users/${encodeURIComponent(id)}`);
      return res.json() as Promise<{ user: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setWiseUserResult(JSON.stringify(data.user, null, 2));
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const listActivitiesMutation = useMutation({
    mutationFn: async (filters: typeof activityFilters) => {
      const params = new URLSearchParams();
      if (filters.profileId) params.set('profileId', filters.profileId);
      if (filters.monetaryResourceType) params.set('monetaryResourceType', filters.monetaryResourceType);
      if (filters.status) params.set('status', filters.status);
      if (filters.since) params.set('since', filters.since);
      if (filters.until) params.set('until', filters.until);
      if (filters.size) params.set('size', filters.size);
      const query = params.toString();
      const res = await apiRequest('GET', `/api/integrations/wise/activities${query ? `?${query}` : ''}`);
      return res.json() as Promise<{ activities: Array<Record<string, unknown>> }>;
    },
    onSuccess: (data) => {
      setActivityResults(JSON.stringify(data.activities, null, 2));
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateDisputeStatusMutation = useMutation({
    mutationFn: async (payload: { disputeId: string; status: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'PUT',
        `/api/integrations/wise/disputes/${encodeURIComponent(payload.disputeId)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        { status: payload.status }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/disputes', profileFilter] });
      toast({ title: t('wise.disputes.updated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const createCardOrderMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/card-orders?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/card-orders', profileFilter] });
      toast({ title: t('wise.cardOrders.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const createAccountDetailsOrderMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/account-details/orders?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return res.json();
    },
    onSuccess: (data) => {
      setAccountDetailsResponse(JSON.stringify(data, null, 2));
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/account-details/orders', profileFilter] });
      toast({ title: t('wise.accountDetails.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateCardOrderStatusMutation = useMutation({
    mutationFn: async (payload: { cardOrderId: string; body: Record<string, unknown> }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'PUT',
        `/api/integrations/wise/card-orders/${encodeURIComponent(payload.cardOrderId)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        payload.body
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/card-orders', profileFilter] });
      toast({ title: t('wise.cardOrders.updated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardOrderAvailabilityMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest('GET', `/api/integrations/wise/card-orders/availability?profileId=${encodeURIComponent(profileFilter)}`);
      return res.json() as Promise<WiseCardOrderAvailabilityResponse>;
    },
    onSuccess: (data) => {
      setCardOrderAvailability(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderAvailability(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardOrderDetailsMutation = useMutation({
    mutationFn: async (cardOrderId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/card-orders/${encodeURIComponent(cardOrderId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return res.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderDetails(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardOrderRequirementsMutation = useMutation({
    mutationFn: async (cardOrderId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/card-orders/${encodeURIComponent(cardOrderId)}/requirements?profileId=${encodeURIComponent(profileFilter)}`
      );
      return res.json();
    },
    onSuccess: (data) => {
      setCardOrderRequirements(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderRequirements(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const validateCardOrderAddressMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest('POST', '/api/integrations/wise/card-orders/validate-address', body);
      return res.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
      toast({ title: t('wise.cardOrders.addressValidated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const presetCardOrderPinMutation = useMutation({
    mutationFn: async (payload: { cardOrderId: string; body: Record<string, unknown> }) => {
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/card-orders/${encodeURIComponent(payload.cardOrderId)}/preset-pin`,
        payload.body
      );
      return res.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
      toast({ title: t('wise.cardOrders.pinUpdated') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardTransactionMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/cards/transactions/${encodeURIComponent(transactionId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return res.json() as Promise<WiseCardTransactionResponse>;
    },
    onSuccess: (data) => {
      setCardTransactionDetails(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardTransactionDetails(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const disputeFlowStepMutation = useMutation({
    mutationFn: async (payload: { scheme: string; reason: string; transactionId: string; body: Record<string, unknown> }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest('POST', '/api/integrations/wise/disputes/flow/step', {
        profileId: profileFilter,
        scheme: payload.scheme,
        reason: payload.reason,
        transactionId: payload.transactionId,
        payload: payload.body,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setDisputeFlowStepResult(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setDisputeFlowStepResult(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const disputeFlowSubmitMutation = useMutation({
    mutationFn: async (payload: { scheme: string; reason: string; transactionId: string; body: Record<string, unknown> }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest('POST', '/api/integrations/wise/disputes/flow/submit', {
        profileId: profileFilter,
        scheme: payload.scheme,
        reason: payload.reason,
        transactionId: payload.transactionId,
        payload: payload.body,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setDisputeFlowSubmitResult(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setDisputeFlowSubmitResult(null);
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadDisputeFileMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/disputes/upload?profileId=${encodeURIComponent(profileFilter)}`,
        disputeUpload
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.disputes.uploaded') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getKycRequiredEvidencesMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/verification/required-evidences?profileId=${encodeURIComponent(profileFilter)}`
      );
      return res.json();
    },
    onSuccess: (data) => {
      setKycRequiredEvidences(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setKycRequiredEvidences(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadKycDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/verification/upload-document?profileId=${encodeURIComponent(profileFilter)}`,
        kycUploadDocument
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.kyc.documentUploaded') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadKycAdditionalMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/verification/upload-evidences?profileId=${encodeURIComponent(profileFilter)}`,
        kycUploadAdditional
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('wise.kyc.additionalUploaded') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const listWebhooksMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const params = new URLSearchParams({
        profileId: profileFilter,
        application: webhookApplication,
      });
      const res = await apiRequest('GET', `/api/integrations/wise/webhooks?${params.toString()}`);
      return res.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setWebhookResponse(null);
      toast({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const createWebhookMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const params = new URLSearchParams({
        profileId: profileFilter,
        application: webhookApplication,
      });
      const res = await apiRequest('POST', `/api/integrations/wise/webhooks?${params.toString()}`, payload);
      return res.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
      toast({ title: t('wise.webhooks.created') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await apiRequest('DELETE', `/api/integrations/wise/webhooks/${encodeURIComponent(subscriptionId)}`);
      return res.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
      toast({ title: t('wise.webhooks.deleted') });
    },
    onError: (error) => {
      toast({
        title: t('wise.errors.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const runSimulationMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = simulationPayload.trim() ? parseJsonSafe(simulationPayload, t('wise.simulations.invalidPayload')) : {};
      if (payload === null) {
        throw new Error(t('wise.simulations.invalidPayload'));
      }
      switch (simulationOperation) {
        case 'transferState': {
          if (!simulationTransfer.transferId || !simulationTransfer.action) {
            throw new Error(t('wise.simulations.missingTransfer'));
          }
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/transfers/${encodeURIComponent(simulationTransfer.transferId)}/${encodeURIComponent(simulationTransfer.action)}`,
            payload
          );
          return res.json();
        }
        case 'profileVerification': {
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/verifications`,
            payload
          );
          return res.json();
        }
        case 'balanceTopup': {
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/balance/topup?profileId=${encodeURIComponent(profileFilter)}`,
            payload
          );
          return res.json();
        }
        case 'cardTransaction': {
          if (!simulationCard.cardToken || !simulationCard.action) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/${encodeURIComponent(simulationCard.action)}`,
            payload
          );
          return res.json();
        }
        case 'cardAuthorisation': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/authorisation`,
            payload
          );
          return res.json();
        }
        case 'cardRefund': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/refund`,
            payload
          );
          return res.json();
        }
        case 'cardProduction': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/production`,
            payload
          );
          return res.json();
        }
        case 'cardRecent': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const res = await apiRequest(
            'GET',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions`
          );
          return res.json();
        }
        case 'kycRequirements': {
          if (!simulationKyc.kycReviewId) {
            throw new Error(t('wise.simulations.missingKyc'));
          }
          const res = await apiRequest(
            'GET',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/kyc-reviews/${encodeURIComponent(simulationKyc.kycReviewId)}/requirements`
          );
          return res.json();
        }
        case 'bankImport': {
          const res = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/bank-transactions/import`,
            payload
          );
          return res.json();
        }
        default:
          throw new Error(t('wise.simulations.missingOperation'));
      }
    },
    onSuccess: (data) => {
      setSimulationResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setSimulationResponse(null);
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const runScaMutation = useMutation({
    mutationFn: async (endpoint: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = scaJosePayload.trim() ? parseJsonSafe(scaJosePayload, t('wise.sca.invalidPayload')) : {};
      if (payload === null) {
        throw new Error(t('wise.sca.invalidPayload'));
      }
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/${endpoint}?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return res.json();
    },
    onSuccess: (data) => {
      setScaResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setScaResponse(null);
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const runScaDeleteMutation = useMutation({
    mutationFn: async (endpoint: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = scaJosePayload.trim() ? parseJsonSafe(scaJosePayload, t('wise.sca.invalidPayload')) : {};
      if (payload === null) {
        throw new Error(t('wise.sca.invalidPayload'));
      }
      const res = await apiRequest(
        'DELETE',
        `/api/integrations/wise/${endpoint}?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return res.json();
    },
    onSuccess: (data) => {
      setScaResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setScaResponse(null);
      toast({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeQuoteMutation = useMutation({
    mutationFn: async (payload: { sourceCurrency: string; targetCurrency: string; sourceAmount: number }) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balance-quotes', payload);
      return res.json() as Promise<{ quote: WiseQuote }>;
    },
    onSuccess: () => {
      toast({
        title: t('wise.exchange.quoteReady'),
        description: t('wise.quotes.expiresIn', { minutes: 30 }),
      });
    },
    onError: (error) => {
      toast({
        title: t('wise.exchange.quoteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const exchangeExecuteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await apiRequest('POST', '/api/integrations/wise/balance-movements', { quoteId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/balances'] });
      toast({ title: t('wise.exchange.completed') });
    },
    onError: (error) => {
      toast({
        title: t('wise.exchange.failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const statementMutation = useMutation({
    mutationFn: async (payload: { balanceId: string; currency: string; intervalStart: string; intervalEnd: string }) => {
      const params = new URLSearchParams({
        currency: payload.currency,
        intervalStart: payload.intervalStart,
        intervalEnd: payload.intervalEnd,
      });
      const res = await apiRequest('GET', `/api/integrations/wise/balances/${payload.balanceId}/statement?${params.toString()}`);
      return res.json() as Promise<{ statement: WiseBalanceStatementResponse }>;
    },
    onSuccess: (data) => {
      setStatementData(data.statement);
    },
    onError: (error) => {
      toast({
        title: t('wise.history.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteRecipientMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/integrations/wise/recipients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/recipients'] });
      toast({
        title: t('wise.success.recipientDeleted'),
      });
    },
    onError: () => {
      toast({
        title: t('wise.errors.deleteFailed'),
        variant: 'destructive',
      });
    },
  });

  const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao ler arquivo'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });

  const parseJsonSafe = (raw: string, errorTitle: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      toast({
        title: errorTitle,
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      return null;
    }
  };

  const handleGetQuote = () => {
    if (!quoteForm.sourceAmount) return;
    createQuoteMutation.mutate({
      sourceCurrency: quoteForm.sourceCurrency,
      targetCurrency: quoteForm.targetCurrency,
      sourceAmount: parseFloat(quoteForm.sourceAmount),
    });
  };

  const handleGetExchangeQuote = () => {
    if (!exchangeForm.sourceAmount) return;
    exchangeQuoteMutation.mutate({
      sourceCurrency: exchangeForm.sourceCurrency,
      targetCurrency: exchangeForm.targetCurrency,
      sourceAmount: parseFloat(exchangeForm.sourceAmount),
    });
  };

  const handleExecuteExchange = () => {
    const quote = (exchangeQuoteMutation.data as { quote: WiseQuote } | undefined)?.quote;
    if (!quote?.id) return;
    exchangeExecuteMutation.mutate(quote.id);
  };

  const handleFetchStatement = () => {
    if (!statementForm.balanceId || !statementForm.intervalStart || !statementForm.intervalEnd) {
      toast({ title: t('wise.history.missingParams'), variant: 'destructive' });
      return;
    }
    const startIso = new Date(`${statementForm.intervalStart}T00:00:00.000Z`).toISOString();
    const endIso = new Date(`${statementForm.intervalEnd}T23:59:59.999Z`).toISOString();
    statementMutation.mutate({
      balanceId: statementForm.balanceId,
      currency: statementForm.currency,
      intervalStart: startIso,
      intervalEnd: endIso,
    });
  };

  const handleCreateBalance = () => {
    if (newBalanceForm.type === 'SAVINGS' && !newBalanceForm.name.trim()) {
      toast({ title: t('wise.balances.nameRequired'), variant: 'destructive' });
      return;
    }
    const payload = {
      currency: newBalanceForm.currency,
      type: newBalanceForm.type,
      name: newBalanceForm.type === 'SAVINGS' ? newBalanceForm.name.trim() : undefined,
    };
    createBalanceMutation.mutate(payload);
  };

  const handleDeleteRecipient = (id: number) => {
    if (window.confirm(t('wise.recipients.confirmDelete'))) {
      deleteRecipientMutation.mutate(id);
    }
  };

  const handleDeleteBalance = (balanceId: number) => {
    if (window.confirm(t('wise.balances.confirmDelete'))) {
      deleteBalanceMutation.mutate(balanceId);
    }
  };

  const handleUpdateCardStatus = (cardToken: string) => {
    const status = cardStatusUpdates[cardToken]?.trim();
    if (!status) {
      toast({ title: t('wise.cards.statusRequired'), variant: 'destructive' });
      return;
    }
    updateCardStatusMutation.mutate({ cardToken, status });
  };

  const handleCreateSpendControl = () => {
    if (!spendControlForm.name.trim() || !spendControlForm.maxAmount.trim() || !spendControlForm.currency || !spendControlForm.period) {
      toast({ title: t('wise.spendControls.missingParams'), variant: 'destructive' });
      return;
    }
    const maxAmount = Number(spendControlForm.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      toast({ title: t('wise.spendControls.invalidAmount'), variant: 'destructive' });
      return;
    }
    createSpendControlMutation.mutate({
      name: spendControlForm.name.trim(),
      currency: spendControlForm.currency,
      maxAmount,
      period: spendControlForm.period,
    });
  };

  const handleAssignSpendControl = (assign: 'assign' | 'unassign') => {
    if (!spendControlAssignment.ruleId.trim() || !spendControlAssignment.cardToken.trim()) {
      toast({ title: t('wise.spendControls.missingAssign'), variant: 'destructive' });
      return;
    }
    const payload = {
      ruleId: spendControlAssignment.ruleId.trim(),
      cardToken: spendControlAssignment.cardToken.trim(),
    };
    if (assign === 'assign') {
      assignSpendControlMutation.mutate(payload);
      return;
    }
    unassignSpendControlMutation.mutate(payload);
  };

  const handleDeleteSpendControl = () => {
    if (!spendControlDeleteId.trim()) {
      toast({ title: t('wise.spendControls.missingDelete'), variant: 'destructive' });
      return;
    }
    deleteSpendControlMutation.mutate(spendControlDeleteId.trim());
  };

  const handleFetchSpendLimitsProfile = () => {
    if (!spendLimitsProfileId.trim()) {
      toast({ title: t('wise.spendLimits.missingProfileId'), variant: 'destructive' });
      return;
    }
    getSpendLimitsProfileMutation.mutate(spendLimitsProfileId.trim());
  };

  const handleUpdateSpendLimitsProfile = () => {
    if (!spendLimitsProfileId.trim()) {
      toast({ title: t('wise.spendLimits.missingProfileId'), variant: 'destructive' });
      return;
    }
    const parsed = parseJsonSafe(spendLimitsPayload, t('wise.errors.invalidJson'));
    if (!parsed) {
      toast({ title: t('wise.errors.invalidJson'), variant: 'destructive' });
      return;
    }
    updateSpendLimitsProfileMutation.mutate({ profileId: spendLimitsProfileId.trim(), body: parsed });
  };

  const handleFetchSpendLimitsCard = () => {
    if (!spendLimitsProfileId.trim() || !spendLimitsCardToken.trim()) {
      toast({ title: t('wise.spendLimits.missingCardInput'), variant: 'destructive' });
      return;
    }
    getSpendLimitsCardMutation.mutate({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsCardToken.trim(),
    });
  };

  const handleUpdateSpendLimitsCard = () => {
    if (!spendLimitsProfileId.trim() || !spendLimitsCardToken.trim()) {
      toast({ title: t('wise.spendLimits.missingCardInput'), variant: 'destructive' });
      return;
    }
    const parsed = parseJsonSafe(spendLimitsCardPayload, t('wise.errors.invalidJson'));
    if (!parsed) {
      toast({ title: t('wise.errors.invalidJson'), variant: 'destructive' });
      return;
    }
    updateSpendLimitsCardMutation.mutate({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsCardToken.trim(),
      body: parsed,
    });
  };

  const handleDeleteSpendLimitsCard = () => {
    if (!spendLimitsProfileId.trim() || !spendLimitsDeleteCardToken.trim()) {
      toast({ title: t('wise.spendLimits.missingCardDelete'), variant: 'destructive' });
      return;
    }
    deleteSpendLimitsCardMutation.mutate({
      profileId: spendLimitsProfileId.trim(),
      cardToken: spendLimitsDeleteCardToken.trim(),
    });
  };

  const handleFetchWiseUser = () => {
    if (!wiseUserId.trim()) {
      toast({ title: t('wise.users.missingId'), variant: 'destructive' });
      return;
    }
    getWiseUserByIdMutation.mutate(wiseUserId.trim());
  };

  const handleListActivities = () => {
    listActivitiesMutation.mutate(activityFilters);
  };

  const handleFetchBalanceCapacity = async () => {
    if (!balanceCapacityCurrency.trim()) {
      toast({ title: t('wise.balanceCapacity.missingCurrency'), variant: 'destructive' });
      return;
    }
    try {
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/balance-capacity?currency=${encodeURIComponent(balanceCapacityCurrency.trim().toUpperCase())}`
      );
      const data = await res.json();
      setBalanceCapacityResult(JSON.stringify(data.capacity ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFetchTotalFunds = async () => {
    if (!totalFundsCurrency.trim()) {
      toast({ title: t('wise.totalFunds.missingCurrency'), variant: 'destructive' });
      return;
    }
    try {
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/total-funds?currency=${encodeURIComponent(totalFundsCurrency.trim().toUpperCase())}`
      );
      const data = await res.json();
      setTotalFundsResult(JSON.stringify(data.total ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFetchRates = async () => {
    if (!ratesForm.sourceCurrency.trim() || !ratesForm.targetCurrency.trim()) {
      toast({ title: t('wise.rates.missingCurrencies'), variant: 'destructive' });
      return;
    }
    try {
      const params = new URLSearchParams({
        source: ratesForm.sourceCurrency.trim().toUpperCase(),
        target: ratesForm.targetCurrency.trim().toUpperCase(),
      });
      const res = await apiRequest('GET', `/api/integrations/wise/rates?${params.toString()}`);
      const data = await res.json();
      setRatesResult(JSON.stringify(data.rate ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFetchRecipientRequirements = async () => {
    if (!recipientRequirementsForm.sourceCurrency.trim() || !recipientRequirementsForm.targetCurrency.trim() || !recipientRequirementsForm.sourceAmount.trim()) {
      toast({ title: t('wise.recipientRequirements.missingParams'), variant: 'destructive' });
      return;
    }
    try {
      const params = new URLSearchParams({
        sourceCurrency: recipientRequirementsForm.sourceCurrency.trim().toUpperCase(),
        targetCurrency: recipientRequirementsForm.targetCurrency.trim().toUpperCase(),
        sourceAmount: recipientRequirementsForm.sourceAmount.trim(),
      });
      const res = await apiRequest('GET', `/api/integrations/wise/recipient-requirements?${params.toString()}`);
      const data = await res.json();
      setRecipientRequirementsResult(JSON.stringify(data.requirements ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFundTransfer = async () => {
    if (!transferActionId.trim()) {
      toast({ title: t('wise.transfers.missingId'), variant: 'destructive' });
      return;
    }
    try {
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/transfers/${encodeURIComponent(transferActionId.trim())}/fund`
      );
      const data = await res.json();
      setTransferActionResult(JSON.stringify(data.result ?? data, null, 2));
      toast({ title: t('wise.transfers.funded') });
    } catch {
      toast({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  };

  const handleCancelTransfer = async () => {
    if (!transferActionId.trim()) {
      toast({ title: t('wise.transfers.missingId'), variant: 'destructive' });
      return;
    }
    try {
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/transfers/${encodeURIComponent(transferActionId.trim())}/cancel`
      );
      const data = await res.json();
      setTransferActionResult(JSON.stringify(data.result ?? data, null, 2));
      toast({ title: t('wise.transfers.cancelled') });
    } catch {
      toast({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  };

  const handleFetchCardPermissions = async () => {
    if (!profileFilter || !cardPermissionToken.trim()) {
      toast({ title: t('wise.cards.permissionsMissing'), variant: 'destructive' });
      return;
    }
    try {
      const res = await apiRequest(
        'GET',
        `/api/integrations/wise/cards/${encodeURIComponent(cardPermissionToken.trim())}/permissions?profileId=${encodeURIComponent(profileFilter)}`
      );
      const data = await res.json();
      setCardPermissionResult(JSON.stringify(data.permissions ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleUpdateCardPermissions = async () => {
    if (!profileFilter || !cardPermissionToken.trim()) {
      toast({ title: t('wise.cards.permissionsMissing'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardPermissionPayload, t('wise.errors.invalidJson'));
    if (!body) return;
    try {
      const res = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/${encodeURIComponent(cardPermissionToken.trim())}/permissions?profileId=${encodeURIComponent(profileFilter)}`,
        body
      );
      const data = await res.json();
      setCardPermissionResult(JSON.stringify(data.permissions ?? data, null, 2));
      toast({ title: t('wise.cards.permissionsUpdated') });
    } catch {
      toast({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  };

  const handleUpdateCardPermissionsBulk = async () => {
    if (!profileFilter) {
      toast({ title: t('wise.cards.permissionsMissingProfile'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardPermissionsPayload, t('wise.errors.invalidJson'));
    if (!body) return;
    try {
      const res = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/permissions?profileId=${encodeURIComponent(profileFilter)}`,
        body
      );
      const data = await res.json();
      setCardPermissionsResult(JSON.stringify(data.result ?? data, null, 2));
      toast({ title: t('wise.cards.permissionsUpdated') });
    } catch {
      toast({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  };

  const handleFetchCardSecureKey = async () => {
    try {
      const res = await apiRequest('GET', '/api/integrations/wise/cards/secure/encryption-key');
      const data = await res.json();
      setCardSecureKeyResult(JSON.stringify(data.key ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFetchCardSecureDetails = async () => {
    if (!cardSecureToken.trim()) {
      toast({ title: t('wise.cards.secureMissingToken'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardSecurePayload, t('wise.errors.invalidJson'));
    if (!body) return;
    try {
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/cards/secure/details?cardToken=${encodeURIComponent(cardSecureToken.trim())}`,
        body
      );
      const data = await res.json();
      setCardSecureDetailsResult(JSON.stringify(data.details ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleFetchCardSecurePin = async () => {
    if (!cardSecureToken.trim()) {
      toast({ title: t('wise.cards.secureMissingToken'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardSecurePinPayload, t('wise.errors.invalidJson'));
    if (!body) return;
    try {
      const res = await apiRequest(
        'POST',
        `/api/integrations/wise/cards/secure/pin?cardToken=${encodeURIComponent(cardSecureToken.trim())}`,
        body
      );
      const data = await res.json();
      setCardSecurePinResult(JSON.stringify(data.pin ?? data, null, 2));
    } catch {
      toast({ title: t('wise.errors.fetchFailed'), variant: 'destructive' });
    }
  };

  const handleUpdateDisputeStatus = () => {
    if (!disputeStatusUpdate.disputeId.trim() || !disputeStatusUpdate.status.trim()) {
      toast({ title: t('wise.disputes.missingParams'), variant: 'destructive' });
      return;
    }
    updateDisputeStatusMutation.mutate({
      disputeId: disputeStatusUpdate.disputeId.trim(),
      status: disputeStatusUpdate.status.trim(),
    });
  };

  const handleCreateCardOrder = () => {
    if (!cardOrderPayload.trim()) {
      toast({ title: t('wise.cardOrders.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    createCardOrderMutation.mutate(body);
  };

  const handleCreateAccountDetailsOrder = () => {
    if (!accountDetailsPayload.trim()) {
      toast({ title: t('wise.accountDetails.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(accountDetailsPayload, t('wise.accountDetails.invalidPayload'));
    if (!body) return;
    createAccountDetailsOrderMutation.mutate(body);
  };

  const handleUpdateCardOrderStatus = () => {
    if (!cardOrderId.trim() || !cardOrderStatusPayload.trim()) {
      toast({ title: t('wise.cardOrders.missingParams'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderStatusPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    updateCardOrderStatusMutation.mutate({ cardOrderId: cardOrderId.trim(), body });
  };

  const handleValidateCardOrderAddress = () => {
    if (!cardOrderValidationPayload.trim()) {
      toast({ title: t('wise.cardOrders.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderValidationPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    validateCardOrderAddressMutation.mutate(body);
  };

  const handlePresetCardOrderPin = () => {
    if (!cardOrderId.trim() || !cardOrderPinPayload.trim()) {
      toast({ title: t('wise.cardOrders.missingParams'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderPinPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    presetCardOrderPinMutation.mutate({ cardOrderId: cardOrderId.trim(), body });
  };

  const handleFetchCardOrderDetails = () => {
    if (!cardOrderId.trim()) {
      toast({ title: t('wise.cardOrders.missingOrderId'), variant: 'destructive' });
      return;
    }
    getCardOrderDetailsMutation.mutate(cardOrderId.trim());
  };

  const handleFetchCardOrderRequirements = () => {
    if (!cardOrderId.trim()) {
      toast({ title: t('wise.cardOrders.missingOrderId'), variant: 'destructive' });
      return;
    }
    getCardOrderRequirementsMutation.mutate(cardOrderId.trim());
  };

  const handleFetchCardOrderAvailability = () => {
    getCardOrderAvailabilityMutation.mutate();
  };

  const handleFetchCardTransaction = () => {
    if (!cardTransactionId.trim()) {
      toast({ title: t('wise.cardTransactions.missingId'), variant: 'destructive' });
      return;
    }
    getCardTransactionMutation.mutate(cardTransactionId.trim());
  };

  const handleDisputeFlowStep = () => {
    if (!disputeFlowForm.scheme.trim() || !disputeFlowForm.reason.trim() || !disputeFlowForm.transactionId.trim()) {
      toast({ title: t('wise.disputes.flowMissing'), variant: 'destructive' });
      return;
    }
    const body = disputeFlowForm.payload.trim()
      ? parseJsonSafe(disputeFlowForm.payload, t('wise.disputes.invalidPayload'))
      : {};
    if (body === null) return;
    disputeFlowStepMutation.mutate({
      scheme: disputeFlowForm.scheme.trim(),
      reason: disputeFlowForm.reason.trim(),
      transactionId: disputeFlowForm.transactionId.trim(),
      body,
    });
  };

  const handleDisputeFlowSubmit = () => {
    if (!disputeFlowForm.scheme.trim() || !disputeFlowForm.reason.trim() || !disputeFlowForm.transactionId.trim()) {
      toast({ title: t('wise.disputes.flowMissing'), variant: 'destructive' });
      return;
    }
    const body = disputeFlowForm.payload.trim()
      ? parseJsonSafe(disputeFlowForm.payload, t('wise.disputes.invalidPayload'))
      : {};
    if (body === null) return;
    disputeFlowSubmitMutation.mutate({
      scheme: disputeFlowForm.scheme.trim(),
      reason: disputeFlowForm.reason.trim(),
      transactionId: disputeFlowForm.transactionId.trim(),
      body,
    });
  };

  const handleDisputeFileChange = async (file: File | null) => {
    if (!file) {
      setDisputeUpload({ fileBase64: '', fileName: '', contentType: '' });
      return;
    }
    const base64 = await readFileAsBase64(file);
    setDisputeUpload({ fileBase64: base64, fileName: file.name, contentType: file.type || 'application/octet-stream' });
  };

  const handleDisputeFileUpload = () => {
    if (!disputeUpload.fileBase64) {
      toast({ title: t('wise.disputes.missingFile'), variant: 'destructive' });
      return;
    }
    uploadDisputeFileMutation.mutate();
  };

  const handleKycDocumentChange = async (file: File | null, type: 'document' | 'additional') => {
    if (!file) {
      if (type === 'document') {
        setKycUploadDocument({ fileBase64: '', fileName: '', contentType: '' });
        return;
      }
      setKycUploadAdditional({ fileBase64: '', fileName: '', contentType: '' });
      return;
    }
    const base64 = await readFileAsBase64(file);
    const payload = { fileBase64: base64, fileName: file.name, contentType: file.type || 'application/octet-stream' };
    if (type === 'document') {
      setKycUploadDocument(payload);
      return;
    }
    setKycUploadAdditional(payload);
  };

  const handleUploadKycDocument = () => {
    if (!kycUploadDocument.fileBase64) {
      toast({ title: t('wise.kyc.missingFile'), variant: 'destructive' });
      return;
    }
    uploadKycDocumentMutation.mutate();
  };

  const handleUploadKycAdditional = () => {
    if (!kycUploadAdditional.fileBase64) {
      toast({ title: t('wise.kyc.missingFile'), variant: 'destructive' });
      return;
    }
    uploadKycAdditionalMutation.mutate();
  };

  const handleRunCatalogOperation = async () => {
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
        profileId: catalogParams.profileId,
        cardToken: catalogParams.cardToken,
        disputeId: catalogParams.disputeId,
        transferId: catalogParams.transferId,
        kycReviewId: catalogParams.kycReviewId,
        subscriptionId: catalogParams.subscriptionId,
        action: catalogParams.action,
        ruleId: catalogParams.ruleId,
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
      toast({ title: t('wise.catalog.errors.title'), description: message, variant: 'destructive' });
    } finally {
      setCatalogLoading(false);
    }
  };

  if (isLoadingStatus) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!statusData?.configured) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('wise.notConfigured')}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Configure WISE_API_KEY e WISE_PROFILE_ID para ativar os pagamentos Wise.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const balances = (balancesData?.balances || []) as WiseBalance[];
  const transfers = (transfersData?.transfers || []) as WiseTransfer[];
  const recipients = (recipientsData?.recipients || []) as WiseRecipient[];
  const batchGroups = (batchGroupsData?.batchGroups || []) as WiseBatchGroup[];
  const profiles = (profilesData?.profiles || []) as WiseProfile[];
  const cards = (cardsData?.cards || []) as WiseCard[];
  const spendControls = (spendControlsData?.rules || []) as WiseSpendControl[];
  const disputes = (disputesData?.disputes || []) as WiseDispute[];
  const kycReviews = (kycReviewsData?.reviews || []) as WiseKycReviewsResponse['reviews'];
  const cardOrders = (cardOrdersData?.orders?.content || []) as WiseCardOrder[];
  const accountDetails = (accountDetailsData?.details || []) as WiseAccountDetail[];
  const accountDetailsOrders = (accountDetailsOrdersData?.orders || []) as Record<string, unknown>[];
  const balanceCurrencies = Array.from(new Set(balances.map((balance) => balance.currency)));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-wise-title">{t('wise.title')}</h1>
          <p className="text-muted-foreground">{t('wise.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {statusData?.sandbox && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-600">
              {t('wise.sandbox')}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchBalances();
              refetchTransfers();
              refetchRecipients();
              refetchBatchGroups();
              refetchProfiles();
              if (profileFilter) {
                refetchCards();
                refetchSpendControls();
                refetchDisputes();
                refetchKycReviews();
              }
            }}
            data-testid="button-wise-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href="https://erp.yesyoudeserve.duckdns.org"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-erpnext"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('erpnext.openErpnext')}
            </a>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex w-full flex-wrap gap-1">
          <TabsTrigger value="balances" data-testid="tab-balances">
            <Wallet className="h-4 w-4 mr-2" />
            {t('wise.balances.title')}
          </TabsTrigger>
          <TabsTrigger value="account-details" data-testid="tab-account-details">
            <FileText className="h-4 w-4 mr-2" />
            {t('wise.accountDetails.title')}
          </TabsTrigger>
          <TabsTrigger value="exchange" data-testid="tab-exchange">
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            {t('wise.exchange.title')}
          </TabsTrigger>
          <TabsTrigger value="transfers" data-testid="tab-transfers">
            <Send className="h-4 w-4 mr-2" />
            {t('wise.transfers.title')}
          </TabsTrigger>
          <TabsTrigger value="recipients" data-testid="tab-recipients">
            <Users className="h-4 w-4 mr-2" />
            {t('wise.recipients.title')}
          </TabsTrigger>
          <TabsTrigger value="quotes" data-testid="tab-quotes">
            <Calculator className="h-4 w-4 mr-2" />
            {t('wise.quotes.title')}
          </TabsTrigger>
          <TabsTrigger value="batch" data-testid="tab-batch">
            <Layers className="h-4 w-4 mr-2" />
            {t('wise.batch.title')}
          </TabsTrigger>
          <TabsTrigger value="statements" data-testid="tab-statements">
            <FileText className="h-4 w-4 mr-2" />
            {t('wise.history.title')}
          </TabsTrigger>
          <TabsTrigger value="profiles" data-testid="tab-profiles">
            <Users className="h-4 w-4 mr-2" />
            {t('wise.profiles.title')}
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="h-4 w-4 mr-2" />
            {t('wise.users.title')}
          </TabsTrigger>
          <TabsTrigger value="activities" data-testid="tab-activities">
            <History className="h-4 w-4 mr-2" />
            {t('wise.activities.title')}
          </TabsTrigger>
          <TabsTrigger value="cards" data-testid="tab-cards">
            <Wallet className="h-4 w-4 mr-2" />
            {t('wise.cards.title')}
          </TabsTrigger>
          <TabsTrigger value="card-orders" data-testid="tab-card-orders">
            <FileText className="h-4 w-4 mr-2" />
            {t('wise.cardOrders.title')}
          </TabsTrigger>
          <TabsTrigger value="card-transactions" data-testid="tab-card-transactions">
            <History className="h-4 w-4 mr-2" />
            {t('wise.cardTransactions.title')}
          </TabsTrigger>
          <TabsTrigger value="spend-controls" data-testid="tab-spend-controls">
            <Layers className="h-4 w-4 mr-2" />
            {t('wise.spendControls.title')}
          </TabsTrigger>
          <TabsTrigger value="spend-limits" data-testid="tab-spend-limits">
            <Layers className="h-4 w-4 mr-2" />
            {t('wise.spendLimits.title')}
          </TabsTrigger>
          <TabsTrigger value="disputes" data-testid="tab-disputes">
            <AlertCircle className="h-4 w-4 mr-2" />
            {t('wise.disputes.title')}
          </TabsTrigger>
          <TabsTrigger value="kyc" data-testid="tab-kyc">
            <CheckCircle className="h-4 w-4 mr-2" />
            {t('wise.kyc.title')}
          </TabsTrigger>
          <TabsTrigger value="webhooks" data-testid="tab-webhooks">
            <Webhook className="h-4 w-4 mr-2" />
            {t('wise.webhooks.title')}
          </TabsTrigger>
          <TabsTrigger value="simulations" data-testid="tab-simulations">
            <FlaskConical className="h-4 w-4 mr-2" />
            {t('wise.simulations.title')}
          </TabsTrigger>
          <TabsTrigger value="sca" data-testid="tab-sca">
            <ShieldCheck className="h-4 w-4 mr-2" />
            {t('wise.sca.title')}
          </TabsTrigger>
          <TabsTrigger value="catalog" data-testid="tab-catalog">
            <Layers className="h-4 w-4 mr-2" />
            {t('wise.catalog.title')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.balances.subtitle')}</CardDescription>
            <Dialog open={showNewBalanceDialog} onOpenChange={setShowNewBalanceDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-balance">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('wise.balances.new')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('wise.balances.new')}</DialogTitle>
                  <DialogDescription>{t('wise.balances.newDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('wise.balances.currency')}</Label>
                    <Select
                      value={newBalanceForm.currency}
                      onValueChange={(value: string) => setNewBalanceForm((prev) => ({ ...prev, currency: value }))}
                    >
                      <SelectTrigger data-testid="select-balance-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((curr) => (
                          <SelectItem key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.balances.type')}</Label>
                    <Select
                      value={newBalanceForm.type}
                      onValueChange={(value: 'STANDARD' | 'SAVINGS') => setNewBalanceForm((prev) => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger data-testid="select-balance-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">{t('wise.balances.standard')}</SelectItem>
                        <SelectItem value="SAVINGS">{t('wise.balances.savings')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newBalanceForm.type === 'SAVINGS' && (
                    <div className="space-y-2">
                      <Label>{t('wise.balances.name')}</Label>
                      <Input
                        value={newBalanceForm.name}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setNewBalanceForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder={t('wise.balances.namePlaceholder')}
                        data-testid="input-balance-name"
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewBalanceDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={handleCreateBalance}
                    disabled={createBalanceMutation.isPending}
                    data-testid="button-save-balance"
                  >
                    {createBalanceMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {isLoadingBalances ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          ) : balances.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.balances.noBalances')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {balances.map((balance) => (
                <Card key={balance.id} data-testid={`card-balance-${balance.currency}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{balance.currency}</Badge>
                        <Badge variant="secondary" className="text-xs">
                          {balance.type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteBalance(balance.id)}
                        data-testid={`button-delete-balance-${balance.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(balance.amount.value, balance.currency, locale)}
                    </div>
                    {balance.name && (
                      <p className="text-sm text-muted-foreground mt-1">{balance.name}</p>
                    )}
                    {balance.reservedAmount && balance.reservedAmount.value > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('wise.balances.reserved')}: {' '}
                        {formatCurrency(balance.reservedAmount.value, balance.currency, locale)}
                      </p>
                    )}
                    {balance.totalWorth && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('wise.balances.total')}: {' '}
                        {formatCurrency(balance.totalWorth.value, balance.totalWorth.currency, locale)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('wise.balanceCapacity.title')}</CardTitle>
                <CardDescription>{t('wise.balanceCapacity.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <Input
                    value={balanceCapacityCurrency}
                    onChange={(event) => setBalanceCapacityCurrency(event.target.value)}
                    placeholder={t('wise.balanceCapacity.currencyPlaceholder')}
                    data-testid="input-balance-capacity-currency"
                  />
                  <Button onClick={handleFetchBalanceCapacity} data-testid="button-balance-capacity">
                    {t('wise.balanceCapacity.fetch')}
                  </Button>
                </div>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {balanceCapacityResult ?? t('wise.balanceCapacity.responseEmpty')}
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('wise.totalFunds.title')}</CardTitle>
                <CardDescription>{t('wise.totalFunds.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <Input
                    value={totalFundsCurrency}
                    onChange={(event) => setTotalFundsCurrency(event.target.value)}
                    placeholder={t('wise.totalFunds.currencyPlaceholder')}
                    data-testid="input-total-funds-currency"
                  />
                  <Button onClick={handleFetchTotalFunds} data-testid="button-total-funds">
                    {t('wise.totalFunds.fetch')}
                  </Button>
                </div>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {totalFundsResult ?? t('wise.totalFunds.responseEmpty')}
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="exchange" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.exchange.title')}</CardTitle>
              <CardDescription>{t('wise.exchange.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {balanceCurrencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('wise.exchange.noBalances')}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.from')}</Label>
                    <Select
                      value={exchangeForm.sourceCurrency}
                      onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, sourceCurrency: value }))}
                    >
                      <SelectTrigger data-testid="select-exchange-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.amount')}</Label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={exchangeForm.sourceAmount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExchangeForm((prev) => ({ ...prev, sourceAmount: e.target.value }))}
                      data-testid="input-exchange-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.exchange.to')}</Label>
                    <Select
                      value={exchangeForm.targetCurrency}
                      onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, targetCurrency: value }))}
                    >
                      <SelectTrigger data-testid="select-exchange-target">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={handleGetExchangeQuote}
                      disabled={!exchangeForm.sourceAmount || exchangeQuoteMutation.isPending}
                      data-testid="button-exchange-quote"
                    >
                      {exchangeQuoteMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                      )}
                      {t('wise.exchange.getQuote')}
                    </Button>
                  </div>
                </div>
              )}

              {exchangeQuoteMutation.data && (
                <Card className="mt-4 bg-muted/50">
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
                        <p className="text-lg font-medium">
                          {formatNumber((exchangeQuoteMutation.data as { quote: WiseQuote }).quote.rate, locale, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
                        <p className="text-lg font-medium">
                          {formatCurrency(
                            (exchangeQuoteMutation.data as { quote: WiseQuote }).quote.fee,
                            exchangeForm.sourceCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.exchange.receive')}</p>
                        <p className="text-lg font-medium text-green-600">
                          {formatCurrency(
                            (exchangeQuoteMutation.data as { quote: WiseQuote }).quote.targetAmount,
                            exchangeForm.targetCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.expires')}</p>
                        <p className="text-lg font-medium">
                          {(exchangeQuoteMutation.data as { quote: WiseQuote }).quote.expirationTime
                            ? formatDate((exchangeQuoteMutation.data as { quote: WiseQuote }).quote.expirationTime as string, { locale, timeZone })
                            : '-'}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={handleExecuteExchange}
                      disabled={exchangeExecuteMutation.isPending}
                      data-testid="button-exchange-execute"
                    >
                      {exchangeExecuteMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                      )}
                      {t('wise.exchange.execute')}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.rates.title')}</CardTitle>
              <CardDescription>{t('wise.rates.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={ratesForm.sourceCurrency}
                  onChange={(event) => setRatesForm((prev) => ({ ...prev, sourceCurrency: event.target.value }))}
                  placeholder={t('wise.rates.sourcePlaceholder')}
                  data-testid="input-rates-source"
                />
                <Input
                  value={ratesForm.targetCurrency}
                  onChange={(event) => setRatesForm((prev) => ({ ...prev, targetCurrency: event.target.value }))}
                  placeholder={t('wise.rates.targetPlaceholder')}
                  data-testid="input-rates-target"
                />
                <Button onClick={handleFetchRates} data-testid="button-rates-fetch">
                  {t('wise.rates.fetch')}
                </Button>
              </div>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                {ratesResult ?? t('wise.rates.responseEmpty')}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account-details" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.accountDetails.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-account-details-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchAccountDetails()} data-testid="button-refresh-account-details">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetchAccountDetailsOrders()} data-testid="button-refresh-account-orders">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('wise.accountDetails.refreshOrders')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.accountDetails.createTitle')}</CardTitle>
              <CardDescription>{t('wise.accountDetails.createSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={accountDetailsPayload}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setAccountDetailsPayload(event.target.value)}
                rows={5}
                placeholder="{ }"
                data-testid="textarea-account-details-payload"
              />
              <Button
                onClick={handleCreateAccountDetailsOrder}
                disabled={createAccountDetailsOrderMutation.isPending}
                data-testid="button-create-account-order"
              >
                {t('wise.accountDetails.create')}
              </Button>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {accountDetailsResponse ?? t('wise.accountDetails.responseEmpty')}
              </pre>
            </CardContent>
          </Card>

          {isLoadingAccountDetails ? (
            <Skeleton className="h-48" />
          ) : accountDetails.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.accountDetails.noDetails')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.accountDetails.currency')}</TableHead>
                    <TableHead>{t('wise.accountDetails.holder')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountDetails.map((detail, index) => (
                    <TableRow key={detail.id ?? `${index}`} data-testid={`row-account-detail-${detail.id ?? index}`}>
                      <TableCell className="font-mono">{detail.id ?? '-'}</TableCell>
                      <TableCell>{detail.currency ?? '-'}</TableCell>
                      <TableCell>{detail.accountHolderName ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {isLoadingAccountDetailsOrders ? (
            <Skeleton className="h-40" />
          ) : accountDetailsOrders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">{t('wise.accountDetails.noOrders')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.accountDetails.status')}</TableHead>
                    <TableHead>{t('wise.accountDetails.currency')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountDetailsOrders.map((order, index) => (
                    <TableRow key={(order as { id?: string }).id ?? `${index}`} data-testid={`row-account-order-${(order as { id?: string }).id ?? index}`}>
                      <TableCell className="font-mono">{(order as { id?: string }).id ?? '-'}</TableCell>
                      <TableCell>{(order as { status?: string }).status ?? '-'}</TableCell>
                      <TableCell>{(order as { currency?: string }).currency ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.recipientRequirements.title')}</CardTitle>
              <CardDescription>{t('wise.recipientRequirements.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={recipientRequirementsForm.sourceCurrency}
                  onChange={(event) =>
                    setRecipientRequirementsForm((prev) => ({ ...prev, sourceCurrency: event.target.value }))
                  }
                  placeholder={t('wise.recipientRequirements.sourceCurrency')}
                  data-testid="input-recipient-req-source"
                />
                <Input
                  value={recipientRequirementsForm.targetCurrency}
                  onChange={(event) =>
                    setRecipientRequirementsForm((prev) => ({ ...prev, targetCurrency: event.target.value }))
                  }
                  placeholder={t('wise.recipientRequirements.targetCurrency')}
                  data-testid="input-recipient-req-target"
                />
                <Input
                  value={recipientRequirementsForm.sourceAmount}
                  onChange={(event) =>
                    setRecipientRequirementsForm((prev) => ({ ...prev, sourceAmount: event.target.value }))
                  }
                  placeholder={t('wise.recipientRequirements.sourceAmount')}
                  data-testid="input-recipient-req-amount"
                />
              </div>
              <Button onClick={handleFetchRecipientRequirements} data-testid="button-recipient-req">
                {t('wise.recipientRequirements.fetch')}
              </Button>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                {recipientRequirementsResult ?? t('wise.recipientRequirements.responseEmpty')}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfers" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.transfers.subtitle')}</CardDescription>
            <Button data-testid="button-new-transfer">
              <Plus className="h-4 w-4 mr-2" />
              {t('wise.transfers.new')}
            </Button>
          </div>

          {isLoadingTransfers ? (
            <Skeleton className="h-64" />
          ) : transfers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Send className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.transfers.noTransfers')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.transfers.amount')}</TableHead>
                    <TableHead>{t('wise.transfers.recipient')}</TableHead>
                    <TableHead>{t('wise.transfers.reference')}</TableHead>
                    <TableHead>{t('wise.transfers.status')}</TableHead>
                    <TableHead>{t('wise.transfers.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer) => (
                    <TableRow key={transfer.id} data-testid={`row-transfer-${transfer.id}`}>
                      <TableCell className="font-mono">{transfer.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCurrency(transfer.sourceValue, transfer.sourceCurrency, locale)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          → {formatCurrency(transfer.targetValue, transfer.targetCurrency, locale)}
                        </div>
                      </TableCell>
                      <TableCell>{transfer.targetAccount}</TableCell>
                      <TableCell>{transfer.reference || '-'}</TableCell>
                      <TableCell>{getStatusBadge(transfer.status)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(transfer.created, { locale, timeZone })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.transfers.actionsTitle')}</CardTitle>
              <CardDescription>{t('wise.transfers.actionsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  value={transferActionId}
                  onChange={(event) => setTransferActionId(event.target.value)}
                  placeholder={t('wise.transfers.transferIdPlaceholder')}
                  data-testid="input-transfer-action-id"
                />
                <Button variant="outline" onClick={handleFundTransfer} data-testid="button-transfer-fund">
                  {t('wise.transfers.fund')}
                </Button>
                <Button variant="outline" onClick={handleCancelTransfer} data-testid="button-transfer-cancel">
                  {t('wise.transfers.cancel')}
                </Button>
              </div>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                {transferActionResult ?? t('wise.transfers.responseEmpty')}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.recipients.subtitle')}</CardDescription>
            <Dialog open={showNewRecipientDialog} onOpenChange={setShowNewRecipientDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-recipient">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('wise.recipients.new')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('wise.recipients.new')}</DialogTitle>
                  <DialogDescription>{t('wise.recipients.subtitle')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.name')}</Label>
                    <Input placeholder="John Doe" data-testid="input-recipient-name" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.currency')}</Label>
                    <Select>
                      <SelectTrigger data-testid="select-recipient-currency">
                        <SelectValue placeholder={t('wise.recipients.currency')} />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((curr) => (
                          <SelectItem key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('wise.recipients.iban')}</Label>
                    <Input placeholder="PT50..." data-testid="input-recipient-iban" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewRecipientDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button data-testid="button-save-recipient">
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoadingRecipients ? (
            <Skeleton className="h-64" />
          ) : recipients.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.recipients.noRecipients')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.recipients.name')}</TableHead>
                    <TableHead>{t('wise.recipients.currency')}</TableHead>
                    <TableHead>{t('wise.recipients.accountType')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((recipient) => (
                    <TableRow key={recipient.id} data-testid={`row-recipient-${recipient.id}`}>
                      <TableCell className="font-mono">{recipient.id}</TableCell>
                      <TableCell className="font-medium">{recipient.accountHolderName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{recipient.currency}</Badge>
                      </TableCell>
                      <TableCell>{recipient.type}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRecipient(recipient.id)}
                          data-testid={`button-delete-recipient-${recipient.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.cards.permissionsTitle')}</CardTitle>
              <CardDescription>{t('wise.cards.permissionsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={cardPermissionToken}
                  onChange={(event) => setCardPermissionToken(event.target.value)}
                  placeholder={t('wise.cards.cardToken')}
                  data-testid="input-card-permissions-token"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleFetchCardPermissions} data-testid="button-card-permissions-fetch">
                    {t('wise.cards.permissionsFetch')}
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.cards.permissionsPayload')}</Label>
                  <Textarea
                    value={cardPermissionPayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardPermissionPayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-card-permissions"
                  />
                  <Button onClick={handleUpdateCardPermissions} data-testid="button-card-permissions-update">
                    {t('wise.cards.permissionsUpdate')}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.cards.permissionsBulkPayload')}</Label>
                  <Textarea
                    value={cardPermissionsPayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardPermissionsPayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-card-permissions-bulk"
                  />
                  <Button onClick={handleUpdateCardPermissionsBulk} data-testid="button-card-permissions-bulk">
                    {t('wise.cards.permissionsUpdateBulk')}
                  </Button>
                </div>
              </div>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                {cardPermissionResult ?? cardPermissionsResult ?? t('wise.cards.permissionsEmpty')}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.cards.secureTitle')}</CardTitle>
              <CardDescription>{t('wise.cards.secureSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={cardSecureToken}
                  onChange={(event) => setCardSecureToken(event.target.value)}
                  placeholder={t('wise.cards.cardToken')}
                  data-testid="input-card-secure-token"
                />
                <Button variant="outline" onClick={handleFetchCardSecureKey} data-testid="button-card-secure-key">
                  {t('wise.cards.secureFetchKey')}
                </Button>
              </div>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                {cardSecureKeyResult ?? t('wise.cards.secureKeyEmpty')}
              </pre>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.cards.secureDetailsPayload')}</Label>
                  <Textarea
                    value={cardSecurePayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardSecurePayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-card-secure-details"
                  />
                  <Button onClick={handleFetchCardSecureDetails} data-testid="button-card-secure-details">
                    {t('wise.cards.secureFetchDetails')}
                  </Button>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                    {cardSecureDetailsResult ?? t('wise.cards.secureDetailsEmpty')}
                  </pre>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.cards.securePinPayload')}</Label>
                  <Textarea
                    value={cardSecurePinPayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardSecurePinPayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-card-secure-pin"
                  />
                  <Button onClick={handleFetchCardSecurePin} data-testid="button-card-secure-pin">
                    {t('wise.cards.secureFetchPin')}
                  </Button>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                    {cardSecurePinResult ?? t('wise.cards.securePinEmpty')}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.quotes.title')}</CardTitle>
              <CardDescription>{t('wise.quotes.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.quotes.from')}</Label>
                  <Select
                    value={quoteForm.sourceCurrency}
                    onValueChange={(value: string) => setQuoteForm({ ...quoteForm, sourceCurrency: value })}
                  >
                    <SelectTrigger data-testid="select-quote-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((curr) => (
                        <SelectItem key={curr.code} value={curr.code}>
                          {curr.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.quotes.amount')}</Label>
                  <Input
                    type="number"
                    placeholder="1000"
                    value={quoteForm.sourceAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuoteForm({ ...quoteForm, sourceAmount: e.target.value })}
                    data-testid="input-quote-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.quotes.to')}</Label>
                  <Select
                    value={quoteForm.targetCurrency}
                    onValueChange={(value: string) => setQuoteForm({ ...quoteForm, targetCurrency: value })}
                  >
                    <SelectTrigger data-testid="select-quote-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((curr) => (
                        <SelectItem key={curr.code} value={curr.code}>
                          {curr.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    onClick={handleGetQuote}
                    disabled={!quoteForm.sourceAmount || createQuoteMutation.isPending}
                    data-testid="button-get-quote"
                  >
                    {createQuoteMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Calculator className="h-4 w-4 mr-2" />
                    )}
                    {t('wise.quotes.getQuote')}
                  </Button>
                </div>
              </div>

              {createQuoteMutation.data && (
                <Card className="mt-4 bg-muted/50">
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
                        <p className="text-lg font-medium">
                          {formatNumber((createQuoteMutation.data as { quote: WiseQuote }).quote.rate, locale, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
                        <p className="text-lg font-medium">
                          {formatCurrency(
                            (createQuoteMutation.data as { quote: WiseQuote }).quote.fee,
                            quoteForm.sourceCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.receive')}</p>
                        <p className="text-lg font-medium text-green-600">
                          {formatCurrency(
                            (createQuoteMutation.data as { quote: WiseQuote }).quote.targetAmount,
                            quoteForm.targetCurrency,
                            locale
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('wise.quotes.delivery')}</p>
                        <p className="text-lg font-medium">
                          {(createQuoteMutation.data as { quote: WiseQuote }).quote.deliveryEstimate
                            ? formatDate((createQuoteMutation.data as { quote: WiseQuote }).quote.deliveryEstimate as string, { locale, timeZone })
                            : ((createQuoteMutation.data as { quote: WiseQuote }).quote.formattedEstimatedDelivery ?? '-')}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.batch.subtitle')}</CardDescription>
            <Button data-testid="button-new-batch">
              <Plus className="h-4 w-4 mr-2" />
              {t('wise.batch.new')}
            </Button>
          </div>

          {isLoadingBatchGroups ? (
            <Skeleton className="h-64" />
          ) : batchGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.batch.noBatches')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.batch.name')}</TableHead>
                    <TableHead>{t('wise.batch.status')}</TableHead>
                    <TableHead>{t('wise.recipients.currency')}</TableHead>
                    <TableHead>{t('wise.transfers.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchGroups.map((batch) => (
                    <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                      <TableCell className="font-mono">{batch.id}</TableCell>
                      <TableCell className="font-medium">{batch.name}</TableCell>
                      <TableCell>{getStatusBadge(batch.status)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{batch.sourceCurrency}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(batch.created, { locale, timeZone })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="statements" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.history.title')}</CardTitle>
              <CardDescription>{t('wise.history.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.history.balance')}</Label>
                  <Select
                    value={statementForm.balanceId}
                    onValueChange={(value: string) => setStatementForm((prev) => ({ ...prev, balanceId: value }))}
                  >
                    <SelectTrigger data-testid="select-statement-balance">
                      <SelectValue placeholder={t('wise.history.balancePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {balances.map((balance) => (
                        <SelectItem key={balance.id} value={String(balance.id)}>
                          {balance.currency} • {balance.type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.currency')}</Label>
                  <Select
                    value={statementForm.currency}
                    onValueChange={(value: string) => setStatementForm((prev) => ({ ...prev, currency: value }))}
                  >
                    <SelectTrigger data-testid="select-statement-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(balanceCurrencies.length ? balanceCurrencies : CURRENCIES.map((curr) => curr.code)).map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.start')}</Label>
                  <Input
                    type="date"
                    value={statementForm.intervalStart}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setStatementForm((prev) => ({ ...prev, intervalStart: event.target.value }))
                    }
                    data-testid="input-statement-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.history.end')}</Label>
                  <Input
                    type="date"
                    value={statementForm.intervalEnd}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setStatementForm((prev) => ({ ...prev, intervalEnd: event.target.value }))
                    }
                    data-testid="input-statement-end"
                  />
                </div>
              </div>
              <Button
                onClick={handleFetchStatement}
                disabled={statementMutation.isPending}
                data-testid="button-fetch-statement"
              >
                {statementMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <History className="h-4 w-4 mr-2" />
                )}
                {t('wise.history.fetch')}
              </Button>

              {statementData ? (
                statementData.transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('wise.history.noHistory')}</p>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('wise.history.date')}</TableHead>
                          <TableHead>{t('wise.history.type')}</TableHead>
                          <TableHead>{t('wise.history.amount')}</TableHead>
                          <TableHead>{t('wise.history.fees')}</TableHead>
                          <TableHead>{t('wise.history.reference')}</TableHead>
                          <TableHead>{t('wise.history.balanceAfter')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.transactions.map((row, index) => (
                          <TableRow key={`${row.date}-${index}`}>
                            <TableCell>{formatDate(row.date, { locale, timeZone })}</TableCell>
                            <TableCell>{row.type}</TableCell>
                            <TableCell>
                              {formatCurrency(row.amount.value, row.amount.currency, locale)}
                            </TableCell>
                            <TableCell>
                              {row.totalFees
                                ? formatCurrency(row.totalFees.value, row.totalFees.currency, locale)
                                : '-'}
                            </TableCell>
                            <TableCell>{row.reference || '-'}</TableCell>
                            <TableCell>
                              {row.runningBalance
                                ? formatCurrency(row.runningBalance.value, row.runningBalance.currency, locale)
                                : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )
              ) : (
                <p className="text-sm text-muted-foreground">{t('wise.history.noHistory')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profiles" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <CardDescription>{t('wise.profiles.subtitle')}</CardDescription>
            <Button variant="outline" size="sm" onClick={() => refetchProfiles()} data-testid="button-refresh-profiles">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
          {isLoadingProfiles ? (
            <Skeleton className="h-64" />
          ) : profiles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.profiles.noProfiles')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.profiles.type')}</TableHead>
                    <TableHead>{t('wise.profiles.name')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile) => (
                    <TableRow key={profile.id} data-testid={`row-profile-${profile.id}`}>
                      <TableCell className="font-mono">{profile.id}</TableCell>
                      <TableCell>{profile.type}</TableCell>
                      <TableCell>
                        {profile.details?.companyName ||
                          [profile.details?.firstName, profile.details?.lastName].filter(Boolean).join(' ') ||
                          '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.users.title')}</CardTitle>
              <CardDescription>{t('wise.users.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">{t('wise.users.me')}</span>
                <Button variant="outline" size="sm" onClick={() => refetchWiseUserMe()} data-testid="button-refresh-users-me">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('common.refresh')}
                </Button>
              </div>
              {isLoadingWiseUserMe ? (
                <Skeleton className="h-40" />
              ) : wiseUserMeData?.user ? (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {JSON.stringify(wiseUserMeData.user, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">{t('wise.users.noData')}</p>
              )}
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <Label>{t('wise.users.byId')}</Label>
                  <Input
                    value={wiseUserId}
                    onChange={(event) => setWiseUserId(event.target.value)}
                    placeholder={t('wise.users.idPlaceholder')}
                    data-testid="input-user-id"
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleFetchWiseUser} data-testid="button-fetch-user">
                    {t('wise.users.fetch')}
                  </Button>
                </div>
              </div>
              {wiseUserResult && (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {wiseUserResult}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.activities.title')}</CardTitle>
              <CardDescription>{t('wise.activities.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.activities.profileId')}</Label>
                  <Input
                    value={activityFilters.profileId}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, profileId: event.target.value }))}
                    placeholder={t('wise.activities.profilePlaceholder')}
                    data-testid="input-activity-profile"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.activities.status')}</Label>
                  <Input
                    value={activityFilters.status}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, status: event.target.value }))}
                    placeholder={t('wise.activities.statusPlaceholder')}
                    data-testid="input-activity-status"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.activities.resourceType')}</Label>
                  <Input
                    value={activityFilters.monetaryResourceType}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, monetaryResourceType: event.target.value }))}
                    placeholder={t('wise.activities.resourcePlaceholder')}
                    data-testid="input-activity-resource"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.activities.size')}</Label>
                  <Input
                    value={activityFilters.size}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, size: event.target.value }))}
                    placeholder={t('wise.activities.sizePlaceholder')}
                    data-testid="input-activity-size"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.activities.since')}</Label>
                  <Input
                    type="datetime-local"
                    value={activityFilters.since}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, since: event.target.value }))}
                    data-testid="input-activity-since"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.activities.until')}</Label>
                  <Input
                    type="datetime-local"
                    value={activityFilters.until}
                    onChange={(event) => setActivityFilters((prev) => ({ ...prev, until: event.target.value }))}
                    data-testid="input-activity-until"
                  />
                </div>
              </div>
              <Button onClick={handleListActivities} data-testid="button-fetch-activities">
                {t('wise.activities.fetch')}
              </Button>
              {activityResults && (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {activityResults}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cards" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.cards.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-cards-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchCards()} data-testid="button-refresh-cards">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>
          </div>
          {!profileFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.cards.missingProfile')}</p>
              </CardContent>
            </Card>
          ) : isLoadingCards ? (
            <Skeleton className="h-64" />
          ) : cards.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.cards.noCards')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('wise.cards.cardToken')}</TableHead>
                    <TableHead>{t('wise.cards.status')}</TableHead>
                    <TableHead>{t('wise.cards.type')}</TableHead>
                    <TableHead>{t('wise.cards.last4')}</TableHead>
                    <TableHead>{t('wise.cards.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cards.map((card) => (
                    <TableRow key={card.cardToken} data-testid={`row-card-${card.cardToken}`}>
                      <TableCell className="font-mono">{card.cardToken}</TableCell>
                      <TableCell>{card.status}</TableCell>
                      <TableCell>{card.type ?? '-'}</TableCell>
                      <TableCell>{card.lastFourDigits ?? '-'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            value={cardStatusUpdates[card.cardToken] ?? ''}
                            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                              setCardStatusUpdates((prev) => ({ ...prev, [card.cardToken]: event.target.value }))
                            }
                            placeholder="ACTIVE"
                            data-testid={`input-card-status-${card.cardToken}`}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleUpdateCardStatus(card.cardToken)}
                            disabled={updateCardStatusMutation.isPending}
                            data-testid={`button-card-status-${card.cardToken}`}
                          >
                            {t('wise.cards.updateStatus')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="card-orders" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.cardOrders.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-card-orders-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={cardOrdersPage.pageNumber}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setCardOrdersPage((prev) => ({ ...prev, pageNumber: event.target.value }))
                }
                placeholder={t('wise.cardOrders.page')}
                data-testid="input-card-orders-page"
              />
              <Input
                value={cardOrdersPage.pageSize}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setCardOrdersPage((prev) => ({ ...prev, pageSize: event.target.value }))
                }
                placeholder={t('wise.cardOrders.pageSize')}
                data-testid="input-card-orders-page-size"
              />
              <Button variant="outline" size="sm" onClick={() => refetchCardOrders()} data-testid="button-refresh-card-orders">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.cardOrders.createTitle')}</CardTitle>
              <CardDescription>{t('wise.cardOrders.createSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={cardOrderPayload}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardOrderPayload(event.target.value)}
                rows={6}
                placeholder="{ }"
                data-testid="textarea-card-order-payload"
              />
              <Button onClick={handleCreateCardOrder} disabled={createCardOrderMutation.isPending} data-testid="button-create-card-order">
                <Plus className="h-4 w-4 mr-2" />
                {t('wise.cardOrders.create')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.cardOrders.actionsTitle')}</CardTitle>
              <CardDescription>{t('wise.cardOrders.actionsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.cardOrders.orderId')}</Label>
                  <Input
                    value={cardOrderId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCardOrderId(event.target.value)}
                    data-testid="input-card-order-id"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={handleFetchCardOrderDetails} data-testid="button-card-order-details">
                    {t('wise.cardOrders.fetchDetails')}
                  </Button>
                  <Button variant="outline" onClick={handleFetchCardOrderRequirements} data-testid="button-card-order-requirements">
                    {t('wise.cardOrders.fetchRequirements')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('wise.cardOrders.statusPayload')}</Label>
                <Textarea
                  value={cardOrderStatusPayload}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardOrderStatusPayload(event.target.value)}
                  rows={4}
                  placeholder="{ }"
                  data-testid="textarea-card-order-status"
                />
                <Button onClick={handleUpdateCardOrderStatus} disabled={updateCardOrderStatusMutation.isPending} data-testid="button-card-order-status">
                  {t('wise.cardOrders.updateStatus')}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t('wise.cardOrders.addressPayload')}</Label>
                <Textarea
                  value={cardOrderValidationPayload}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardOrderValidationPayload(event.target.value)}
                  rows={4}
                  placeholder="{ }"
                  data-testid="textarea-card-order-address"
                />
                <Button onClick={handleValidateCardOrderAddress} disabled={validateCardOrderAddressMutation.isPending} data-testid="button-card-order-validate">
                  {t('wise.cardOrders.validateAddress')}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t('wise.cardOrders.pinPayload')}</Label>
                <Textarea
                  value={cardOrderPinPayload}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCardOrderPinPayload(event.target.value)}
                  rows={4}
                  placeholder="{ }"
                  data-testid="textarea-card-order-pin"
                />
                <Button onClick={handlePresetCardOrderPin} disabled={presetCardOrderPinMutation.isPending} data-testid="button-card-order-pin">
                  {t('wise.cardOrders.setPin')}
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleFetchCardOrderAvailability} disabled={getCardOrderAvailabilityMutation.isPending} data-testid="button-card-order-availability">
                  {t('wise.cardOrders.fetchAvailability')}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t('wise.cardOrders.response')}</Label>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {cardOrderDetails || cardOrderRequirements || cardOrderAvailability || t('wise.cardOrders.responseEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>

          {!profileFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.cardOrders.missingProfile')}</p>
              </CardContent>
            </Card>
          ) : isLoadingCardOrders ? (
            <Skeleton className="h-64" />
          ) : cardOrders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.cardOrders.noOrders')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.cardOrders.status')}</TableHead>
                    <TableHead>{t('wise.cardOrders.type')}</TableHead>
                    <TableHead>{t('wise.cardOrders.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cardOrders.map((order, index) => (
                    <TableRow key={order.id ?? `${index}`} data-testid={`row-card-order-${order.id ?? index}`}>
                      <TableCell className="font-mono">{order.id ?? '-'}</TableCell>
                      <TableCell>{order.status ?? '-'}</TableCell>
                      <TableCell>{order.cardType ?? '-'}</TableCell>
                      <TableCell>
                        {order.created ? formatDate(order.created, { locale, timeZone }) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="card-transactions" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.cardTransactions.subtitle')}</CardDescription>
            <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
              <SelectTrigger className="min-w-[200px]" data-testid="select-card-transactions-profile">
                <SelectValue placeholder={t('wise.catalog.profileId')} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.id} • {profile.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.cardTransactions.fetchTitle')}</CardTitle>
              <CardDescription>{t('wise.cardTransactions.fetchSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={cardTransactionId}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCardTransactionId(event.target.value)}
                placeholder={t('wise.cardTransactions.transactionId')}
                data-testid="input-card-transaction-id"
              />
              <Button onClick={handleFetchCardTransaction} disabled={getCardTransactionMutation.isPending} data-testid="button-card-transaction-fetch">
                {t('wise.cardTransactions.fetch')}
              </Button>
              <div className="space-y-2">
                <Label>{t('wise.cardTransactions.response')}</Label>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {cardTransactionDetails ?? t('wise.cardTransactions.responseEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spend-controls" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.spendControls.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-spend-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchSpendControls()} data-testid="button-refresh-spend-controls">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.spendControls.new')}</CardTitle>
              <CardDescription>{t('wise.spendControls.newSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.name')}</Label>
                  <Input
                    value={spendControlForm.name}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSpendControlForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    data-testid="input-spend-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.currency')}</Label>
                  <Select
                    value={spendControlForm.currency}
                    onValueChange={(value: string) => setSpendControlForm((prev) => ({ ...prev, currency: value }))}
                  >
                    <SelectTrigger data-testid="select-spend-currency">
                      <SelectValue placeholder={t('common.select')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((curr) => (
                        <SelectItem key={curr.code} value={curr.code}>
                          {curr.code} - {curr.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.amount')}</Label>
                  <Input
                    value={spendControlForm.maxAmount}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSpendControlForm((prev) => ({ ...prev, maxAmount: event.target.value }))
                    }
                    data-testid="input-spend-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.period')}</Label>
                  <Select
                    value={spendControlForm.period}
                    onValueChange={(value: string) => setSpendControlForm((prev) => ({ ...prev, period: value }))}
                  >
                    <SelectTrigger data-testid="select-spend-period">
                      <SelectValue placeholder={t('common.select')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">{t('wise.spendControls.daily')}</SelectItem>
                      <SelectItem value="WEEKLY">{t('wise.spendControls.weekly')}</SelectItem>
                      <SelectItem value="MONTHLY">{t('wise.spendControls.monthly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleCreateSpendControl} disabled={createSpendControlMutation.isPending} data-testid="button-create-spend-control">
                <Plus className="h-4 w-4 mr-2" />
                {t('wise.spendControls.create')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.spendControls.assignTitle')}</CardTitle>
              <CardDescription>{t('wise.spendControls.assignSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.ruleId')}</Label>
                  <Input
                    value={spendControlAssignment.ruleId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSpendControlAssignment((prev) => ({ ...prev, ruleId: event.target.value }))
                    }
                    data-testid="input-spend-rule-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendControls.cardToken')}</Label>
                  <Input
                    value={spendControlAssignment.cardToken}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSpendControlAssignment((prev) => ({ ...prev, cardToken: event.target.value }))
                    }
                    data-testid="input-spend-card-token"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleAssignSpendControl('assign')}
                  disabled={assignSpendControlMutation.isPending}
                  data-testid="button-assign-spend-control"
                >
                  {t('wise.spendControls.assign')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleAssignSpendControl('unassign')}
                  disabled={unassignSpendControlMutation.isPending}
                  data-testid="button-unassign-spend-control"
                >
                  {t('wise.spendControls.unassign')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.spendControls.deleteTitle')}</CardTitle>
              <CardDescription>{t('wise.spendControls.deleteSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={spendControlDeleteId}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSpendControlDeleteId(event.target.value)}
                placeholder={t('wise.spendControls.ruleId')}
                data-testid="input-spend-delete"
              />
              <Button
                variant="destructive"
                onClick={handleDeleteSpendControl}
                disabled={deleteSpendControlMutation.isPending}
                data-testid="button-delete-spend-control"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('wise.spendControls.delete')}
              </Button>
            </CardContent>
          </Card>

          {!profileFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.spendControls.missingProfile')}</p>
              </CardContent>
            </Card>
          ) : isLoadingSpendControls ? (
            <Skeleton className="h-64" />
          ) : spendControls.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.spendControls.noRules')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.spendControls.name')}</TableHead>
                    <TableHead>{t('wise.spendControls.currency')}</TableHead>
                    <TableHead>{t('wise.spendControls.amount')}</TableHead>
                    <TableHead>{t('wise.spendControls.period')}</TableHead>
                    <TableHead>{t('wise.spendControls.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spendControls.map((rule, index) => (
                    <TableRow key={rule.id ?? `${rule.name}-${index}`} data-testid={`row-spend-${rule.id ?? index}`}>
                      <TableCell className="font-mono">{rule.id ?? '-'}</TableCell>
                      <TableCell>{rule.name ?? '-'}</TableCell>
                      <TableCell>{rule.currency ?? '-'}</TableCell>
                      <TableCell>
                        {rule.maxAmount !== undefined
                          ? formatNumber(rule.maxAmount, locale)
                          : '-'}
                      </TableCell>
                      <TableCell>{rule.period ?? '-'}</TableCell>
                      <TableCell>{rule.status ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="spend-limits" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.spendLimits.title')}</CardTitle>
              <CardDescription>{t('wise.spendLimits.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.profileId')}</Label>
                  <Input
                    value={spendLimitsProfileId}
                    onChange={(event) => setSpendLimitsProfileId(event.target.value)}
                    placeholder={t('wise.spendLimits.profilePlaceholder')}
                    data-testid="input-spend-limits-profile"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.cardToken')}</Label>
                  <Input
                    value={spendLimitsCardToken}
                    onChange={(event) => setSpendLimitsCardToken(event.target.value)}
                    placeholder={t('wise.spendLimits.cardPlaceholder')}
                    data-testid="input-spend-limits-card"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleFetchSpendLimitsProfile} data-testid="button-spend-limits-profile">
                  {t('wise.spendLimits.fetchProfile')}
                </Button>
                <Button variant="outline" onClick={handleFetchSpendLimitsCard} data-testid="button-spend-limits-card">
                  {t('wise.spendLimits.fetchCard')}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.profilePayload')}</Label>
                  <Textarea
                    value={spendLimitsPayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setSpendLimitsPayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-spend-limits-profile"
                  />
                  <Button onClick={handleUpdateSpendLimitsProfile} disabled={updateSpendLimitsProfileMutation.isPending} data-testid="button-update-spend-limits-profile">
                    {t('wise.spendLimits.updateProfile')}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.cardPayload')}</Label>
                  <Textarea
                    value={spendLimitsCardPayload}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setSpendLimitsCardPayload(event.target.value)}
                    rows={5}
                    placeholder="{ }"
                    data-testid="textarea-spend-limits-card"
                  />
                  <Button onClick={handleUpdateSpendLimitsCard} disabled={updateSpendLimitsCardMutation.isPending} data-testid="button-update-spend-limits-card">
                    {t('wise.spendLimits.updateCard')}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('wise.spendLimits.cardDelete')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={spendLimitsDeleteCardToken}
                    onChange={(event) => setSpendLimitsDeleteCardToken(event.target.value)}
                    placeholder={t('wise.spendLimits.cardDeletePlaceholder')}
                    data-testid="input-spend-limits-delete-card"
                  />
                  <Button variant="destructive" onClick={handleDeleteSpendLimitsCard} disabled={deleteSpendLimitsCardMutation.isPending} data-testid="button-delete-spend-limits-card">
                    {t('wise.spendLimits.deleteCard')}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.profileResponse')}</Label>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                    {spendLimitsProfileResult ?? t('wise.spendLimits.responseEmpty')}
                  </pre>
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.spendLimits.cardResponse')}</Label>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                    {spendLimitsCardResult ?? t('wise.spendLimits.responseEmpty')}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disputes" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.disputes.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-disputes-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchDisputes()} data-testid="button-refresh-disputes">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.disputes.reasonsTitle')}</CardTitle>
              <CardDescription>{t('wise.disputes.reasonsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoadingDisputeReasons ? (
                <Skeleton className="h-32" />
              ) : (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {disputeReasonsData ? JSON.stringify(disputeReasonsData, null, 2) : t('wise.disputes.noReasons')}
                </pre>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.disputes.flowTitle')}</CardTitle>
              <CardDescription>{t('wise.disputes.flowSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.disputes.scheme')}</Label>
                  <Input
                    value={disputeFlowForm.scheme}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDisputeFlowForm((prev) => ({ ...prev, scheme: event.target.value }))
                    }
                    data-testid="input-dispute-scheme"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.disputes.reason')}</Label>
                  <Input
                    value={disputeFlowForm.reason}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDisputeFlowForm((prev) => ({ ...prev, reason: event.target.value }))
                    }
                    data-testid="input-dispute-reason"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.disputes.transactionId')}</Label>
                  <Input
                    value={disputeFlowForm.transactionId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDisputeFlowForm((prev) => ({ ...prev, transactionId: event.target.value }))
                    }
                    data-testid="input-dispute-transaction"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('wise.disputes.flowPayload')}</Label>
                <Textarea
                  value={disputeFlowForm.payload}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDisputeFlowForm((prev) => ({ ...prev, payload: event.target.value }))
                  }
                  rows={4}
                  placeholder="{ }"
                  data-testid="textarea-dispute-flow"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleDisputeFlowStep} disabled={disputeFlowStepMutation.isPending} data-testid="button-dispute-step">
                  {t('wise.disputes.flowStep')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDisputeFlowSubmit}
                  disabled={disputeFlowSubmitMutation.isPending}
                  data-testid="button-dispute-submit"
                >
                  {t('wise.disputes.flowSubmit')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label>{t('wise.disputes.flowResponse')}</Label>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {disputeFlowStepResult || disputeFlowSubmitResult || t('wise.disputes.flowEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.disputes.uploadTitle')}</CardTitle>
              <CardDescription>{t('wise.disputes.uploadSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="file"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleDisputeFileChange(event.target.files?.[0] ?? null)}
                data-testid="input-dispute-file"
              />
              <Button onClick={handleDisputeFileUpload} disabled={uploadDisputeFileMutation.isPending} data-testid="button-dispute-upload">
                {t('wise.disputes.upload')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.disputes.updateTitle')}</CardTitle>
              <CardDescription>{t('wise.disputes.updateSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.disputes.disputeId')}</Label>
                  <Input
                    value={disputeStatusUpdate.disputeId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDisputeStatusUpdate((prev) => ({ ...prev, disputeId: event.target.value }))
                    }
                    data-testid="input-dispute-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.disputes.status')}</Label>
                  <Input
                    value={disputeStatusUpdate.status}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDisputeStatusUpdate((prev) => ({ ...prev, status: event.target.value }))
                    }
                    data-testid="input-dispute-status"
                  />
                </div>
              </div>
              <Button onClick={handleUpdateDisputeStatus} disabled={updateDisputeStatusMutation.isPending} data-testid="button-update-dispute">
                {t('wise.disputes.update')}
              </Button>
            </CardContent>
          </Card>

          {!profileFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.disputes.missingProfile')}</p>
              </CardContent>
            </Card>
          ) : isLoadingDisputes ? (
            <Skeleton className="h-64" />
          ) : disputes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.disputes.noDisputes')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.disputes.status')}</TableHead>
                    <TableHead>{t('wise.disputes.reason')}</TableHead>
                    <TableHead>{t('wise.disputes.scheme')}</TableHead>
                    <TableHead>{t('wise.disputes.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disputes.map((dispute, index) => (
                    <TableRow key={dispute.id ?? `${index}`} data-testid={`row-dispute-${dispute.id ?? index}`}>
                      <TableCell className="font-mono">{dispute.id ?? '-'}</TableCell>
                      <TableCell>{dispute.status ?? '-'}</TableCell>
                      <TableCell>{dispute.reason ?? '-'}</TableCell>
                      <TableCell>{dispute.scheme ?? '-'}</TableCell>
                      <TableCell>
                        {dispute.created ? formatDate(dispute.created, { locale, timeZone }) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="kyc" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.kyc.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-kyc-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchKycReviews()} data-testid="button-refresh-kyc">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.kyc.evidencesTitle')}</CardTitle>
              <CardDescription>{t('wise.kyc.evidencesSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                onClick={() => getKycRequiredEvidencesMutation.mutate()}
                disabled={getKycRequiredEvidencesMutation.isPending}
                data-testid="button-kyc-evidences"
              >
                {t('wise.kyc.fetchEvidences')}
              </Button>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {kycRequiredEvidences ?? t('wise.kyc.evidencesEmpty')}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.kyc.uploadDocumentTitle')}</CardTitle>
              <CardDescription>{t('wise.kyc.uploadDocumentSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="file"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleKycDocumentChange(event.target.files?.[0] ?? null, 'document')}
                data-testid="input-kyc-document"
              />
              <Button onClick={handleUploadKycDocument} disabled={uploadKycDocumentMutation.isPending} data-testid="button-kyc-document-upload">
                {t('wise.kyc.uploadDocument')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.kyc.uploadAdditionalTitle')}</CardTitle>
              <CardDescription>{t('wise.kyc.uploadAdditionalSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="file"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleKycDocumentChange(event.target.files?.[0] ?? null, 'additional')}
                data-testid="input-kyc-additional"
              />
              <Button onClick={handleUploadKycAdditional} disabled={uploadKycAdditionalMutation.isPending} data-testid="button-kyc-additional-upload">
                {t('wise.kyc.uploadAdditional')}
              </Button>
            </CardContent>
          </Card>

          {!profileFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.kyc.missingProfile')}</p>
              </CardContent>
            </Card>
          ) : isLoadingKycReviews ? (
            <Skeleton className="h-64" />
          ) : kycReviews.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('wise.kyc.noReviews')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('wise.kyc.status')}</TableHead>
                    <TableHead>{t('wise.kyc.created')}</TableHead>
                    <TableHead>{t('wise.kyc.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kycReviews.map((review, index) => (
                    <TableRow key={review.id ?? `${index}`} data-testid={`row-kyc-${review.id ?? index}`}>
                      <TableCell className="font-mono">{review.id ?? '-'}</TableCell>
                      <TableCell>{review.status ?? '-'}</TableCell>
                      <TableCell>
                        {review.created ? formatDate(review.created, { locale, timeZone }) : '-'}
                      </TableCell>
                      <TableCell>
                        {review.updated ? formatDate(review.updated, { locale, timeZone }) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.webhooks.subtitle')}</CardDescription>
            <div className="flex items-center gap-2">
              <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
                <SelectTrigger className="min-w-[200px]" data-testid="select-webhooks-profile">
                  <SelectValue placeholder={t('wise.catalog.profileId')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.id} • {profile.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={webhookApplication} onValueChange={setWebhookApplication}>
                <SelectTrigger className="min-w-[180px]" data-testid="select-webhooks-application">
                  <SelectValue placeholder={t('wise.webhooks.application')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">{t('wise.webhooks.profileScope')}</SelectItem>
                  <SelectItem value="true">{t('wise.webhooks.applicationScope')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => listWebhooksMutation.mutate()} data-testid="button-webhooks-list">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('wise.webhooks.list')}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.webhooks.createTitle')}</CardTitle>
              <CardDescription>{t('wise.webhooks.createSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={webhookPayload}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setWebhookPayload(event.target.value)}
                rows={5}
                placeholder="{ }"
                data-testid="textarea-webhook-payload"
              />
              <Button
                onClick={() => {
                  if (!webhookPayload.trim()) {
                    toast({ title: t('wise.webhooks.missingPayload'), variant: 'destructive' });
                    return;
                  }
                  const body = parseJsonSafe(webhookPayload, t('wise.webhooks.invalidPayload'));
                  if (!body) return;
                  createWebhookMutation.mutate(body);
                }}
                disabled={createWebhookMutation.isPending}
                data-testid="button-webhook-create"
              >
                {t('wise.webhooks.create')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.webhooks.deleteTitle')}</CardTitle>
              <CardDescription>{t('wise.webhooks.deleteSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={webhookDeleteId}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWebhookDeleteId(event.target.value)}
                placeholder={t('wise.webhooks.subscriptionId')}
                data-testid="input-webhook-delete"
              />
              <Button
                variant="destructive"
                onClick={() => {
                  if (!webhookDeleteId.trim()) {
                    toast({ title: t('wise.webhooks.missingId'), variant: 'destructive' });
                    return;
                  }
                  deleteWebhookMutation.mutate(webhookDeleteId.trim());
                }}
                disabled={deleteWebhookMutation.isPending}
                data-testid="button-webhook-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('wise.webhooks.delete')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.webhooks.responseTitle')}</CardTitle>
              <CardDescription>{t('wise.webhooks.responseSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {webhookResponse ?? t('wise.webhooks.responseEmpty')}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulations" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.simulations.subtitle')}</CardDescription>
            <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
              <SelectTrigger className="min-w-[200px]" data-testid="select-simulations-profile">
                <SelectValue placeholder={t('wise.catalog.profileId')} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.id} • {profile.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.simulations.operationTitle')}</CardTitle>
              <CardDescription>{t('wise.simulations.operationSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={simulationOperation} onValueChange={setSimulationOperation}>
                <SelectTrigger data-testid="select-simulations-operation">
                  <SelectValue placeholder={t('wise.simulations.operation')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferState">{t('wise.simulations.transferState')}</SelectItem>
                  <SelectItem value="profileVerification">{t('wise.simulations.profileVerification')}</SelectItem>
                  <SelectItem value="balanceTopup">{t('wise.simulations.balanceTopup')}</SelectItem>
                  <SelectItem value="cardTransaction">{t('wise.simulations.cardTransaction')}</SelectItem>
                  <SelectItem value="cardAuthorisation">{t('wise.simulations.cardAuthorisation')}</SelectItem>
                  <SelectItem value="cardRefund">{t('wise.simulations.cardRefund')}</SelectItem>
                  <SelectItem value="cardProduction">{t('wise.simulations.cardProduction')}</SelectItem>
                  <SelectItem value="cardRecent">{t('wise.simulations.cardRecent')}</SelectItem>
                  <SelectItem value="kycRequirements">{t('wise.simulations.kycRequirements')}</SelectItem>
                  <SelectItem value="bankImport">{t('wise.simulations.bankImport')}</SelectItem>
                </SelectContent>
              </Select>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.simulations.transferId')}</Label>
                  <Input
                    value={simulationTransfer.transferId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSimulationTransfer((prev) => ({ ...prev, transferId: event.target.value }))
                    }
                    data-testid="input-sim-transfer-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.simulations.transferAction')}</Label>
                  <Input
                    value={simulationTransfer.action}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSimulationTransfer((prev) => ({ ...prev, action: event.target.value }))
                    }
                    data-testid="input-sim-transfer-action"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.simulations.cardToken')}</Label>
                  <Input
                    value={simulationCard.cardToken}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSimulationCard((prev) => ({ ...prev, cardToken: event.target.value }))
                    }
                    data-testid="input-sim-card-token"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.simulations.cardAction')}</Label>
                  <Input
                    value={simulationCard.action}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSimulationCard((prev) => ({ ...prev, action: event.target.value }))
                    }
                    data-testid="input-sim-card-action"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('wise.simulations.kycReviewId')}</Label>
                  <Input
                    value={simulationKyc.kycReviewId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSimulationKyc((prev) => ({ ...prev, kycReviewId: event.target.value }))
                    }
                    data-testid="input-sim-kyc-id"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('wise.simulations.payload')}</Label>
                <Textarea
                  value={simulationPayload}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setSimulationPayload(event.target.value)}
                  rows={4}
                  placeholder="{ }"
                  data-testid="textarea-sim-payload"
                />
              </div>

              <Button onClick={() => runSimulationMutation.mutate()} disabled={runSimulationMutation.isPending} data-testid="button-run-simulation">
                {t('wise.simulations.run')}
              </Button>

              <div className="space-y-2">
                <Label>{t('wise.simulations.response')}</Label>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {simulationResponse ?? t('wise.simulations.responseEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sca" className="space-y-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>{t('wise.sca.subtitle')}</CardDescription>
            <Select value={profileFilter} onValueChange={(value: string) => setProfileFilter(value)}>
              <SelectTrigger className="min-w-[200px]" data-testid="select-sca-profile">
                <SelectValue placeholder={t('wise.catalog.profileId')} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.id} • {profile.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('wise.sca.payloadTitle')}</CardTitle>
              <CardDescription>{t('wise.sca.payloadSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={scaJosePayload}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setScaJosePayload(event.target.value)}
                rows={6}
                placeholder="{ }"
                data-testid="textarea-sca-payload"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => runScaMutation.mutate('one-time-token')} data-testid="button-sca-ott">
                  {t('wise.sca.oneTimeToken')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/sessions')} data-testid="button-sca-sessions">
                  {t('wise.sca.sessions')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/pin')} data-testid="button-sca-pin">
                  {t('wise.sca.pin')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/pin/verify')} data-testid="button-sca-pin-verify">
                  {t('wise.sca.pinVerify')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runScaDeleteMutation.mutate('sca/pin')}
                  data-testid="button-sca-pin-delete"
                >
                  {t('wise.sca.pinDelete')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/device-fingerprint')} data-testid="button-sca-device">
                  {t('wise.sca.device')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/device-fingerprint/verify')} data-testid="button-sca-device-verify">
                  {t('wise.sca.deviceVerify')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runScaDeleteMutation.mutate('sca/device-fingerprint')}
                  data-testid="button-sca-device-delete"
                >
                  {t('wise.sca.deviceDelete')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/facemap')} data-testid="button-sca-facemap">
                  {t('wise.sca.facemap')}
                </Button>
                <Button onClick={() => runScaMutation.mutate('sca/facemap/verify')} data-testid="button-sca-facemap-verify">
                  {t('wise.sca.facemapVerify')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runScaDeleteMutation.mutate('sca/facemap')}
                  data-testid="button-sca-facemap-delete"
                >
                  {t('wise.sca.facemapDelete')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label>{t('wise.sca.response')}</Label>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                  {scaResponse ?? t('wise.sca.responseEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('wise.catalog.title')}</CardTitle>
              <CardDescription>{t('wise.catalog.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('wise.catalog.operation')}</Label>
                  <Select
                    value={catalogOperationId}
                    onValueChange={(value: string) => setCatalogOperationId(value)}
                  >
                    <SelectTrigger data-testid="select-catalog-operation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WISE_CATALOG_OPERATIONS.map((operation) => (
                        <SelectItem key={operation.id} value={operation.id}>
                          {t(operation.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t(catalogOperation.descriptionKey)}</p>
                </div>
                {catalogOperation.id === 'custom' && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.endpoint')}</Label>
                    <Input
                      value={catalogEndpoint}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCatalogEndpoint(event.target.value)}
                      placeholder="/api/integrations/wise/..."
                      data-testid="input-catalog-endpoint"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(catalogOperation.pathParams?.includes('profileId') || catalogOperation.queryParams?.includes('profileId')) && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.profileId')}</Label>
                    <Input
                      value={catalogParams.profileId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, profileId: event.target.value }))
                      }
                      placeholder="123456"
                      data-testid="input-catalog-profile-id"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('cardToken') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.cardToken')}</Label>
                    <Input
                      value={catalogParams.cardToken}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, cardToken: event.target.value }))
                      }
                      placeholder="card_token"
                      data-testid="input-catalog-card-token"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('disputeId') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.disputeId')}</Label>
                    <Input
                      value={catalogParams.disputeId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, disputeId: event.target.value }))
                      }
                      placeholder="dispute_id"
                      data-testid="input-catalog-dispute-id"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('transferId') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.transferId')}</Label>
                    <Input
                      value={catalogParams.transferId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, transferId: event.target.value }))
                      }
                      placeholder="transfer_id"
                      data-testid="input-catalog-transfer-id"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('kycReviewId') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.kycReviewId')}</Label>
                    <Input
                      value={catalogParams.kycReviewId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, kycReviewId: event.target.value }))
                      }
                      placeholder="kyc_review_id"
                      data-testid="input-catalog-kyc-review-id"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('subscriptionId') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.subscriptionId')}</Label>
                    <Input
                      value={catalogParams.subscriptionId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, subscriptionId: event.target.value }))
                      }
                      placeholder="subscription_id"
                      data-testid="input-catalog-subscription-id"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('action') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.action')}</Label>
                    <Input
                      value={catalogParams.action}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, action: event.target.value }))
                      }
                      placeholder="execute"
                      data-testid="input-catalog-action"
                    />
                  </div>
                )}
                {catalogOperation.pathParams?.includes('ruleId') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.ruleId')}</Label>
                    <Input
                      value={catalogParams.ruleId}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCatalogParams((prev) => ({ ...prev, ruleId: event.target.value }))
                      }
                      placeholder="rule_id"
                      data-testid="input-catalog-rule-id"
                    />
                  </div>
                )}
                {catalogOperation.queryParams?.includes('application') && (
                  <div className="space-y-2">
                    <Label>{t('wise.catalog.application')}</Label>
                    <Select
                      value={catalogParams.application}
                      onValueChange={(value: string) => setCatalogParams((prev) => ({ ...prev, application: value }))}
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
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('wise.catalog.payload')}</Label>
                <Textarea
                  value={catalogBody}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCatalogBody(event.target.value)}
                  placeholder="{ }"
                  rows={10}
                  data-testid="textarea-catalog-payload"
                />
                <p className="text-xs text-muted-foreground">{t('wise.catalog.payloadHint')}</p>
              </div>

              <div className="flex justify-between items-center gap-4">
                <Button onClick={handleRunCatalogOperation} disabled={catalogLoading} data-testid="button-catalog-run">
                  {catalogLoading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Layers className="h-4 w-4 mr-2" />
                  )}
                  {t('wise.catalog.run')}
                </Button>
                {catalogOperation.method && (
                  <Badge variant="outline">{catalogOperation.method}</Badge>
                )}
              </div>

              {catalogError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-semibold text-destructive">{t('wise.catalog.errors.title')}</p>
                  <p className="text-destructive">{catalogError}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('wise.catalog.response')}</Label>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-4 text-xs">
                  {catalogResponse ?? t('wise.catalog.responseEmpty')}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

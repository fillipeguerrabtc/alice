import {
  AlertCircle,
  ArrowLeftRight,
  Calculator,
  CheckCircle,
  FileText,
  FlaskConical,
  History,
  Layers,
  Send,
  ShieldCheck,
  Users,
  Wallet,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type WiseTabKey =
  | 'balances'
  | 'account-details'
  | 'exchange'
  | 'transfers'
  | 'recipients'
  | 'quotes'
  | 'batch'
  | 'statements'
  | 'profiles'
  | 'users'
  | 'activities'
  | 'cards'
  | 'card-orders'
  | 'card-transactions'
  | 'spend-controls'
  | 'spend-limits'
  | 'disputes'
  | 'kyc'
  | 'webhooks'
  | 'simulations'
  | 'sca'
  | 'catalog';

export type WiseWorkspaceKey = 'all' | 'treasury' | 'payments' | 'cards' | 'compliance' | 'operations';

export type WiseTabDescriptor = {
  value: WiseTabKey;
  testId: string;
  icon: LucideIcon;
  labelKey: string;
};

export const WISE_TAB_DESCRIPTORS: WiseTabDescriptor[] = [
  { value: 'balances', testId: 'tab-balances', icon: Wallet, labelKey: 'wise.balances.title' },
  { value: 'account-details', testId: 'tab-account-details', icon: FileText, labelKey: 'wise.accountDetails.title' },
  { value: 'exchange', testId: 'tab-exchange', icon: ArrowLeftRight, labelKey: 'wise.exchange.title' },
  { value: 'transfers', testId: 'tab-transfers', icon: Send, labelKey: 'wise.transfers.title' },
  { value: 'recipients', testId: 'tab-recipients', icon: Users, labelKey: 'wise.recipients.title' },
  { value: 'quotes', testId: 'tab-quotes', icon: Calculator, labelKey: 'wise.quotes.title' },
  { value: 'batch', testId: 'tab-batch', icon: Layers, labelKey: 'wise.batch.title' },
  { value: 'statements', testId: 'tab-statements', icon: FileText, labelKey: 'wise.history.title' },
  { value: 'profiles', testId: 'tab-profiles', icon: Users, labelKey: 'wise.profiles.title' },
  { value: 'users', testId: 'tab-users', icon: Users, labelKey: 'wise.users.title' },
  { value: 'activities', testId: 'tab-activities', icon: History, labelKey: 'wise.activities.title' },
  { value: 'cards', testId: 'tab-cards', icon: Wallet, labelKey: 'wise.cards.title' },
  { value: 'card-orders', testId: 'tab-card-orders', icon: FileText, labelKey: 'wise.cardOrders.title' },
  { value: 'card-transactions', testId: 'tab-card-transactions', icon: History, labelKey: 'wise.cardTransactions.title' },
  { value: 'spend-controls', testId: 'tab-spend-controls', icon: Layers, labelKey: 'wise.spendControls.title' },
  { value: 'spend-limits', testId: 'tab-spend-limits', icon: Layers, labelKey: 'wise.spendLimits.title' },
  { value: 'disputes', testId: 'tab-disputes', icon: AlertCircle, labelKey: 'wise.disputes.title' },
  { value: 'kyc', testId: 'tab-kyc', icon: CheckCircle, labelKey: 'wise.kyc.title' },
  { value: 'webhooks', testId: 'tab-webhooks', icon: Webhook, labelKey: 'wise.webhooks.title' },
  { value: 'simulations', testId: 'tab-simulations', icon: FlaskConical, labelKey: 'wise.simulations.title' },
  { value: 'sca', testId: 'tab-sca', icon: ShieldCheck, labelKey: 'wise.sca.title' },
  { value: 'catalog', testId: 'tab-catalog', icon: Layers, labelKey: 'wise.catalog.title' },
];

export const WISE_WORKSPACE_TABS: Record<WiseWorkspaceKey, WiseTabKey[]> = {
  all: WISE_TAB_DESCRIPTORS.map((tab) => tab.value),
  treasury: ['balances', 'account-details', 'exchange', 'statements', 'profiles', 'users', 'activities'],
  payments: ['transfers', 'recipients', 'quotes', 'batch'],
  cards: ['cards', 'card-orders', 'card-transactions', 'spend-controls', 'spend-limits', 'disputes'],
  compliance: ['kyc', 'webhooks', 'sca'],
  operations: ['simulations', 'catalog', 'activities'],
};

export const WISE_WORKSPACE_LABELS: Array<{ value: WiseWorkspaceKey; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'treasury', label: 'Tesouraria' },
  { value: 'payments', label: 'Pagamentos' },
  { value: 'cards', label: 'Cartões' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'operations', label: 'Operações' },
];

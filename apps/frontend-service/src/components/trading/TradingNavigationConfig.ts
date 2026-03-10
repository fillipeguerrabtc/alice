import { Activity, BarChart3, Brain, CandlestickChart, FileCheck, Hand, History, Layers, Target, Wallet, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TradingTabKey =
  | 'overview'
  | 'portfolio-auto'
  | 'signals-auto'
  | 'lab'
  | 'chart'
  | 'orderbook'
  | 'orders'
  | 'positions'
  | 'signals'
  | 'analysis'
  | 'history'
  | 'postmortems'
  | 'account'
  | 'control';

export type TradingWorkspaceKey =
  | 'all'
  | 'automation'
  | 'execution'
  | 'market'
  | 'account'
  | 'governance';

export type TradingTabDescriptor = {
  value: TradingTabKey;
  testId: string;
  icon: LucideIcon;
  labelKey?: string;
  fallbackLabel: string;
};

export const TRADING_TAB_DESCRIPTORS: TradingTabDescriptor[] = [
  { value: 'overview', testId: 'tab-overview', icon: BarChart3, labelKey: 'trading.tabs.overview', fallbackLabel: 'Visão geral' },
  { value: 'portfolio-auto', testId: 'tab-portfolio-auto', icon: Wallet, fallbackLabel: 'Portfólio (Auto)' },
  { value: 'signals-auto', testId: 'tab-signals-auto', icon: Brain, fallbackLabel: 'Sinais IA (Auto)' },
  { value: 'lab', testId: 'tab-lab', icon: FlaskConical, fallbackLabel: 'Lab/Research' },
  { value: 'chart', testId: 'tab-chart', icon: CandlestickChart, labelKey: 'trading.tabs.chart', fallbackLabel: 'Chart' },
  { value: 'orderbook', testId: 'tab-orderbook', icon: Layers, labelKey: 'trading.tabs.orderbook', fallbackLabel: 'Order Book' },
  { value: 'orders', testId: 'tab-orders', icon: Activity, labelKey: 'trading.tabs.orders', fallbackLabel: 'Ordens' },
  { value: 'positions', testId: 'tab-positions', icon: Target, labelKey: 'trading.tabs.positions', fallbackLabel: 'Posições' },
  { value: 'signals', testId: 'tab-signals', icon: Brain, labelKey: 'trading.tabs.signals', fallbackLabel: 'Sinais' },
  { value: 'analysis', testId: 'tab-analysis', icon: BarChart3, fallbackLabel: 'Análise' },
  { value: 'history', testId: 'tab-history', icon: History, labelKey: 'trading.tabs.history', fallbackLabel: 'Histórico' },
  { value: 'postmortems', testId: 'tab-postmortems', icon: FileCheck, fallbackLabel: 'Post-Mortems' },
  { value: 'account', testId: 'tab-account', icon: Wallet, labelKey: 'trading.tabs.account', fallbackLabel: 'Conta' },
  { value: 'control', testId: 'tab-control', icon: Hand, labelKey: 'trading.tabs.control', fallbackLabel: 'Controle' },
];

export const TRADING_WORKSPACE_TABS: Record<TradingWorkspaceKey, TradingTabKey[]> = {
  all: TRADING_TAB_DESCRIPTORS.map((tab) => tab.value),
  automation: ['portfolio-auto', 'signals-auto', 'lab', 'analysis'],
  execution: ['overview', 'orders', 'positions', 'signals', 'history', 'postmortems'],
  market: ['chart', 'orderbook', 'signals', 'analysis'],
  account: ['account', 'control'],
  governance: ['signals-auto', 'history', 'postmortems', 'control'],
};

export const TRADING_WORKSPACE_LABELS: Array<{
  value: TradingWorkspaceKey;
  labelKey?: string;
  fallbackLabel: string;
}> = [
  { value: 'all', fallbackLabel: 'Todos' },
  { value: 'automation', fallbackLabel: 'Automação' },
  { value: 'execution', fallbackLabel: 'Execução' },
  { value: 'market', fallbackLabel: 'Mercado' },
  { value: 'account', fallbackLabel: 'Conta & risco' },
  { value: 'governance', fallbackLabel: 'Governança' },
];

export function findWorkspaceForTradingTab(tab: TradingTabKey): TradingWorkspaceKey {
  if (TRADING_WORKSPACE_TABS.automation.includes(tab)) return 'automation';
  if (TRADING_WORKSPACE_TABS.market.includes(tab)) return 'market';
  if (TRADING_WORKSPACE_TABS.account.includes(tab)) return 'account';
  if (TRADING_WORKSPACE_TABS.governance.includes(tab)) return 'governance';
  return 'execution';
}

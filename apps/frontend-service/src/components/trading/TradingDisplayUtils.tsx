import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Hand,
  Pause,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type TradingSignalTypeOption = {
  color: string;
  icon: LucideIcon;
  label: string;
  value: string;
};

export const SIGNAL_TYPES: TradingSignalTypeOption[] = [
  { value: 'entry_long', label: 'Entrada Long', icon: TrendingUp, color: 'text-green-500' },
  { value: 'entry_short', label: 'Entrada Short', icon: TrendingDown, color: 'text-red-500' },
  { value: 'exit', label: 'Saída/Fechar', icon: XCircle, color: 'text-yellow-500' },
  { value: 'adjust_sl', label: 'Ajustar Stop Loss', icon: Shield, color: 'text-yellow-500' },
  { value: 'adjust_tp', label: 'Ajustar Take Profit', icon: Target, color: 'text-yellow-500' },
  { value: 'hold', label: 'Manter', icon: Pause, color: 'text-gray-500' },
  { value: 'neutral', label: 'Neutro', icon: Hand, color: 'text-muted-foreground' },
];

const ORDER_STATUS_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
  pending: { variant: 'secondary', icon: Clock },
  pending_review: { variant: 'secondary', icon: Clock },
  review_rejected: { variant: 'destructive', icon: XCircle },
  submitted: { variant: 'outline', icon: Activity },
  open: { variant: 'outline', icon: Activity },
  filled: { variant: 'default', icon: CheckCircle },
  cancelled: { variant: 'destructive', icon: XCircle },
  rejected: { variant: 'destructive', icon: AlertCircle },
  expired: { variant: 'secondary', icon: Clock },
  error: { variant: 'destructive', icon: AlertCircle },
};

export function SignalTypeBadge({ type }: { type: string }) {
  const config = SIGNAL_TYPES.find((signalType) => signalType.value === type);
  if (!config) return <Badge variant="outline">{type}</Badge>;

  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} border-current`}>
      <Icon className="mr-1 h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const config = ORDER_STATUS_BADGES[status] || { variant: 'outline' as const, icon: Activity };
  const Icon = config.icon;

  return (
    <Badge variant={config.variant}>
      <Icon className="mr-1 h-3 w-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function formatDecisionValue(value: unknown, depth = 0): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 4).map((entry) => formatDecisionValue(entry, depth + 1));
    return `${items.join(', ')}${value.length > 4 ? '…' : ''}`;
  }
  if (typeof value === 'object') {
    if (depth > 1) {
      const keys = Object.keys(value as Record<string, unknown>);
      return keys.length > 0 ? keys.slice(0, 4).join(', ') : '—';
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 4);
    if (entries.length === 0) return '—';
    return entries.map(([key, entry]) => `${key}: ${formatDecisionValue(entry, depth + 1)}`).join(', ');
  }
  return String(value);
}

export function formatDecisionSummary(payload?: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined).slice(0, 4);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${formatDecisionValue(value)}`).join(' • ');
}

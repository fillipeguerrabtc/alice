import { Activity, AlertTriangle, CheckCircle2, Radio, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type TradingWorkspaceOperateStatusCardProps = {
  circuitBreakerFailures: number;
  circuitBreakerState: string;
  engineHealth: 'healthy' | 'degraded' | 'offline';
  riskMode: string;
  wsConnecting: boolean;
  wsEnabled: boolean;
  wsHealthy: boolean;
};

function resolveEngineBadgeVariant(health: TradingWorkspaceOperateStatusCardProps['engineHealth']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (health === 'healthy') return 'default';
  if (health === 'degraded') return 'secondary';
  return 'destructive';
}

function resolveCircuitBreakerVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = state.toLowerCase();
  if (normalized === 'closed') return 'default';
  if (normalized === 'half_open') return 'secondary';
  if (normalized === 'open') return 'destructive';
  return 'outline';
}

export function TradingWorkspaceOperateStatusCard({
  circuitBreakerFailures,
  circuitBreakerState,
  engineHealth,
  riskMode,
  wsConnecting,
  wsEnabled,
  wsHealthy,
}: TradingWorkspaceOperateStatusCardProps) {
  const websocketLabel = !wsEnabled
    ? 'disabled'
    : wsHealthy
      ? 'connected'
      : wsConnecting
        ? 'connecting'
        : 'offline';

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">WebSocket</span>
        </div>
        <Badge variant={wsHealthy ? 'default' : wsConnecting ? 'secondary' : 'outline'}>{websocketLabel}</Badge>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          {engineHealth === 'healthy' ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : engineHealth === 'degraded' ? (
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-red-500" />
          )}
          <span className="text-muted-foreground">Engine health</span>
        </div>
        <Badge variant={resolveEngineBadgeVariant(engineHealth)}>{engineHealth}</Badge>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Risk mode</span>
        </div>
        <span className="font-medium">{riskMode}</span>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Circuit breaker</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={resolveCircuitBreakerVariant(circuitBreakerState)}>{circuitBreakerState}</Badge>
          {circuitBreakerFailures > 0 ? (
            <Badge variant="destructive">{circuitBreakerFailures} falhas</Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

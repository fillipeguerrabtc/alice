/**
 * ActionResultCard - Resultado de ações agentic inline no chat
 *
 * Exibe resumo, status e payload de resultado (redigido no backend).
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronDown, ChevronUp } from 'lucide-react';

type ActionResultCardProps = {
  actionType?: string;
  actionOperation?: string;
  actionSummary?: string;
  actionStatus?: string;
  actionResult?: Record<string, unknown>;
};

const STATUS_VARIANTS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-emerald-500/10 text-emerald-600',
  rejected: 'bg-red-500/10 text-red-600',
  executed: 'bg-emerald-500/10 text-emerald-600',
  failed: 'bg-red-500/10 text-red-600',
};

export function ActionResultCard({
  actionType,
  actionOperation,
  actionSummary,
  actionStatus,
  actionResult,
}: ActionResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = Boolean(actionResult && Object.keys(actionResult).length > 0);
  const statusLabel = actionStatus ?? 'pending';
  const resultEntries = hasResult ? Object.entries(actionResult ?? {}) : [];
  const formatValue = (value: unknown) => {
    if (value == null) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <Card className="mt-3 border bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">
            {actionType || 'agentic'} {actionOperation ? `• ${actionOperation}` : ''}
          </div>
          <div className="text-sm font-medium">
            {actionSummary || 'Ação agentic'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_VARIANTS[statusLabel] || 'bg-muted text-muted-foreground'}>
            {statusLabel}
          </Badge>
          {hasResult && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded((prev) => !prev)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>
      {expanded && hasResult && (
        <div className="mt-3 space-y-2 text-[11px]">
          {resultEntries.map(([key, value]) => (
            <div key={key} className="rounded bg-muted/50 p-2">
              <div className="text-xs uppercase text-muted-foreground">{key}</div>
              <div className="whitespace-pre-wrap break-words">{formatValue(value)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Painel de eventos em tempo real (Agentic Streaming)
 */

import { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Filter, Search } from 'lucide-react';
import type { AgentEvent } from './types';

interface EventsPanelProps {
  events: AgentEvent[];
  isStreaming: boolean;
  onClear: () => void;
}

const STATUS_VARIANTS: Record<AgentEvent['status'], string> = {
  start: 'bg-blue-500/10 text-blue-600',
  in_progress: 'bg-blue-500/10 text-blue-600',
  success: 'bg-emerald-500/10 text-emerald-600',
  error: 'bg-red-500/10 text-red-600',
  skipped: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-emerald-500/10 text-emerald-600',
  rejected: 'bg-red-500/10 text-red-600',
};

export function EventsPanel({ events, isStreaming, onClear }: EventsPanelProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phaseFilter, setPhaseFilter] = useState<'all' | AgentEvent['phase']>('all');

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (phaseFilter !== 'all' && event.phase !== phaseFilter) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        event.action,
        event.status,
        event.message,
        JSON.stringify(event.payload ?? {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [events, phaseFilter, query]);

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <div className="border-b p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Eventos</Badge>
            {isStreaming && <Badge className="bg-emerald-500/10 text-emerald-600">Ao vivo</Badge>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Limpar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar eventos"
            className="h-8"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'planning', 'tool', 'approval', 'execution', 'llm', 'finalizing', 'system'] as const).map((phase) => (
              <Button
                key={phase}
                variant={phaseFilter === phase ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setPhaseFilter(phase)}
              >
                {phase}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filteredEvents.length === 0 && (
            <div className="text-xs text-muted-foreground">Nenhum evento para exibir.</div>
          )}
          {filteredEvents.map((event) => {
            const isOpen = expanded.has(event.id);
            return (
              <div key={event.id} className="rounded-md border p-2 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {event.phase}
                      </Badge>
                      <span className="font-medium">{event.message || event.action}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(event.ts).toLocaleTimeString()} • {event.action}
                      {typeof event.durationMs === 'number' ? ` • ${event.durationMs}ms` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_VARIANTS[event.status] || ''}`}>
                      {event.status}
                    </span>
                    {event.payload && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleExpanded(event.id)}>
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>
                {isOpen && event.payload && (
                  <pre className="rounded bg-muted/50 p-2 text-[10px] whitespace-pre-wrap">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

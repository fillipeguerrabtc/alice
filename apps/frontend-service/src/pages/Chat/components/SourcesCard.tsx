import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { MessageSources } from './types';

interface SourcesCardProps {
  sources: MessageSources;
}

const PREVIEW_WEB_SOURCES = 4;

export function SourcesCard({ sources }: SourcesCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const webSources = sources.web ?? [];
  const internalSources = sources.internal ?? [];

  if (webSources.length === 0 && internalSources.length === 0) {
    return null;
  }

  const totalSources = webSources.length + internalSources.length;
  const previewWebSources = webSources.slice(0, PREVIEW_WEB_SOURCES);
  const hasMoreWebSources = webSources.length > PREVIEW_WEB_SOURCES;
  const hasDetails = hasMoreWebSources || internalSources.length > 0;

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">Fontes</p>
        <Badge variant="outline" className="h-5 px-2 text-[10px]">
          {totalSources}
        </Badge>
      </div>

      {previewWebSources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {previewWebSources.map((source, index) => (
            <a
              key={`${source.url}-${index}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/5"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{source.title || source.url}</span>
            </a>
          ))}
        </div>
      )}

      {hasDetails && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-full justify-between px-2 text-[11px] text-muted-foreground">
              Ver detalhes das fontes
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {hasMoreWebSources && (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Web</p>
                {webSources.slice(PREVIEW_WEB_SOURCES).map((source, index) => (
                  <a
                    key={`${source.url}-detail-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{source.title || source.url}</span>
                  </a>
                ))}
              </div>
            )}

            {internalSources.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Interno</p>
                {internalSources.map((source, index) => (
                  <div key={`${source.documentId}-${index}`} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{source.titulo || source.documentId}</span>
                    <span className="mx-1">|</span>
                    <span>{source.documentId}</span>
                    {typeof source.similarity === 'number' && (
                      <>
                        <span className="mx-1">|</span>
                        <span>{(source.similarity * 100).toFixed(1)}%</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

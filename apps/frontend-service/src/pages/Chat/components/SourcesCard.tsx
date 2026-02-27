import { ExternalLink } from 'lucide-react';
import type { MessageSources } from './types';

interface SourcesCardProps {
  sources: MessageSources;
}

export function SourcesCard({ sources }: SourcesCardProps) {
  const webSources = sources.web ?? [];
  const internalSources = sources.internal ?? [];

  if (webSources.length === 0 && internalSources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3 text-xs">
      <p className="font-medium text-foreground">Fontes</p>

      {webSources.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Web</p>
          {webSources.map((source, index) => (
            <a
              key={`${source.url}-${index}`}
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
        <div className="mt-2 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Interno</p>
          {internalSources.map((source, index) => (
            <div key={`${source.documentId}-${index}`} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{source.titulo || source.documentId}</span>
              <span className="mx-1">•</span>
              <span>{source.documentId}</span>
              {typeof source.similarity === 'number' && (
                <>
                  <span className="mx-1">•</span>
                  <span>{(source.similarity * 100).toFixed(1)}%</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import type { InternalSourceReference, MessageSources } from './components/types';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeWebSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseMessageSources(rawSources: unknown): MessageSources | null {
  if (!isObjectRecord(rawSources)) {
    return null;
  }

  const rawWeb = Array.isArray(rawSources.web) ? rawSources.web : [];
  const rawInternal = Array.isArray(rawSources.internal) ? rawSources.internal : [];

  const web: MessageSources['web'] = rawWeb
    .map((item) => {
      if (!isObjectRecord(item)) return null;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const url = typeof item.url === 'string' ? normalizeWebSourceUrl(item.url) : null;
      if (!url) return null;
      return {
        title: title.length > 0 ? title : url,
        url,
      };
    })
    .filter((item): item is MessageSources['web'][number] => item !== null);

  const internalCandidates: Array<InternalSourceReference | null> = rawInternal
    .map((item) => {
      if (!isObjectRecord(item)) return null;
      const documentId = typeof item.documentId === 'string' ? item.documentId.trim() : '';
      if (!documentId) return null;
      return {
        documentId,
        titulo: typeof item.titulo === 'string' && item.titulo.trim().length > 0 ? item.titulo.trim() : undefined,
        similarity: typeof item.similarity === 'number' ? item.similarity : undefined,
      };
    });

  const internal: MessageSources['internal'] = internalCandidates
    .filter((item): item is InternalSourceReference => item !== null);

  if (web.length === 0 && internal.length === 0) {
    return null;
  }

  return { web, internal };
}

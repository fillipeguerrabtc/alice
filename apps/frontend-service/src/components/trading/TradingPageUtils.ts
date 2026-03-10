export function getQuoteCurrencyFromSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const parts = symbol.split('-');
  if (parts.length < 2) return null;
  return parts[1] ?? null;
}

export function getBaseCurrencyFromSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const parts = symbol.split('-');
  if (parts.length < 2) return null;
  return parts[0] ?? null;
}

export function formatDurationMinutes(minutes?: number): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type LocaleOptions = {
  locale?: string | null;
  timeZone?: string | null;
};

function resolveLocale(locale?: string | null): string {
  const normalized = locale?.trim();
  return normalized || 'pt-BR';
}

function resolveTimeZone(timeZone?: string | null): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function formatDate(date: Date | string | number, options?: LocaleOptions): string {
  const locale = resolveLocale(options?.locale);
  const timeZone = resolveTimeZone(options?.timeZone);
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
}

export function formatDateTime(date: Date | string | number, options?: LocaleOptions): string {
  const locale = resolveLocale(options?.locale);
  const timeZone = resolveTimeZone(options?.timeZone);
  return new Date(date).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

export function formatNumber(
  num: number,
  locale?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(num);
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'currency',
    currency,
    ...options,
  }).format(amount);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

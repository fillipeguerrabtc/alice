import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TIMEZONE } from '@/lib/i18n';

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
  if (!timeZone) return TIMEZONE;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return TIMEZONE;
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

/**
 * Normaliza texto numérico para formato canônico com ponto decimal.
 * Aceita entrada com vírgula ou ponto e ignora separador de milhar.
 * Ex.: "12.345,67" -> "12345.67", "12,345.67" -> "12345.67"
 */
export function normalizeNumericInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const sanitized = trimmed.replace(/\s+/g, '');
  const lastComma = sanitized.lastIndexOf(',');
  const lastDot = sanitized.lastIndexOf('.');
  const decimalPos = Math.max(lastComma, lastDot);

  if (decimalPos < 0) {
    return sanitized.replace(/[.,]/g, '');
  }

  const integerPart = sanitized.slice(0, decimalPos).replace(/[.,]/g, '');
  const decimalPart = sanitized.slice(decimalPos + 1).replace(/[.,]/g, '');
  if (!decimalPart) return integerPart;
  return `${integerPart}.${decimalPart}`;
}

export function parseLocaleNumberInput(value: string): number | null {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTradingNumber(
  value: number,
  locale?: string | null,
  minimumFractionDigits = 2,
  maximumFractionDigits = 8
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const decimals = step.toString().includes('.') ? step.toString().split('.')[1]?.length ?? 0 : 0;
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(Math.min(decimals + 2, 12)));
}

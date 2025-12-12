/**
 * Utilitário compartilhado para resolver/validar CLIP_SERVICE_URL.
 *
 * Motivo:
 * - Evitar duplicação e inconsistência entre módulos (Regra 2 - Não duplicar).
 * - Fail-fast em produção (Regra 6) de forma consistente via exception (não process.exit).
 *
 * Autor: Fillipe Guerra
 * Data: 12 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

export interface LoggerLike {
  error: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

const DEFAULT_CLIP_SERVICE_URL = 'http://alice-clip-inference:8080';

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function tryParseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveClipServiceUrl(logger: LoggerLike): string {
  const raw = process.env.CLIP_SERVICE_URL;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  if (!trimmed) return DEFAULT_CLIP_SERVICE_URL;

  // Aceitar URL completa. Se vier sem esquema (ex: alice-clip-inference:8080), normalizar para http://...
  const parsed =
    tryParseHttpUrl(trimmed) ?? (!trimmed.includes('://') ? tryParseHttpUrl(`http://${trimmed}`) : null);

  if (!parsed) {
    const msg = `CLIP_SERVICE_URL inválida: "${trimmed}". Esperado URL http(s) válida (ex: ${DEFAULT_CLIP_SERVICE_URL}).`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ envVar: 'CLIP_SERVICE_URL', value: trimmed }, msg);
      throw new Error(msg);
    }
    logger.warn({ envVar: 'CLIP_SERVICE_URL', value: trimmed }, `${msg} Usando padrão: ${DEFAULT_CLIP_SERVICE_URL}`);
    return DEFAULT_CLIP_SERVICE_URL;
  }

  // Se normalizamos por falta de esquema, registrar aviso (sem bloquear).
  if (!trimmed.includes('://')) {
    logger.warn(
      { envVar: 'CLIP_SERVICE_URL', value: trimmed, normalized: normalizeUrl(parsed.toString()) },
      'CLIP_SERVICE_URL sem esquema (http/https). Normalizando para http://...'
    );
  }

  return normalizeUrl(parsed.toString());
}


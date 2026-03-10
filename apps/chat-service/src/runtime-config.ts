import { getServiceUrl } from '@alice/config';
import { ProxyAgent } from 'undici';

type LoggerLike = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};

type ParseEnvInt = (value: string | undefined, defaultValue: number, name: string) => number;

type ChatRuntimeConfigParams = {
  logger: LoggerLike;
  parseEnvInt: ParseEnvInt;
};

type ChatRuntimeConfig = {
  PORT: string | number;
  CORS_ORIGINS: string[];
  OPENAI_API_KEY: string | undefined;
  OPENAI_VISION_MAX_BYTES: number | null;
  APP_VERSION: string | null;
  LLM_GATEWAY_URL: string | null;
  INTERNAL_API_SECRET: string;
  WEB_IMAGE_SEARCH_MAX_RESULTS: number;
  WEB_IMAGE_MAX_BYTES: number;
  INTEGRATIONS_SERVICE_URL_FINAL: string;
  TRAINING_SERVICE_URL_FINAL: string;
  withOpenAiDispatcher: (init: RequestInit) => RequestInit;
};

function failFast(message: string): never {
  process.exit(1);
  throw new Error(message);
}

function isNoProxyMatch(hostname: string, entry: string): boolean {
  if (entry === '*') return true;
  if (entry.startsWith('.')) return hostname.endsWith(entry);
  if (hostname === entry) return true;
  return hostname.endsWith(`.${entry}`);
}

function shouldBypassProxy(hostname: string, entries: string[]): boolean {
  if (!entries.length) return false;
  return entries.some((entry) => isNoProxyMatch(hostname, entry));
}

export function createChatEnvParsers(logger: LoggerLike) {
  function parseEnvInt(value: string | undefined, defaultValue: number, name: string): number {
    const raw = (value ?? String(defaultValue)).trim();
    if (!/^\d+$/.test(raw)) {
      const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
      if (process.env.NODE_ENV === 'production') {
        logger.error({ name, raw }, message);
        throw new Error(message);
      }
      logger.warn({ name, raw, defaultValue }, `${message} Usando valor padrão.`);
      return defaultValue;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
      if (process.env.NODE_ENV === 'production') {
        logger.error({ name, raw, parsed }, message);
        throw new Error(message);
      }
      logger.warn({ name, raw, parsed, defaultValue }, `${message} Usando valor padrão.`);
      return defaultValue;
    }
    return parsed;
  }

  function parseEnvNonNegativeInt(value: string | undefined, defaultValue: number, name: string): number {
    const raw = (value ?? String(defaultValue)).trim();
    if (!/^\d+$/.test(raw)) {
      const message = `${name} inválido: "${raw}". Deve ser inteiro >= 0.`;
      if (process.env.NODE_ENV === 'production') {
        logger.error({ name, raw }, message);
        throw new Error(message);
      }
      logger.warn({ name, raw, defaultValue }, `${message} Usando valor padrão.`);
      return defaultValue;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      const message = `${name} inválido: "${raw}". Deve ser inteiro >= 0.`;
      if (process.env.NODE_ENV === 'production') {
        logger.error({ name, raw, parsed }, message);
        throw new Error(message);
      }
      logger.warn({ name, raw, parsed, defaultValue }, `${message} Usando valor padrão.`);
      return defaultValue;
    }
    return parsed;
  }

  return { parseEnvInt, parseEnvNonNegativeInt };
}

export function loadChatRuntimeConfig(params: ChatRuntimeConfigParams): ChatRuntimeConfig {
  const { logger, parseEnvInt } = params;

  const PORT = process.env.PORT || 3002;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('DATABASE_URL não configurada');
    failFast('DATABASE_URL não configurada');
  }

  const corsOriginsEnv = process.env.CORS_ORIGINS;
  if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
    logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
    failFast('CORS_ORIGINS é obrigatório em produção');
  }
  const CORS_ORIGINS = corsOriginsEnv
    ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
    logger.error('OPENAI_API_KEY é obrigatório em produção (Vision + geração de imagens via OpenAI)');
    failFast('OPENAI_API_KEY é obrigatório em produção');
  }

  const OPENAI_PROXY = process.env.OPENAI_PROXY ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null;
  const OPENAI_NO_PROXY = process.env.NO_PROXY ?? process.env.no_proxy ?? null;
  const OPENAI_NO_PROXY_ENTRIES = OPENAI_NO_PROXY
    ? OPENAI_NO_PROXY.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [];
  const OPENAI_HOSTNAME = 'api.openai.com';

  const OPENAI_PROXY_URL = (() => {
    if (!OPENAI_PROXY) return null;
    try {
      return new URL(OPENAI_PROXY).toString();
    } catch (error) {
      logger.error({ error, value: OPENAI_PROXY }, 'OPENAI_PROXY inválido - URL malformada');
      failFast('OPENAI_PROXY inválido');
    }
  })();

  const openAiDispatcher = (() => {
    if (!OPENAI_PROXY_URL) return undefined;
    if (shouldBypassProxy(OPENAI_HOSTNAME, OPENAI_NO_PROXY_ENTRIES)) {
      logger.info({ hostname: OPENAI_HOSTNAME }, 'OpenAI sem proxy (NO_PROXY aplicado)');
      return undefined;
    }
    logger.info({ proxy: OPENAI_PROXY_URL }, 'OpenAI configurado com proxy');
    return new ProxyAgent(OPENAI_PROXY_URL) as unknown;
  })();

  const withOpenAiDispatcher = (init: RequestInit): RequestInit => {
    if (!openAiDispatcher) return init;
    return { ...init, dispatcher: openAiDispatcher } as unknown as RequestInit;
  };

  const OPENAI_VISION_MAX_BYTES = (() => {
    const raw = process.env.OPENAI_VISION_MAX_BYTES;
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.error({ value: raw }, 'OPENAI_VISION_MAX_BYTES inválido - precisa ser número > 0');
      failFast('OPENAI_VISION_MAX_BYTES inválido');
    }
    return parsed;
  })();

  const APP_VERSION = process.env.APP_VERSION?.trim() || null;
  const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL?.trim() || null;
  const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
  const WEB_IMAGE_SEARCH_MAX_RESULTS = parseEnvInt(
    process.env.WEB_IMAGE_SEARCH_MAX_RESULTS,
    3,
    'WEB_IMAGE_SEARCH_MAX_RESULTS'
  );
  const WEB_IMAGE_MAX_BYTES = parseEnvInt(
    process.env.WEB_IMAGE_MAX_BYTES,
    8 * 1024 * 1024,
    'WEB_IMAGE_MAX_BYTES'
  );

  const INTEGRATIONS_SERVICE_URL_FINAL = getServiceUrl('integrations');
  const TRAINING_SERVICE_URL_FINAL = getServiceUrl('training');

  return {
    PORT,
    CORS_ORIGINS,
    OPENAI_API_KEY,
    OPENAI_VISION_MAX_BYTES,
    APP_VERSION,
    LLM_GATEWAY_URL,
    INTERNAL_API_SECRET,
    WEB_IMAGE_SEARCH_MAX_RESULTS,
    WEB_IMAGE_MAX_BYTES,
    INTEGRATIONS_SERVICE_URL_FINAL,
    TRAINING_SERVICE_URL_FINAL,
    withOpenAiDispatcher,
  };
}

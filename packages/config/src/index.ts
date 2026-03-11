import { z } from 'zod';
import { createLogger } from '@alice/logger';

const configLogger = createLogger('config');

export const LLM_PUBLIC_MODEL_DEFAULT = 'Qwen3-8B';
export const LLM_SERVING_MODEL_ID_DEFAULT = 'Qwen/Qwen3-8B-AWQ';
export const LLM_TRAINING_BASE_MODEL_ID_DEFAULT = 'Qwen/Qwen3-8B';
export const EMBEDDINGS_MODEL_ID_DEFAULT = 'Qwen/Qwen3-Embedding-0.6B';

export const REASONING_MODE_VALUES = ['auto', 'thinking', 'non_thinking'] as const;
export type ReasoningMode = (typeof REASONING_MODE_VALUES)[number];
const reasoningModeSchema = z.enum(REASONING_MODE_VALUES);

const nodeEnvSchema = z.enum(['development', 'production', 'test']).default('development');
const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith('http://') || value.startsWith('https://'),
  'URL deve usar protocolo http:// ou https://'
);

export type RuntimeNodeEnv = z.infer<typeof nodeEnvSchema>;
export type EnvSource = Record<string, string | undefined>;

const baseConfigSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const authConfigSchema = z.object({
  SESSION_SECRET: z.string().min(32),
  REPLIT_DOMAINS: z.string().optional(),
  ISSUER_URL: z.string().url().optional(),
  // OAuth Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // OAuth GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_GITHUB_CLIENT_ID: z.string().optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
  // SAML 2.0
  SAML_ENTRY_POINT: z.string().url().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CERT: z.string().optional(),
});

const llmConfigSchema = z.object({
  // GPU Manager Service (Hetzner GEX44) - GPU dedicada 24/7
  // Gate 2: LLM (texto) separado de Vision (OpenAI). Este schema reflete o LLM default (texto).
  LLM_MODEL: z.string().default(LLM_PUBLIC_MODEL_DEFAULT),
  LLM_REASONING_MODE: reasoningModeSchema.default('auto'),
  // Gate 2: coerente com max-model-len padrão do stack (2048)
  LLM_MAX_TOKENS: z.coerce.number().default(2048),
  LLM_TEMPERATURE: z.coerce.number().default(0.7),
});

const stripeConfigSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

const wiseConfigSchema = z.object({
  WISE_API_KEY: z.string().optional(),
  WISE_PROFILE_ID: z.string().optional(),
  WISE_SANDBOX: z.string().optional(),
  WISE_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  WISE_CLIENT_ID: z.string().optional(),
  WISE_CLIENT_SECRET: z.string().optional(),
  WISE_CLIENT_KEY: z.string().optional(),
  WISE_REDIRECT_URI: z.string().url().optional(),
});

const githubActionsConfigSchema = z.object({
  GH_PAT: z.string().optional(),
  GH_REPO: z.string().optional(),
  GH_API_URL: z.string().url().optional(),
});

const observabilityConfigSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  GRAFANA_LOKI_USER: z.string().optional(),
  GRAFANA_LOKI_API_KEY: z.string().optional(),
});

const grafanaConfigSchema = z.object({
  GRAFANA_URL: z.string().url().optional(),
  GRAFANA_ADMIN_USER: z.string().optional(),
  GRAFANA_ADMIN_PASSWORD: z.string().optional(),
  GRAFANA_API_KEY: z.string().optional(),
});

export const authServiceConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(authConfigSchema);

export const chatServiceConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(llmConfigSchema);

export const ragServiceConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema);

export const trainingServiceConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(llmConfigSchema);

export const integrationsServiceConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(stripeConfigSchema)
  .merge(wiseConfigSchema)
  .merge(githubActionsConfigSchema)
  .merge(grafanaConfigSchema);

export const fullConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(authConfigSchema)
  .merge(llmConfigSchema)
  .merge(stripeConfigSchema)
  .merge(wiseConfigSchema)
  .merge(githubActionsConfigSchema)
  .merge(observabilityConfigSchema)
  .merge(grafanaConfigSchema);

export type BaseConfig = z.infer<typeof baseConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type LLMConfig = z.infer<typeof llmConfigSchema>;
export type StripeConfig = z.infer<typeof stripeConfigSchema>;
export type GitHubActionsConfig = z.infer<typeof githubActionsConfigSchema>;
export type ObservabilityConfig = z.infer<typeof observabilityConfigSchema>;
export type FullConfig = z.infer<typeof fullConfigSchema>;

function getEnvSource(env?: EnvSource): EnvSource {
  return env ?? (process.env as EnvSource);
}

export function loadConfig<T>(schema: z.ZodSchema<T>, env?: EnvSource): T {
  const envSource = getEnvSource(env);
  const result = schema.safeParse(envSource);

  if (!result.success) {
    const formattedErrors = result.error.format();
    configLogger.error({ errors: formattedErrors }, 'Falha na validação de configuração');
    throw new Error(`Falha na validação de configuração: ${JSON.stringify(formattedErrors)}`);
  }

  return result.data;
}

export function getNodeEnv(env?: EnvSource): RuntimeNodeEnv {
  const envSource = getEnvSource(env);
  return nodeEnvSchema.parse(envSource.NODE_ENV);
}

export function isProductionEnv(env?: EnvSource): boolean {
  return getNodeEnv(env) === 'production';
}

export function readOptionalStringEnv(key: string, env?: EnvSource): string | null {
  const envSource = getEnvSource(env);
  const rawValue = envSource[key];
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmedValue = rawValue.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function readRequiredStringEnv(key: string, env?: EnvSource): string {
  const value = readOptionalStringEnv(key, env);
  if (!value) {
    throw new Error(`Variável de ambiente ${key} é obrigatória (Regra 6 - fail-fast)`);
  }
  return value;
}

export function readNumberEnv(
  key: string,
  options?: {
    defaultValue?: number;
    min?: number;
    max?: number;
    integer?: boolean;
    env?: EnvSource;
  }
): number {
  const envSource = getEnvSource(options?.env);
  const rawValue = envSource[key];
  const defaultValue = options?.defaultValue;

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    if (typeof defaultValue === 'number') {
      return defaultValue;
    }
    throw new Error(`Variável de ambiente ${key} é obrigatória (Regra 6 - fail-fast)`);
  }

  const parsedValue = Number(rawValue.trim());
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Variável de ambiente ${key} inválida: deve ser número`);
  }

  if (options?.integer && !Number.isInteger(parsedValue)) {
    throw new Error(`Variável de ambiente ${key} inválida: deve ser número inteiro`);
  }

  if (typeof options?.min === 'number' && parsedValue < options.min) {
    throw new Error(`Variável de ambiente ${key} inválida: deve ser >= ${options.min}`);
  }

  if (typeof options?.max === 'number' && parsedValue > options.max) {
    throw new Error(`Variável de ambiente ${key} inválida: deve ser <= ${options.max}`);
  }

  return parsedValue;
}

export function readBooleanEnv(
  key: string,
  options?: {
    defaultValue?: boolean;
    env?: EnvSource;
  }
): boolean {
  const envSource = getEnvSource(options?.env);
  const rawValue = envSource[key];

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    if (typeof options?.defaultValue === 'boolean') {
      return options.defaultValue;
    }
    throw new Error(`Variável de ambiente ${key} é obrigatória (Regra 6 - fail-fast)`);
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === 'true') return true;
  if (normalizedValue === 'false') return false;

  throw new Error(`Variável de ambiente ${key} inválida: use apenas "true" ou "false"`);
}

function isValidHttpOrigin(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCsvValues(raw: string): string[] {
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveBaseUrl(options?: {
  env?: EnvSource;
  requiredInProduction?: boolean;
  developmentFallback?: string;
}): string {
  const envSource = getEnvSource(options?.env);
  const baseUrl = readOptionalStringEnv('BASE_URL', envSource);

  if (baseUrl) {
    const validationResult = httpUrlSchema.safeParse(baseUrl);
    if (!validationResult.success) {
      throw new Error('Variável de ambiente BASE_URL inválida: URL HTTP/HTTPS obrigatória');
    }
    return normalizeBaseUrl(validationResult.data);
  }

  if ((options?.requiredInProduction ?? true) && isProductionEnv(envSource)) {
    throw new Error('BASE_URL é obrigatório em produção (Regra 6 - fail-fast)');
  }

  const fallback = options?.developmentFallback ?? 'http://localhost:5000';
  const fallbackValidation = httpUrlSchema.safeParse(fallback);
  if (!fallbackValidation.success) {
    throw new Error(`Fallback de BASE_URL inválido: ${fallback}`);
  }

  return normalizeBaseUrl(fallbackValidation.data);
}

export function resolveTenantDomain(options?: {
  env?: EnvSource;
  requiredInProduction?: boolean;
  developmentFallback?: string;
}): string {
  const envSource = getEnvSource(options?.env);
  const explicitDomain = readOptionalStringEnv('PRODUCTION_DOMAIN', envSource);
  if (explicitDomain) {
    return explicitDomain;
  }

  const baseUrl = readOptionalStringEnv('BASE_URL', envSource);
  if (baseUrl) {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      throw new Error('Variável de ambiente BASE_URL inválida para resolver domínio de tenant');
    }
  }

  if ((options?.requiredInProduction ?? false) && isProductionEnv(envSource)) {
    throw new Error('PRODUCTION_DOMAIN ou BASE_URL são obrigatórios em produção para domínio do tenant');
  }

  return options?.developmentFallback ?? 'localhost';
}

export function resolveCorsOrigins(options?: {
  env?: EnvSource;
  requiredInProduction?: boolean;
  developmentFallback?: string[];
}): string[] {
  const envSource = getEnvSource(options?.env);
  const requiredInProduction = options?.requiredInProduction ?? true;

  const corsOrigin = readOptionalStringEnv('CORS_ORIGIN', envSource);
  const corsOriginsRaw = readOptionalStringEnv('CORS_ORIGINS', envSource);

  const combinedOrigins = [
    ...(corsOrigin ? [corsOrigin] : []),
    ...(corsOriginsRaw ? parseCsvValues(corsOriginsRaw) : []),
  ];

  const deduplicatedOrigins = [...new Set(combinedOrigins)];
  const invalidOrigin = deduplicatedOrigins.find((origin) => !isValidHttpOrigin(origin));
  if (invalidOrigin) {
    throw new Error(`CORS origin inválida: ${invalidOrigin}`);
  }

  if (deduplicatedOrigins.length > 0) {
    return deduplicatedOrigins;
  }

  if (requiredInProduction && isProductionEnv(envSource)) {
    throw new Error('CORS_ORIGIN ou CORS_ORIGINS são obrigatórios em produção (Regra 6 - fail-fast)');
  }

  if (options?.developmentFallback && options.developmentFallback.length > 0) {
    return [...options.developmentFallback];
  }

  return [];
}

const SERVICE_URL_ENV_KEYS = {
  auth: 'AUTH_SERVICE_URL',
  chat: 'CHAT_SERVICE_URL',
  rag: 'RAG_SERVICE_URL',
  training: 'TRAINING_SERVICE_URL',
  integrations: 'INTEGRATIONS_SERVICE_URL',
  observability: 'OBSERVABILITY_SERVICE_URL',
  llmGateway: 'LLM_GATEWAY_URL',
  gpuManager: 'GPU_MANAGER_URL',
  biometrics: 'BIOMETRICS_SERVICE_URL',
  apiGateway: 'API_GATEWAY_URL',
  frontend: 'FRONTEND_SERVICE_URL',
} as const;

export type InternalServiceName = keyof typeof SERVICE_URL_ENV_KEYS;

type ServiceRef = {
  envKey: string;
  value: string | null;
};

function resolveServiceRef(serviceName: string, env?: EnvSource): ServiceRef {
  const envKey = SERVICE_URL_ENV_KEYS[serviceName as InternalServiceName];

  if (!envKey) {
    throw new Error(`Serviço interno desconhecido: ${serviceName}`);
  }

  return {
    envKey,
    value: readOptionalStringEnv(envKey, env),
  };
}

export function getServiceUrl(serviceName: InternalServiceName, env?: EnvSource): string {
  const serviceRef = resolveServiceRef(serviceName, env);
  if (!serviceRef.value) {
    throw new Error(`Variável de ambiente ${serviceRef.envKey} é obrigatória (Regra 6 - fail-fast)`);
  }

  const validationResult = httpUrlSchema.safeParse(serviceRef.value);
  if (!validationResult.success) {
    throw new Error(`Variável de ambiente ${serviceRef.envKey} inválida: URL HTTP/HTTPS obrigatória`);
  }

  return validationResult.data;
}

export function getOptionalServiceUrl(serviceName: InternalServiceName, env?: EnvSource): string | null {
  const serviceRef = resolveServiceRef(serviceName, env);
  if (!serviceRef.value) {
    return null;
  }

  const validationResult = httpUrlSchema.safeParse(serviceRef.value);
  if (!validationResult.success) {
    throw new Error(`Variável de ambiente ${serviceRef.envKey} inválida: URL HTTP/HTTPS obrigatória`);
  }

  return validationResult.data;
}

// ============================================================================
// SECRETS SANITIZATION (Enterprise-Grade - Regra 16 CLAUDE.md)
// ============================================================================

const SECRET_KEYS = new Set([
  'SESSION_SECRET',
  'DATABASE_URL',
  'INTERNAL_API_SECRET', // GPU Manager Service authentication
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'OAUTH_GITHUB_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GH_PAT',
  'GRAFANA_LOKI_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'GMAIL_APP_PASSWORD', // Gmail SMTP (substitui RESEND_API_KEY - 30/12/2025)
  'WISE_API_KEY',
  'WISE_CLIENT_SECRET',
  'INTERNAL_API_TOKEN',
  'SAML_CERT',
]);

export function sanitizeConfig<T extends Record<string, unknown>>(config: T): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.has(key)) {
      sanitized[key] = value ? '[REDACTED]' : '[NOT SET]';
    } else if (typeof value === 'string' && key.toLowerCase().includes('password')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && key.toLowerCase().includes('secret')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && key.toLowerCase().includes('token')) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function logConfigSafe<T extends Record<string, unknown>>(config: T, serviceName: string): void {
  const sanitized = sanitizeConfig(config);
  configLogger.info({ config: sanitized, service: serviceName }, 'Configuração carregada');
}

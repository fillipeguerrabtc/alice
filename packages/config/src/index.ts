import { z } from 'zod';
import pino from 'pino';

const configLogger = pino({
  name: 'config',
  level: process.env.LOG_LEVEL || 'info',
});

const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
  // SAML 2.0
  SAML_ENTRY_POINT: z.string().url().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CERT: z.string().optional(),
});

const llmConfigSchema = z.object({
  // GPU Manager Service (Hetzner GEX44) - GPU dedicada 24/7
  // Gate 2: LLM (texto) separado de VLM (visão). Este schema reflete o LLM default (texto).
  LLM_MODEL: z.string().default('Mistral-7B-Instruct-AWQ'),
  // Gate 2: coerente com max-model-len padrão do stack (2048)
  LLM_MAX_TOKENS: z.coerce.number().default(2048),
  LLM_TEMPERATURE: z.coerce.number().default(0.7),
});

const stripeConfigSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

const erpNextConfigSchema = z.object({
  ERPNEXT_URL: z.string().url().optional(),
  ERPNEXT_API_KEY: z.string().optional(),
  ERPNEXT_API_SECRET: z.string().optional(),
});

const observabilityConfigSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  GRAFANA_LOKI_USER: z.string().optional(),
  GRAFANA_LOKI_API_KEY: z.string().optional(),
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
  .merge(erpNextConfigSchema);

export const fullConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(authConfigSchema)
  .merge(llmConfigSchema)
  .merge(stripeConfigSchema)
  .merge(erpNextConfigSchema)
  .merge(observabilityConfigSchema);

export type BaseConfig = z.infer<typeof baseConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type LLMConfig = z.infer<typeof llmConfigSchema>;
export type StripeConfig = z.infer<typeof stripeConfigSchema>;
export type ERPNextConfig = z.infer<typeof erpNextConfigSchema>;
export type ObservabilityConfig = z.infer<typeof observabilityConfigSchema>;
export type FullConfig = z.infer<typeof fullConfigSchema>;

export function loadConfig<T>(schema: z.ZodSchema<T>): T {
  const result = schema.safeParse(process.env);
  
  if (!result.success) {
    const formattedErrors = result.error.format();
    configLogger.error({ errors: formattedErrors }, 'Falha na validação de configuração');
    throw new Error(`Falha na validação de configuração: ${JSON.stringify(formattedErrors)}`);
  }
  
  return result.data;
}

/**
 * Obter URL de serviço interno (Regra 6 - Fail-fast, sem hardcoded/fallback)
 *
 * REGRA 6: Variáveis de ambiente DEVEM estar definidas em QUALQUER ambiente.
 * PROIBIDO: fallback para localhost, mocks ou "modo preview".
 */
export function getServiceUrl(serviceName: string): string {
  const serviceUrls: Record<string, string | undefined> = {
    auth: process.env.AUTH_SERVICE_URL,
    chat: process.env.CHAT_SERVICE_URL,
    rag: process.env.RAG_SERVICE_URL,
    training: process.env.TRAINING_SERVICE_URL,
    integrations: process.env.INTEGRATIONS_SERVICE_URL,
  };
  
  const url = serviceUrls[serviceName];

  if (!url) {
    throw new Error(`Variável de ambiente ${serviceName.toUpperCase()}_SERVICE_URL é obrigatória (Regra 6 - fail-fast)`);
  }

  return url;
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
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ERPNEXT_API_SECRET',
  'GRAFANA_LOKI_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'GMAIL_APP_PASSWORD', // Gmail SMTP (substitui RESEND_API_KEY - 30/12/2025)
  'WISE_API_KEY',
  'WISE_WEBHOOK_SECRET',
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

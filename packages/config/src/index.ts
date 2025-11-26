import { z } from 'zod';

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
  // OAuth Microsoft
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  // SAML 2.0
  SAML_ENTRY_POINT: z.string().url().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CERT: z.string().optional(),
});

const llmConfigSchema = z.object({
  SALAD_API_KEY: z.string().optional(),
  SALAD_ORGANIZATION_ID: z.string().optional(),
  LLM_MODEL: z.string().default('llama4-maverick'),
  LLM_MAX_TOKENS: z.coerce.number().default(4096),
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
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration. Check environment variables.');
  }
  
  return result.data;
}

export function getServiceUrl(serviceName: string): string {
  const serviceUrls: Record<string, string> = {
    auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
    chat: process.env.CHAT_SERVICE_URL || 'http://localhost:3002',
    rag: process.env.RAG_SERVICE_URL || 'http://localhost:3003',
    training: process.env.TRAINING_SERVICE_URL || 'http://localhost:3004',
    integrations: process.env.INTEGRATIONS_SERVICE_URL || 'http://localhost:3005',
  };
  
  return serviceUrls[serviceName] || `http://localhost:3000`;
}

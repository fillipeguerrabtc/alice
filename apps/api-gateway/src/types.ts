import type CircuitBreaker from 'opossum';

export interface GatewayRuntimeConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
}

export interface GatewayConfig extends GatewayRuntimeConfig {
  AUTH_SERVICE_URL: string;
  CHAT_SERVICE_URL: string;
  RAG_SERVICE_URL: string;
  TRAINING_SERVICE_URL: string;
  INTEGRATIONS_SERVICE_URL: string;
  OBSERVABILITY_SERVICE_URL: string;
}

export interface ServiceConfig {
  name: string;
  url: string;
  healthPath: string;
  pathPrefix: string;
}

export type GatewayCircuitBreakers = Map<string, CircuitBreaker>;

export interface GatewayLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
}

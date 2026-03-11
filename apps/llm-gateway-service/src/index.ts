/**
 * LLM Gateway Service - Alice Enterprise Platform
 *
 * Ponto único de entrada para chamadas LLM.
 * Composition root com wiring de middleware, auth interno, governança, rotas
 * de inferência e bootstrap do serviço.
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { createLogger } from '@alice/logger';
import {
  getNodeEnv,
  readNumberEnv,
  readOptionalStringEnv,
} from '@alice/config';
import {
  createCorrelationMiddleware,
  createSecurityMiddleware,
  createErrorHandler,
  createNotFoundHandler,
  getCorsConfig,
  requireInternalHmacAuth,
  setupSwaggerUI,
} from '@alice/shared-utils';
import { registerLlmMetrics } from './llm-metrics.js';
import { registerLlmHealthRoutes } from './llm-health-routes.js';
import { registerLlmGovernanceRoutes } from './llm-governance-routes.js';
import { registerLlmInferenceRoutes } from './llm-inference-routes.js';
import { startLlmGatewayBootstrap } from './llm-bootstrap.js';
import { llmGatewayPaths, llmGatewaySchemas } from './openapi-specs.js';

const logger = createLogger('llm-gateway');

const PORT = readNumberEnv('PORT', { defaultValue: 3011, integer: true, min: 1, max: 65535 });
const INTERNAL_API_SECRET = readOptionalStringEnv('INTERNAL_API_SECRET') ?? '';
const IS_PRODUCTION = getNodeEnv() === 'production';
const DEFAULT_MODEL = readOptionalStringEnv('DEFAULT_LLM_MODEL') ?? 'Qwen2.5-7B-Instruct-AWQ';
const GPU_REQUEST_TIMEOUT_MS = readNumberEnv('GPU_REQUEST_TIMEOUT_MS', {
  defaultValue: 60000,
  integer: true,
  min: 1000,
});

if (!INTERNAL_API_SECRET && IS_PRODUCTION) {
  logger.error('INTERNAL_API_SECRET é obrigatório em produção para autenticação interna');
  process.exit(1);
}

const app = express();
app.use(createCorrelationMiddleware({ serviceName: 'llm-gateway' }));
app.use(createSecurityMiddleware());
app.use(cors(getCorsConfig()));

const defaultCompressionFilter: (req: Request, res: Response) => boolean =
  typeof (compression as unknown as { filter?: (req: Request, res: Response) => boolean }).filter === 'function'
    ? (compression as unknown as { filter: (req: Request, res: Response) => boolean }).filter
    : () => true;

app.use(compression({
  filter: (req, res) => {
    const acceptHeader = req.headers.accept ?? '';
    if (typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream')) {
      return false;
    }
    if (req.path === '/api/llm/stream') {
      return false;
    }
    return defaultCompressionFilter(req, res);
  },
}));
app.use(express.json({ limit: '1mb' }));

const metrics = registerLlmMetrics(app);

setupSwaggerUI(app, {
  serviceName: 'llm-gateway-service',
  version: '1.0.0',
  description: 'Gateway LLM com inferência, streaming e governança de prompt/templates/policies.',
  port: PORT,
  tags: [
    { name: 'Health', description: 'Health checks e métricas do serviço' },
    { name: 'Inference', description: 'Operações de inferência e streaming LLM' },
    { name: 'Governance', description: 'Governança de prompt templates e tool policies' },
  ],
  paths: llmGatewayPaths,
  schemas: llmGatewaySchemas,
});
logger.info('Swagger UI configurado em /api/docs');

function requireInternalAuth(req: Request, res: Response, next: () => void): void {
  if (req.path === '/health' || req.path === '/live' || req.path === '/ready' || req.path === '/metrics') {
    return next();
  }

  const hasHmacHeaders = Boolean(
    req.headers['x-internal-signature']
    && req.headers['x-internal-timestamp']
    && req.headers['x-internal-user-id']
    && req.headers['x-internal-role']
  );
  if (hasHmacHeaders) {
    const hmacMiddleware = requireInternalHmacAuth();
    hmacMiddleware(req, res, next as NextFunction);
    return;
  }

  const secret = req.headers['x-internal-api-secret'] as string;
  if (!INTERNAL_API_SECRET && !IS_PRODUCTION) {
    return next();
  }
  if (!secret || secret !== INTERNAL_API_SECRET) {
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }

  logger.warn({ path: req.path }, 'Autenticação interna legada por segredo estático utilizada; migre para HMAC');
  next();
}

app.use(requireInternalAuth);

registerLlmGovernanceRoutes({ app, logger });
registerLlmInferenceRoutes({
  app,
  logger,
  metrics,
  defaultModel: DEFAULT_MODEL,
  gpuRequestTimeoutMs: GPU_REQUEST_TIMEOUT_MS,
});
registerLlmHealthRoutes(app);

app.use(createNotFoundHandler());
app.use(createErrorHandler());

startLlmGatewayBootstrap({
  app,
  port: PORT,
  logger,
});

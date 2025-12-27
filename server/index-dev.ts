/**
 * Servidor de Desenvolvimento - Alice Enterprise Platform
 * 
 * DESENVOLVIMENTO REAL (Regra 6 CLAUDE.md)
 * PROIBIDO: mocks/stubs/preview responses. Este servidor exige integrações reais:
 * - PostgreSQL (persistência real)
 * - GPU Manager Service (Mixtral via vLLM)
 * 
 * Produção: Hetzner Cloud via Docker Compose (Regra 12)
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import { registerRoutes } from './routes';
import { setupVite, log } from './vite';
import { createLogger } from '@alice/shared-utils';

// Logger singleton (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger('server-dev');

// ============================================================================
// SERVIDOR DE DESENVOLVIMENTO
// ============================================================================

async function startDevServer() {
  const app = express();
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }
        log(logLine);
      }
    });

    next();
  });

  const server = await registerRoutes(app);
  
  app.use((err: Error & { status?: number; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    logger.error({ err, status }, "Erro no servidor de desenvolvimento");
    res.status(status).json({ message });
    throw err;
  });

  await setupVite(app, server);

  const port = 5000;
  server.listen(port, "0.0.0.0", () => {
    log(`Servidor rodando em http://0.0.0.0:${port}`);
    log(`Modo: DESENVOLVIMENTO (integrações reais - sem preview/mocks)`);
  });
}

startDevServer().catch((error) => {
  logger.error({ err: error }, 'Erro ao iniciar servidor');
  process.exit(1);
});

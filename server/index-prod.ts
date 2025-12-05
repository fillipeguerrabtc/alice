/**
 * Servidor de Produção - Alice Enterprise Platform
 * 
 * Servidor Express para servir arquivos estáticos buildados.
 * Produção: Hetzner Cloud via Docker Compose (Regra 12)
 * 
 * ATENÇÃO: Este servidor é para deploy standalone/monólito.
 * Em produção completa, usar Docker Compose com microserviços.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import { 
  createLogger, 
  registerShutdownCallback, 
  ShutdownPriority, 
  initializeShutdownManager 
} from '@alice/shared-utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5000', 10);

// Logger singleton (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger('server-prod');

async function startProdServer() {
  logger.info('========================================');
  logger.info('Alice Enterprise Platform - PRODUCTION');
  logger.info('========================================');
  
  // Inicializar ShutdownManager (CLAUDE.md - ShutdownManager Centralizado)
  initializeShutdownManager();

  const app = express();

  app.use(compression());

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
  }));

  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'alice-platform', 
      timestamp: new Date().toISOString(),
      environment: 'production',
    });
  });

  const publicDir = path.resolve(__dirname, 'public');

  if (!fs.existsSync(publicDir)) {
    logger.fatal({ publicDir }, 'ERRO: Diretório public não encontrado. Execute "pnpm run build" primeiro.');
    process.exit(1);
  }

  app.use(express.static(publicDir, {
    maxAge: '1y',
    etag: true,
    index: false,
  }));

  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send('index.html não encontrado');
    }
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err.message, stack: err.stack }, 'Erro não tratado');
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  const server = createServer(app);

  // Registrar callback de shutdown para HTTP server (CLAUDE.md - ShutdownManager Centralizado)
  registerShutdownCallback(
    'http-server-prod',
    async () => {
      logger.info('Encerrando servidor HTTP...');
      return new Promise<void>((resolve) => {
        server.close(() => {
          logger.info('Servidor HTTP encerrado');
          resolve();
        });
      });
    },
    { priority: ShutdownPriority.HTTP_SERVER, timeoutMs: 10000 }
  );

  server.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Servidor rodando');
    logger.info('========================================');
  });
}

startProdServer().catch((err) => {
  logger.fatal({ error: err }, 'Falha ao iniciar servidor de produção');
  process.exit(1);
});

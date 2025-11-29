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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5000', 10);

async function startProdServer() {
  console.log('========================================');
  console.log('  Alice Enterprise Platform - PRODUCTION');
  console.log('========================================');

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
    console.error('ERRO: Diretório public não encontrado:', publicDir);
    console.error('Execute "pnpm run build" primeiro.');
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
    console.error('Erro não tratado:', err);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  const server = createServer(app);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`  Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log('========================================');
  });

  process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM, encerrando graciosamente...');
    server.close(() => {
      console.log('Servidor encerrado.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('Recebido SIGINT, encerrando graciosamente...');
    server.close(() => {
      console.log('Servidor encerrado.');
      process.exit(0);
    });
  });
}

startProdServer().catch((err) => {
  console.error('Falha ao iniciar servidor de produção:', err);
  process.exit(1);
});

/**
 * Servidor de Desenvolvimento - Alice Enterprise Platform
 * 
 * Servidor Express com Vite middleware para desenvolvimento.
 * Inclui rotas de API para preview no Replit.
 * 
 * Produção: Hetzner Cloud via Docker Compose (Regra 12)
 * Documentação em PT-BR (Regra 10 replit.md)
 * Arquitetura: Microserviços (Regra 15 replit.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { createServer as createViteServer, ViteDevServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let integrationsProcess: ChildProcess | null = null;

function startIntegrationsService(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('  Iniciando integrations-service na porta 3005...');
    
    integrationsProcess = spawn('npx', ['tsx', 'apps/integrations-service/src/index.ts'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: '3005' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    integrationsProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Integrations service started')) {
        console.log('  ✓ integrations-service iniciado');
        resolve();
      }
    });

    integrationsProcess.stderr?.on('data', (data) => {
      console.error(`  integrations-service error: ${data}`);
    });

    integrationsProcess.on('error', (err) => {
      console.error('  Falha ao iniciar integrations-service:', err);
      reject(err);
    });

    setTimeout(() => resolve(), 3000);
  });
}

async function startDevServer() {
  console.log('========================================');
  console.log('  Alice Enterprise Platform - DEV');

  await startIntegrationsService();

  const app = express();
  app.use(express.json());

  const vite = await createViteServer({
    configFile: path.resolve(__dirname, '..', 'vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: true,
    },
    appType: 'spa',
  });

  app.get('/api/chat/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'dev-server', 
      timestamp: new Date().toISOString(),
      environment: 'development',
      note: 'Servidor de preview Replit - Microserviços rodam em produção na Hetzner Cloud',
    });
  });

  app.use('/api/integrations', createProxyMiddleware({
    target: 'http://localhost:3005/api/integrations',
    changeOrigin: true,
    logLevel: 'silent',
  }));

  app.use(vite.middlewares);

  app.use('*all', async (req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl;

    try {
      let template = fs.readFileSync(
        path.resolve(__dirname, '..', 'client', 'index.html'),
        'utf-8'
      );

      template = await vite.transformIndexHtml(url, template);

      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });

  const PORT = 5000;
  const server = createServer(app);
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`  VITE v5.4.20  ready in 338 ms`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`  ➜  press h + enter to show help`);
  });

  process.on('SIGTERM', () => {
    console.log('\nEncerrando servidor de desenvolvimento...');
    if (integrationsProcess) integrationsProcess.kill();
    vite.close();
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nEncerrando servidor de desenvolvimento...');
    if (integrationsProcess) integrationsProcess.kill();
    vite.close();
    server.close();
    process.exit(0);
  });
}

startDevServer().catch((error) => {
  console.error('Erro ao iniciar servidor:', error);
  process.exit(1);
});

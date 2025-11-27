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

  // ============================================================================
  // SERVIDOR DE DESENVOLVIMENTO - APENAS PARA PREVIEW NO REPLIT
  // Produção: Hetzner Cloud via Docker Compose (Regra 12 replit.md)
  // ============================================================================

  app.get('/api/chat/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'dev-server', 
      timestamp: new Date().toISOString(),
      environment: 'development',
      note: 'Servidor de preview Replit - Microserviços rodam em produção na Hetzner Cloud',
    });
  });

  // Rotas de autenticação para desenvolvimento
  app.get('/api/auth/me', (_req: Request, res: Response) => {
    res.json({
      id: 'dev-user-001',
      email: 'dev@alice.local',
      name: 'Desenvolvedor',
      role: 'admin',
      tenantId: 'dev-tenant',
      permissions: ['*'],
    });
  });

  app.post('/api/auth/login', (_req: Request, res: Response) => {
    res.json({
      success: true,
      user: {
        id: 'dev-user-001',
        email: 'dev@alice.local',
        name: 'Desenvolvedor',
        role: 'admin',
        tenantId: 'dev-tenant',
      },
    });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.json({ success: true });
  });

  // Rotas do Dashboard para desenvolvimento
  app.get('/api/chat/stats', (_req: Request, res: Response) => {
    res.json({
      conversations: 0,
      documents: 0,
      trainingData: 0,
      tokensUsed: 0,
      trend: { conversations: 0, documents: 0, trainingData: 0, tokensUsed: 0 },
    });
  });

  app.get('/api/chat/usage', (_req: Request, res: Response) => {
    res.json([]);
  });

  app.get('/api/audit/recent', (_req: Request, res: Response) => {
    res.json([]);
  });

  app.get('/api/integrations/health', (_req: Request, res: Response) => {
    res.json([
      { service: 'LLM (Salad Cloud)', status: 'ok', latency: 0, uptime: 100 },
      { service: 'RAG Service', status: 'ok', latency: 0, uptime: 100 },
      { service: 'Stripe Portugal', status: 'ok', latency: 0, uptime: 100 },
      { service: 'Wise Transfers', status: 'ok', latency: 0, uptime: 100 },
    ]);
  });

  app.get('/api/chat/images/stats', (_req: Request, res: Response) => {
    res.json({
      totalGenerated: 0,
      approved: 0,
      pending: 0,
      inTraining: 0,
      avgRating: 0,
    });
  });

  app.get('/api/chat/pending-handoffs', (_req: Request, res: Response) => {
    res.json([]);
  });

  app.get('/api/chat/urgent-conversations', (_req: Request, res: Response) => {
    res.json([]);
  });

  app.get('/api/chat/sla/status', (_req: Request, res: Response) => {
    res.json({
      breached: 0,
      atRisk: 0,
      healthy: 0,
      avgResponseTime: 0,
    });
  });

  app.get('/api/chat/breakers/stats', (_req: Request, res: Response) => {
    res.json({
      llm: { state: 'closed', failures: 0, successes: 100 },
      rag: { state: 'closed', failures: 0, successes: 100 },
      imageGen: { state: 'closed', failures: 0, successes: 100 },
    });
  });

  app.use('/api/integrations', createProxyMiddleware({
    target: 'http://localhost:3005/api/integrations',
    changeOrigin: true,
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

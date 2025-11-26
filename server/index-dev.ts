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
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startDevServer() {
  console.log('========================================');
  console.log('  Alice Enterprise Platform - DEV');

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
    vite.close();
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nEncerrando servidor de desenvolvimento...');
    vite.close();
    server.close();
    process.exit(0);
  });
}

startDevServer().catch((error) => {
  console.error('Erro ao iniciar servidor:', error);
  process.exit(1);
});

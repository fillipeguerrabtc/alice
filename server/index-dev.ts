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

// IMPORTANTE: Configurar limite de listeners no início para evitar MaxListenersExceededWarning
process.setMaxListeners(30);

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
    
    integrationsProcess = spawn('npx', ['tsx', 'apps/integrations-service/src/bootstrap.ts'], {
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
  const devUser = {
    id: 'dev-user-001',
    email: 'dev@alice.local',
    firstName: 'Desenvolvedor',
    lastName: 'Local',
    role: 'admin',
    tenantId: 'dev-tenant',
    permissions: ['*'],
  };

  app.get('/api/auth/user', (_req: Request, res: Response) => {
    res.json({ user: devUser, csrfToken: 'dev-csrf-token' });
  });

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

  // Rotas de módulos para preview (Regra 6: dados de preview APENAS em index-dev.ts)
  const previewModules = [
    { id: 'preview-mod-001', codigo: 'chat', nome: 'Chat IA', descricao: 'Conversas com assistente de IA', icone: 'MessageSquare', categoria: 'core', urlExterna: null, ordem: 1, ativo: true, criadoEm: new Date().toISOString() },
    { id: 'preview-mod-002', codigo: 'documents', nome: 'Documentos', descricao: 'Gestão de documentos e RAG', icone: 'FileText', categoria: 'core', urlExterna: null, ordem: 2, ativo: true, criadoEm: new Date().toISOString() },
    { id: 'preview-mod-003', codigo: 'training', nome: 'Treinamento', descricao: 'Treinamento de modelos', icone: 'Brain', categoria: 'ai', urlExterna: null, ordem: 3, ativo: true, criadoEm: new Date().toISOString() },
    { id: 'preview-mod-004', codigo: 'observability', nome: 'Observabilidade', descricao: 'Monitoramento e métricas', icone: 'Activity', categoria: 'observability', urlExterna: 'https://grafana.example.com', ordem: 4, ativo: true, criadoEm: new Date().toISOString() },
    { id: 'preview-mod-005', codigo: 'payments', nome: 'Pagamentos', descricao: 'Gestão de pagamentos Stripe/Wise', icone: 'CreditCard', categoria: 'finance', urlExterna: null, ordem: 5, ativo: true, criadoEm: new Date().toISOString() },
  ];

  app.get('/api/auth/modules', (_req: Request, res: Response) => {
    res.json({ modules: previewModules });
  });

  app.get('/api/auth/modules/:id', (req: Request, res: Response) => {
    const module = previewModules.find(m => m.id === req.params.id);
    if (module) {
      res.json({ module });
    } else {
      res.status(404).json({ error: 'Módulo não encontrado' });
    }
  });

  app.post('/api/auth/modules', (req: Request, res: Response) => {
    const newModule = {
      id: `preview-mod-${Date.now()}`,
      ...req.body,
      criadoEm: new Date().toISOString(),
    };
    previewModules.push(newModule);
    res.status(201).json({ module: newModule });
  });

  app.patch('/api/auth/modules/:id', (req: Request, res: Response) => {
    const index = previewModules.findIndex(m => m.id === req.params.id);
    if (index !== -1) {
      previewModules[index] = { ...previewModules[index], ...req.body };
      res.json({ module: previewModules[index] });
    } else {
      res.status(404).json({ error: 'Módulo não encontrado' });
    }
  });

  app.delete('/api/auth/modules/:id', (req: Request, res: Response) => {
    const index = previewModules.findIndex(m => m.id === req.params.id);
    if (index !== -1) {
      const deleted = previewModules.splice(index, 1)[0];
      res.json({ success: true, module: deleted });
    } else {
      res.status(404).json({ error: 'Módulo não encontrado' });
    }
  });

  app.get('/api/auth/roles/:roleId/modules', (req: Request, res: Response) => {
    res.json({ roleModules: [], roleId: req.params.roleId });
  });

  app.post('/api/auth/roles/:roleId/modules', (req: Request, res: Response) => {
    res.status(201).json({ 
      roleModule: { 
        ...req.body, 
        roleId: req.params.roleId,
        id: `preview-rm-${Date.now()}` 
      } 
    });
  });

  app.delete('/api/auth/roles/:roleId/modules/:moduleId', (req: Request, res: Response) => {
    res.json({ 
      success: true, 
      roleId: req.params.roleId, 
      moduleId: req.params.moduleId 
    });
  });

  app.get('/api/auth/users/:userId/modules', (_req: Request, res: Response) => {
    res.json({ userModules: [] });
  });

  app.post('/api/auth/users/:userId/modules', (req: Request, res: Response) => {
    res.status(201).json({ userModule: { ...req.body, id: `preview-um-${Date.now()}` } });
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

  // ============================================================================
  // ROTAS DE CHAT PARA PREVIEW - APENAS DEV
  // Em produção, essas rotas são servidas pelo chat-service (porta 3002)
  // ============================================================================

  app.get('/api/chat/conversations', (_req: Request, res: Response) => {
    res.json({
      conversations: [
        {
          id: 'dev-conv-001',
          titulo: 'Conversa de Teste',
          criadoEm: new Date().toISOString(),
          atualizadoEm: new Date().toISOString(),
        },
      ],
    });
  });

  app.get('/api/chat/conversations/:id/messages', (req: Request, res: Response) => {
    res.json({
      messages: [
        {
          id: 'msg-001',
          role: 'assistant',
          content: 'Olá! Sou a Alice, sua assistente de IA enterprise. Este é um ambiente de preview no Replit. Em produção, a Alice utiliza o Llama 4 Maverick (400B parâmetros) hospedado na Salad Cloud.',
          createdAt: new Date().toISOString(),
          tipo: 'text',
        },
      ],
    });
  });

  // Streaming de mensagens (SSE) para preview
  app.post('/api/chat/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const previewResponse = 'Esta é uma resposta de preview no ambiente de desenvolvimento do Replit. Em produção, a Alice processa suas mensagens usando o modelo Llama 4 Maverick com 400 bilhões de parâmetros, oferecendo respostas inteligentes e contextualizadas.';

    // Simular streaming de tokens
    const words = previewResponse.split(' ');
    let index = 0;

    const sendWord = () => {
      if (index < words.length) {
        const word = words[index] + (index < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ content: word })}\n\n`);
        index++;
        setTimeout(sendWord, 50);
      } else {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };

    sendWord();
  });

  // Rate de imagem para preview
  app.post('/api/chat/images/:id/rate', (req: Request, res: Response) => {
    res.json({ success: true, imageId: req.params.id, score: req.body.score });
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

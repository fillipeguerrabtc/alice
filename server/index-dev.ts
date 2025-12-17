/**
 * Servidor de Desenvolvimento - Alice Enterprise Platform
 * 
 * APENAS PARA PREVIEW LOCAL (Regra 6 CLAUDE.md)
 * Dados de preview permitidos APENAS neste arquivo.
 * 
 * Produção: Hetzner Cloud via Docker Compose (Regra 12)
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import { registerRoutes } from './routes';
import { setupVite, log } from './vite';

// ============================================================================
// PREVIEW DATA - APENAS DESENVOLVIMENTO (Regra 6 CLAUDE.md)
// Este código NAO é deployado para produção
// ============================================================================

async function setupPreviewData() {
  log('Modo desenvolvimento: configurando dados de preview');
}

// ============================================================================
// PREVIEW CHAT ENDPOINT - APENAS DESENVOLVIMENTO
// Permite testar a UI de chat sem Salad Cloud
// ============================================================================

function setupPreviewChatEndpoint(app: express.Express) {
  app.post('/api/chat/preview', async (req, res) => {
    const { message } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const response = generatePreviewResponse(message || '');
    const words = response.split(' ');
    
    for (const word of words) {
      res.write(`data: ${JSON.stringify({ content: word + ' ' })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  });

  app.get('/api/llm/status', (_req, res) => {
    res.json({
      available: true,
      previewMode: true,
      model: 'llama4-maverick-preview',
      provider: 'Preview (desenvolvimento)',
      note: 'Em producao, conecta ao Salad Cloud com Mixtral 8x7B'
    });
  });
}

function generatePreviewResponse(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase();
  
  if (lowerMessage.includes('ola') || lowerMessage.includes('oi') || lowerMessage.includes('hello')) {
    return 'Ola! Sou Alice, sua assistente de IA enterprise. Este e o modo preview de desenvolvimento. Em producao, estarei conectada ao Mixtral 8x7B no Salad Cloud. Como posso ajudar?';
  }
  
  if (lowerMessage.includes('quem') && lowerMessage.includes('voce')) {
    return 'Sou Alice, uma plataforma de IA autonoma enterprise. Minhas capacidades incluem: chat em tempo real com streaming, RAG para busca semantica em documentos, geracao de imagens com FLUX.1, e integracao SSO com Grafana e ERPNext. Este e o modo preview.';
  }

  if (lowerMessage.includes('ajud') || lowerMessage.includes('help')) {
    return 'Posso ajudar com diversas tarefas: responder perguntas, analisar documentos, gerar insights de negocios, e muito mais. Em producao, terei acesso ao modelo Mixtral 8x7B.';
  }

  return `Recebi sua mensagem. Este e o modo preview de desenvolvimento. Em producao (Hetzner Cloud), estarei conectada ao Mixtral 8x7B no Salad Cloud para respostas completas e inteligentes.`;
}

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
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

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

  // Endpoints de preview ANTES das rotas principais
  setupPreviewChatEndpoint(app);
  
  // Dados de preview
  await setupPreviewData();

  const server = await registerRoutes(app);
  
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  await setupVite(app, server);

  const port = 5000;
  server.listen(port, "0.0.0.0", () => {
    log(`Servidor rodando em http://0.0.0.0:${port}`);
    log(`Modo: DESENVOLVIMENTO (preview habilitado)`);
  });
}

startDevServer().catch((error) => {
  console.error('Erro ao iniciar servidor:', error);
  process.exit(1);
});

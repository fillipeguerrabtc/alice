import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { z } from "zod";
import { llmClient } from "./services/llm-client";
import { createLogger } from "@alice/shared-utils";

// Logger singleton (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger("server-routes");

// BUG FIX 23/12/2025: Helper function para extrair userId de forma type-safe
// Evita type casting inseguro que assume que claims.sub sempre existe
// Esta função garante verificação de existência antes de retornar
function getUserId(req: Request): string | null {
  const user = req.user as { claims?: { sub?: string } } | undefined;
  return user?.claims?.sub ?? null;
}

const createConversationSchema = z.object({
  titulo: z.string().optional(),
  agentId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
});

// ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
// CORREÇÃO 23/12/2025: Removido 'document' - documentos são enviados para RAG service via uploads,
// não como tipos de mensagem de chat. Chat messages suportam apenas: text, image, audio, mixed
const createMessageSchema = z.object({
  conversationId: z.string().uuid(),
  conteudo: z.string(),
  tipo: z.enum(["text", "image", "audio", "mixed"]).optional(),
  anexos: z.array(z.record(z.unknown())).optional(),
});

const createDocumentSchema = z.object({
  titulo: z.string(),
  conteudo: z.string().optional(),
  tipo: z.string().optional(),
  fonte: z.string().optional(),
  namespaceId: z.string().uuid().optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  app.get("/api/auth/user", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar usuário");
      res.status(500).json({ message: "Falha ao buscar usuário" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversations = await storage.getConversations(userId);
      res.json(conversations);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar conversas");
      res.status(500).json({ message: "Falha ao buscar conversas" });
    }
  });

  app.get("/api/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversa não encontrada" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      res.json(conversation);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar conversa");
      res.status(500).json({ message: "Falha ao buscar conversa" });
    }
  });

  app.post("/api/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const data = createConversationSchema.parse(req.body);
      const conversation = await storage.createConversation({
        ...data,
        userId,
      });
      res.status(201).json(conversation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: error.errors });
      }
      logger.error({ err: error }, "Erro ao criar conversa");
      res.status(500).json({ message: "Falha ao criar conversa" });
    }
  });

  app.delete("/api/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversa não encontrada" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      await storage.deleteConversation(req.params.id);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Erro ao deletar conversa");
      res.status(500).json({ message: "Falha ao deletar conversa" });
    }
  });

  app.get("/api/conversations/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversa não encontrada" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      const limit = parseInt((req.query.limit as string) || "100", 10);
      const messages = await storage.getMessages(req.params.id, limit);
      res.json(messages);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar mensagens");
      res.status(500).json({ message: "Falha ao buscar mensagens" });
    }
  });

  app.post("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const data = createMessageSchema.parse(req.body);
      const conversation = await storage.getConversation(data.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversa não encontrada" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      const message = await storage.createMessage({
        ...data,
        userId,
        isFromUser: true,
      });
      res.status(201).json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: error.errors });
      }
      logger.error({ err: error }, "Erro ao criar mensagem");
      res.status(500).json({ message: "Falha ao criar mensagem" });
    }
  });

  app.get("/api/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const namespaceId = (req.query.namespaceId as string) || undefined;
      const documents = await storage.getDocuments(namespaceId);
      res.json(documents);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar documentos");
      res.status(500).json({ message: "Falha ao buscar documentos" });
    }
  });

  app.post("/api/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const data = createDocumentSchema.parse(req.body);
      const document = await storage.createDocument(data);
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: error.errors });
      }
      logger.error({ err: error }, "Erro ao criar documento");
      res.status(500).json({ message: "Falha ao criar documento" });
    }
  });

  app.delete("/api/documents/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await storage.deleteDocument(req.params.id);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Erro ao deletar documento");
      res.status(500).json({ message: "Falha ao deletar documento" });
    }
  });

  app.get("/api/namespaces", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const namespaces = await storage.getNamespaces();
      res.json(namespaces);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar namespaces");
      res.status(500).json({ message: "Falha ao buscar namespaces" });
    }
  });

  app.get("/api/agents", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const agents = await storage.getAgents();
      res.json(agents);
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar agentes");
      res.status(500).json({ message: "Falha ao buscar agentes" });
    }
  });

  app.get("/api/metrics", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversations = await storage.getConversations(userId);
      const totalConversas = conversations.length;
      const totalMensagens = conversations.reduce((sum, c) => sum + (c.totalMensagens || 0), 0);
      res.json({
        totalConversas,
        totalMensagens,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, "Erro ao buscar métricas");
      res.status(500).json({ message: "Falha ao buscar métricas" });
    }
  });

  app.get("/api/llm/status", isAuthenticated, async (_req: Request, res: Response) => {
    res.json({
      available: llmClient.isAvailable(),
      model: "Mixtral-8x7B",
      provider: "GPU Manager Service (Hetzner GEX44)",
    });
  });

  const chatRequestSchema = z.object({
    conversationId: z.string().uuid(),
    message: z.string().min(1),
    stream: z.boolean().optional().default(true),
  });

  app.post("/api/chat", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const data = chatRequestSchema.parse(req.body);
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const conversation = await storage.getConversation(data.conversationId);
      
      if (!conversation) {
        return res.status(404).json({ message: "Conversa não encontrada" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }

      if (!llmClient.isAvailable()) {
        return res.status(503).json({ 
          message: "LLM não disponível. GPU Manager Service deve estar configurado em produção." 
        });
      }

      const userMessage = await storage.createMessage({
        conversationId: data.conversationId,
        conteudo: data.message,
        userId,
        isFromUser: true,
        tipo: "text",
      });

      const previousMessages = await storage.getMessages(data.conversationId, 20);
      const chatHistory = previousMessages.map((m) => ({
        role: m.isFromUser ? ("user" as const) : ("assistant" as const),
        content: m.conteudo || "",
      }));

      if (data.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        let fullResponse = "";
        const startTime = Date.now();

        try {
          for await (const chunk of llmClient.chatCompletionStream({
            messages: [
              { role: "system", content: "Você é Alice, uma assistente de IA inteligente e prestativa." },
              ...chatHistory,
            ],
          })) {
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          }

          // BUG FIX 23/12/2025: Assistant messages devem incluir userId para consistência de dados
          // Todas as mensagens de uma conversa devem ter userId para queries, analytics e auditoria
          const assistantMessage = await storage.createMessage({
            conversationId: data.conversationId,
            conteudo: fullResponse,
            userId, // Incluir userId para consistência - mensagem pertence à conversa do usuário
            isFromUser: false,
            tipo: "text",
            latenciaMs: Date.now() - startTime,
          });

          res.write(`data: ${JSON.stringify({ done: true, messageId: assistantMessage.id })}\n\n`);
          res.end();
        } catch (error) {
          logger.error({ err: error }, "Erro no streaming");
          res.write(`data: ${JSON.stringify({ error: "Erro ao gerar resposta" })}\n\n`);
          res.end();
        }
      } else {
        const startTime = Date.now();
        const response = await llmClient.chatCompletion({
          messages: [
            { role: "system", content: "Você é Alice, uma assistente de IA inteligente e prestativa." },
            ...chatHistory,
          ],
        });

        // BUG FIX 23/12/2025: Assistant messages devem incluir userId para consistência de dados
        // Todas as mensagens de uma conversa devem ter userId para queries, analytics e auditoria
        const assistantMessage = await storage.createMessage({
          conversationId: data.conversationId,
          conteudo: response.message.content,
          userId, // Incluir userId para consistência - mensagem pertence à conversa do usuário
          isFromUser: false,
          tipo: "text",
          tokensUsados: response.usage.totalTokens,
          latenciaMs: Date.now() - startTime,
        });

        res.json({
          userMessage,
          assistantMessage,
          usage: response.usage,
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: error.errors });
      }
      logger.error({ err: error }, "Erro no chat");
      res.status(500).json({ message: "Falha ao processar mensagem" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

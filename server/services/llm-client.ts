import { z } from "zod";
import { createLogger } from "@alice/shared-utils";

// Logger singleton (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger("llm-client");

// NOTA: Este arquivo é apenas para desenvolvimento local (server/index-dev.ts)
// Em produção, o chat-service usa GPU Manager Service (Hetzner GEX44)
// LLM Client desabilitado - usar chat-service em produção
// BUG FIX 26/12/2025: GPU_MANAGER_URL removido - não usado em dev (LLM desabilitado em dev)
// Para produção, o chat-service usa requestGpu de @alice/shared-utils

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  message: ChatMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class LLMClient {
  private isConfigured: boolean;

  constructor() {
    // NOTA: LLM Client desabilitado - desenvolvimento local apenas
    // Em produção, usar chat-service que integra com GPU Manager Service
    this.isConfigured = false;
    logger.warn("LLM Client: Desabilitado - usar chat-service em produção (GPU Manager Service)");
  }

  async chatCompletion(_options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // NOTA: LLM Client desabilitado - desenvolvimento local apenas
    // Em produção, usar chat-service que integra com GPU Manager Service
    throw new Error("LLM Client desabilitado - usar chat-service em produção (GPU Manager Service)");
  }

  async *chatCompletionStream(_options: ChatCompletionOptions): AsyncGenerator<string> {
    // NOTA: LLM Client desabilitado - desenvolvimento local apenas
    // Em produção, usar chat-service que integra com GPU Manager Service
    throw new Error("LLM Client desabilitado - usar chat-service em produção (GPU Manager Service)");
    // TypeScript requires a yield in generator functions, but this is unreachable
    yield "";
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }
}

export const llmClient = new LLMClient();

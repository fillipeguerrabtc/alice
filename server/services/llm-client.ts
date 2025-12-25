import { z } from "zod";
import { createLogger } from "@alice/shared-utils";

// Logger singleton (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger("llm-client");

// NOTA: Este arquivo é apenas para desenvolvimento local (server/index-dev.ts)
// Em produção, o chat-service usa GPU Manager Service (Hetzner GEX44)
// LLM Client desabilitado - usar chat-service em produção
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || "http://localhost:3008";

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

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // NOTA: LLM Client desabilitado - desenvolvimento local apenas
    // Em produção, usar chat-service que integra com GPU Manager Service
    throw new Error("LLM Client desabilitado - usar chat-service em produção (GPU Manager Service)");

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string };
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    return {
      id: result.id,
      model: result.model,
      message: {
        role: "assistant",
        content: result.choices[0]?.message?.content || "",
      },
      usage: {
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      },
    };
  }

  async *chatCompletionStream(options: ChatCompletionOptions): AsyncGenerator<string> {
    // NOTA: LLM Client desabilitado - desenvolvimento local apenas
    // Em produção, usar chat-service que integra com GPU Manager Service
    throw new Error("LLM Client desabilitado - usar chat-service em produção (GPU Manager Service)");

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body nao disponivel");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              return;
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }
}

export const llmClient = new LLMClient();

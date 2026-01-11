import { z } from "zod";
import {
  createLogger,
  requestGpu,
  requestGpuStream,
  GpuServiceType,
  GpuRequestPriority,
} from "@alice/shared-utils";

/**
 * Cliente LLM (DEV) - Alice Enterprise Platform
 *
 * REGRA 6: Proibido mock/stub. Este cliente faz requisições REAIS ao Mixtral
 * via GPU Manager Service (fila + VRAM monitoring + circuit breakers).
 *
 * Autor: Fillipe Guerra
 * Data: 27/12/2025
 */

// Logger singleton (Regra 8 - Pino obrigatório)
const logger = createLogger("llm-client");

const llmEnvSchema = z.object({
  MIXTRAL_MODEL_NAME: z.string().min(1),
});

let llmEnv: z.infer<typeof llmEnvSchema>;
try {
  llmEnv = llmEnvSchema.parse(process.env);
} catch (err) {
  const zodError = err instanceof z.ZodError ? err : null;
  logger.error(
    { issues: zodError?.issues?.map((i) => ({ path: i.path, message: i.message })) },
    "Config inválida do LLM Client: MIXTRAL_MODEL_NAME é obrigatório (fail-fast)"
  );
  process.exit(1);
}

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

type OpenAIChatCompletionResponse = {
  id: string;
  model: string;
  choices: Array<{
    message?: { role: "assistant"; content: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
};

function normalizeModelName(requested?: string): string {
  return requested && requested.trim().length > 0 ? requested.trim() : llmEnv.MIXTRAL_MODEL_NAME;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();

  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames são separados por linhas em branco (\n\n)
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = rawFrame.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice("data:".length).trim();
        if (!data) continue;
        if (data === "[DONE]") return;

        let parsed: OpenAIStreamChunk | null = null;
        try {
          parsed = JSON.parse(data) as OpenAIStreamChunk;
        } catch (err) {
          logger.warn({ err }, "Chunk SSE inválido (JSON parse falhou)");
          continue;
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield delta;
        }
      }
    }
  }
}

export class LLMClient {
  isAvailable(): boolean {
    // Se chegamos aqui, env mínimo está OK e @alice/shared-utils valida INTERNAL_API_SECRET no startup.
    return true;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const model = normalizeModelName(options.model);

    // ARQUITETURA v4.0.0: Qwen2.5-VL substitui Mixtral (multimodal)
    const result = await requestGpu({
      serviceType: GpuServiceType.QWEN_VL,
      endpoint: "/v1/chat/completions",
      method: "POST",
      priority: GpuRequestPriority.CRITICAL,
      body: {
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1024,
        stream: false,
      },
      timeout: 120000,
      metadata: { source: "server-dev" },
    });

    const payload = result.data as OpenAIChatCompletionResponse | undefined;
    const content = payload?.choices?.[0]?.message?.content;
    if (!payload?.id || !payload?.model || typeof content !== "string") {
      throw new Error("Resposta inválida do Mixtral (OpenAI chat completion)");
    }

    const usage = payload.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    return {
      id: payload.id,
      model: payload.model,
      message: { role: "assistant", content },
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }

  async *chatCompletionStream(options: ChatCompletionOptions): AsyncGenerator<string> {
    const model = normalizeModelName(options.model);

    // ARQUITETURA v4.0.0: Qwen2.5-VL substitui Mixtral (multimodal)
    const response = await requestGpuStream({
      serviceType: GpuServiceType.QWEN_VL,
      endpoint: "/v1/chat/completions",
      method: "POST",
      priority: GpuRequestPriority.CRITICAL,
      body: {
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1024,
        stream: true,
      },
      timeout: 120000,
      metadata: { source: "server-dev", stream: true },
    });

    if (!response.body) {
      throw new Error("Streaming response sem body");
    }

    for await (const token of parseSseStream(response.body)) {
      yield token;
    }
  }
}

export const llmClient = new LLMClient();

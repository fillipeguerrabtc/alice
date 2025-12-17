import { z } from "zod";

const SALAD_API_KEY = process.env.SALAD_API_KEY || "";
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID || "";
const SALAD_LLM_ENDPOINT = process.env.SALAD_LLM_ENDPOINT || "https://api.salad.com/api/public";

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
    this.isConfigured = !!(SALAD_API_KEY && SALAD_ORGANIZATION_ID);
    if (!this.isConfigured) {
      console.warn("LLM Client: SALAD_API_KEY ou SALAD_ORGANIZATION_ID nao configurados - LLM indisponivel");
    }
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    if (!this.isConfigured) {
      throw new Error("LLM nao configurado. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.");
    }

    const {
      messages,
      model = "Mixtral-8x7B",
      temperature = 0.7,
      maxTokens = 4096,
    } = options;

    const response = await fetch(`${SALAD_LLM_ENDPOINT}/inference/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Salad-Api-Key": SALAD_API_KEY,
        "Salad-Organization": SALAD_ORGANIZATION_ID,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

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
    if (!this.isConfigured) {
      throw new Error("LLM nao configurado. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.");
    }

    const {
      messages,
      model = "Mixtral-8x7B",
      temperature = 0.7,
      maxTokens = 4096,
    } = options;

    const response = await fetch(`${SALAD_LLM_ENDPOINT}/inference/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Salad-Api-Key": SALAD_API_KEY,
        "Salad-Organization": SALAD_ORGANIZATION_ID,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

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

/**
 * Audio Processor Service - Alice Enterprise Platform
 * 
 * ARQUITETURA ENTERPRISE (22/01/2026):
 * - Transcrição: OpenAI ASR (gpt-4o-transcribe) via API
 * - Text embedding: Qwen3-Embedding-0.6B via GPU Manager Service (1024 dim)
 * - Extração de metadata (duração, formato, bitrate)
 * - Embeddings de texto armazenados em Qdrant
 * 
 * GPU é OBRIGATÓRIO apenas para embeddings (sem fallback, Regra 6)
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import {
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
} from '@alice/shared-utils';

const logger = createLogger('audio-processor');

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// URL é usada internamente pelo requestGpu, não precisa ser exposta aqui

// Dimensão dos embeddings de texto (SSOT: @alice/database)
export const TEXT_EMBEDDING_DIM = EMBEDDING_DIMENSIONS.TEXT;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
  logger.error('OPENAI_API_KEY é obrigatório em produção (ASR via OpenAI)');
  process.exit(1);
}

// Timeouts
const OPENAI_ASR_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_ASR_TIMEOUT_MS ?? '', 10);
const ASR_TIMEOUT_MS = Number.isFinite(OPENAI_ASR_TIMEOUT_MS) && OPENAI_ASR_TIMEOUT_MS > 0
  ? OPENAI_ASR_TIMEOUT_MS
  : 120000;
const EMBEDDING_TIMEOUT_MS = 30000; // 30s para embeddings

const OPENAI_ASR_MODEL = process.env.OPENAI_ASR_MODEL?.trim() || 'gpt-4o-transcribe';
const OPENAI_ASR_STREAM = process.env.OPENAI_ASR_STREAM
  ? process.env.OPENAI_ASR_STREAM.toLowerCase() === 'true'
  : true;

const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
};

type OpenAiTranscriptionPayload = {
  text?: string;
  language?: string;
  duration?: number;
  duration_seconds?: number;
  confidence?: number;
};

export interface AudioMetadata {
  duration?: number;
  format?: string;
  channels?: number;
  sampleRate?: number;
  bitrate?: number;
  fileSize: number;
}

export interface ProcessedAudio {
  transcription: string;
  transcriptionLanguage?: string;
  transcriptionConfidence?: number;
  durationSeconds: number | null;
  embedding: number[];
  embeddingModel: string;
  metadata: AudioMetadata;
  processedAt: string;
  processingTimeMs: number;
}

export interface AudioProcessorOptions {
  language?: string;
  generateEmbedding?: boolean;
}

interface OpenAiTranscribeParams {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
}

function buildAudioFilename(mimeType: string): string {
  const extension = AUDIO_EXTENSION_BY_MIME[mimeType] || 'wav';
  return `audio.${extension}`;
}

async function parseOpenAiTranscriptionStream(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('Resposta OpenAI sem stream de dados');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let transcript = '';
  let finalText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const chunk = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);

      if (chunk.length === 0) {
        separatorIndex = buffer.indexOf('\n\n');
        continue;
      }

      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as { delta?: string; text?: string; transcript?: string };
          if (typeof parsed.delta === 'string') {
            transcript += parsed.delta;
          } else if (typeof parsed.text === 'string') {
            finalText = parsed.text;
          } else if (typeof parsed.transcript === 'string') {
            finalText = parsed.transcript;
          }
        } catch (error) {
          logger.warn({ error, payload }, 'Falha ao parsear evento de transcrição OpenAI');
        }
      }

      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  return (finalText || transcript).trim();
}

async function callOpenAiTranscription(params: OpenAiTranscribeParams): Promise<OpenAiTranscriptionPayload> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada - ASR via OpenAI é obrigatória');
  }

  const form = new FormData();
  const audioBytes = new Uint8Array(params.audioBuffer);
  const audioBlob = new Blob([audioBytes], { type: params.mimeType });
  form.append('file', audioBlob, buildAudioFilename(params.mimeType));
  form.append('model', OPENAI_ASR_MODEL);
  form.append('response_format', 'json');
  if (params.language) {
    form.append('language', params.language);
  }
  if (OPENAI_ASR_STREAM) {
    form.append('stream', 'true');
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI ASR error: ${response.status} - ${errText}`);
  }

  if (OPENAI_ASR_STREAM) {
    const text = await parseOpenAiTranscriptionStream(response);
    return { text };
  }

  return (await response.json()) as OpenAiTranscriptionPayload;
}

const openAiAsrBreaker = createCircuitBreaker(callOpenAiTranscription, {
  name: 'openai-asr-transcription',
  ...CIRCUIT_BREAKER_PRESETS.whisper,
});

async function callOpenAiAsr(params: OpenAiTranscribeParams): Promise<OpenAiTranscriptionPayload> {
  return openAiAsrBreaker.fire(params) as Promise<OpenAiTranscriptionPayload>;
}

/**
 * Audio Processor Service - ARQUITETURA ENTERPRISE (22/01/2026)
 * 
 * - Transcrição: OpenAI ASR (gpt-4o-transcribe) via API
 * - Embeddings: Qwen3-Embedding-0.6B GPU via GPU Manager Service (1024 dim → Qdrant)
 * 
 * GPU é OBRIGATÓRIO apenas para embeddings (Regra 6)
 */
class AudioProcessorService {
  private configured: boolean;
  private asrConfigured: boolean;
  private embeddingsConfigured: boolean;

  constructor() {
    // OpenAI é obrigatório para ASR; GPU Manager é obrigatório para embeddings
    this.asrConfigured = Boolean(OPENAI_API_KEY);
    this.embeddingsConfigured = true;  // Text embeddings via GPU Manager Service
    this.configured = this.asrConfigured;
    
    logger.info({ 
      openaiAsr: this.asrConfigured,
      gpuManagerEmbeddings: 'enabled',
      embeddingDim: TEXT_EMBEDDING_DIM,
      asrModel: OPENAI_ASR_MODEL,
      asrStream: OPENAI_ASR_STREAM,
    }, 'Audio Processor - OpenAI ASR + Embeddings GPU (Qdrant)');
  }

  /**
   * Processa um arquivo de áudio: transcreve e gera embedding
   * GPU é OBRIGATÓRIO para ambas operações
   */
  async processAudio(
    audioBuffer: Buffer,
    mimeType: string,
    options: AudioProcessorOptions = {}
  ): Promise<ProcessedAudio> {
    const startTime = Date.now();
    const { language, generateEmbedding = true } = options;

    // Extrair metadata básica
    const metadata = await this.extractMetadata(audioBuffer, mimeType);

    // Transcrição via OpenAI ASR
    let transcription = '';
    let transcriptionLanguage: string | undefined;
    let transcriptionConfidence: number | undefined;
    let durationSeconds: number | null =
      typeof metadata.duration === 'number' && Number.isFinite(metadata.duration) ? metadata.duration : null;

    if (this.asrConfigured) {
      try {
        logger.info({ audioSize: audioBuffer.length }, 'Transcrevendo via OpenAI ASR...');
        const result = await this.transcribeOpenAi(audioBuffer, mimeType, language);
        transcription = result.text;
        transcriptionLanguage = result.language;
        transcriptionConfidence = result.confidence;
        if (result.duration_seconds > 0) {
          durationSeconds = result.duration_seconds;
        }
        logger.info({ durationSeconds, processingTimeMs: result.processing_time_ms }, 'Transcrição OpenAI concluída');
      } catch (error) {
        logger.error({ error }, 'Erro na transcrição OpenAI ASR');
        transcription = '[Transcrição não disponível - erro no processamento]';
      }
    } else {
      logger.error('OpenAI ASR não configurado - transcrição não disponível');
      transcription = '[Transcrição não disponível - OpenAI não configurado]';
    }

    // Gerar embedding via GPU (Qwen3-Embedding-0.6B → Qdrant)
    let embedding: number[] = [];
    let embeddingModel = 'none';

    if (generateEmbedding && transcription && !transcription.startsWith('[')) {
      if (this.embeddingsConfigured) {
        try {
          const result = await this.generateTextEmbedding(transcription);
          embedding = result.embedding;
          embeddingModel = result.model;
        } catch (error) {
          logger.error({ error }, 'Erro ao gerar embedding de texto via GPU');
          embedding = [];
          embeddingModel = 'error';
        }
      } else {
        logger.error('Embeddings GPU não configurado');
        embeddingModel = 'not_configured';
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      transcriptionLength: transcription.length,
      language: transcriptionLanguage,
      durationSeconds,
      embeddingDim: embedding.length,
      embeddingModel,
      processingTimeMs,
    }, 'Áudio processado (ASR OpenAI + Embeddings GPU)');

    return {
      transcription,
      transcriptionLanguage,
      transcriptionConfidence,
      durationSeconds,
      embedding,
      embeddingModel,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Transcreve áudio via OpenAI ASR (Transcriptions API)
   */
  private async transcribeOpenAi(
    audioBuffer: Buffer,
    mimeType: string,
    language?: string
  ): Promise<{ 
    text: string; 
    language: string; 
    confidence?: number; 
    duration_seconds: number;
    processing_time_ms: number;
  }> {
    const startTime = Date.now();
    try {
      const result = await callOpenAiAsr({
        audioBuffer,
        mimeType,
        language: language && language !== 'auto' ? language : undefined,
      });

      if (!result.text || result.text.trim().length === 0) {
        throw new Error('Resposta de transcrição OpenAI vazia');
      }

      const durationSeconds = Number.isFinite(result.duration_seconds)
        ? result.duration_seconds
        : Number.isFinite(result.duration)
          ? result.duration
          : null;
      const resolvedDuration =
        typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : 0;

      return {
        text: result.text.trim(),
        language: result.language || 'unknown',
        confidence: result.confidence,
        duration_seconds: resolvedDuration,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
        throw new Error(`Timeout na transcrição OpenAI após ${ASR_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  /**
   * Verifica se o serviço está pronto (health check)
   */
  async isReadyAsync(): Promise<boolean> {
    if (!this.configured) return false;

    try {
      // Verificar se GPU Manager Service está pronto
      // BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
      const response = await fetch(`${process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010'}/ready`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Gera embedding de texto via GPU (Qwen3-Embedding-0.6B, 1024 dim → Qdrant)
   * BUG FIX 25/12/2025: Método duplicado removido - mantida apenas a versão que usa TEXT_EMBEDDING_DIM
   */
  private async generateTextEmbedding(
    text: string
  ): Promise<{ embedding: number[]; model: string }> {
    try {
      // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service para embeddings
      const gpuResponse = await requestGpu({
        serviceType: GpuServiceType.EMBEDDINGS,
        endpoint: '/embed/text',
        method: 'POST',
        priority: GpuRequestPriority.MEDIUM,
        timeout: EMBEDDING_TIMEOUT_MS,
        body: { texts: [text] },
      });

      if (!gpuResponse.success || !gpuResponse.data) {
        throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto');
      }

      const result = gpuResponse.data as {
        embedding?: number[];
        embeddings?: number[][];
        model?: string;
        dimension?: number;
        dimensions?: number;
      };
      const resolvedEmbedding = result.embedding ?? result.embeddings?.[0];

      if (!resolvedEmbedding || resolvedEmbedding.length === 0) {
        throw new Error('Resposta de embedding GPU vazia');
      }

      // Validar dimensão (SSOT) - Enterprise-Grade
      validateEmbeddingDimension(resolvedEmbedding, TEXT_EMBEDDING_DIM, 'TEXT');

      return {
        embedding: resolvedEmbedding,
        model: result.model || 'Qwen/Qwen3-Embedding-0.6B',
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Erro desconhecido ao gerar embedding: ${String(error)}`);
    }
  }

  /**
   * Extrai metadata do áudio
   */
  private async extractMetadata(
    audioBuffer: Buffer,
    mimeType: string
  ): Promise<AudioMetadata> {
    const metadata: AudioMetadata = {
      fileSize: audioBuffer.length,
    };

    metadata.format = AUDIO_EXTENSION_BY_MIME[mimeType] || 'unknown';

    try {
      if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') {
        const mp3Info = this.extractMp3Info(audioBuffer);
        if (mp3Info) {
          metadata.bitrate = mp3Info.bitrate;
          metadata.sampleRate = mp3Info.sampleRate;
          metadata.channels = mp3Info.channels;
          metadata.duration = mp3Info.duration;
        }
      } else if (mimeType === 'audio/wav' || mimeType === 'audio/wave') {
        const wavInfo = this.extractWavInfo(audioBuffer);
        if (wavInfo) {
          metadata.sampleRate = wavInfo.sampleRate;
          metadata.channels = wavInfo.channels;
          metadata.duration = wavInfo.duration;
        }
      }
    } catch (error) {
      logger.warn({ error, mimeType }, 'Não foi possível extrair metadata do áudio');
    }

    return metadata;
  }

  private extractMp3Info(buffer: Buffer): {
    bitrate: number;
    sampleRate: number;
    channels: number;
    duration: number;
  } | null {
    try {
      for (let i = 0; i < Math.min(buffer.length - 4, 8192); i++) {
        if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
          const byte1 = buffer[i + 1];
          const byte2 = buffer[i + 2];
          const byte3 = buffer[i + 3];

          const version = (byte1 >> 3) & 0x03;
          const bitrateIndex = (byte2 >> 4) & 0x0F;
          const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
          const bitrate = bitrateTable[bitrateIndex] || 128;

          const sampleRateIndex = (byte2 >> 2) & 0x03;
          const sampleRateTable: Record<number, number[]> = {
            3: [44100, 48000, 32000],
            2: [22050, 24000, 16000],
            0: [11025, 12000, 8000],
          };
          const sampleRate = (sampleRateTable[version] || sampleRateTable[3])[sampleRateIndex] || 44100;

          const mode = (byte3 >> 6) & 0x03;
          const channels = mode === 3 ? 1 : 2;

          const duration = Math.round((buffer.length * 8) / (bitrate * 1000));

          return { bitrate, sampleRate, channels, duration };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractWavInfo(buffer: Buffer): {
    sampleRate: number;
    channels: number;
    duration: number;
  } | null {
    try {
      if (buffer.slice(0, 4).toString() !== 'RIFF' ||
          buffer.slice(8, 12).toString() !== 'WAVE') {
        return null;
      }

      let offset = 12;
      while (offset < buffer.length - 8) {
        const chunkId = buffer.slice(offset, offset + 4).toString();
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
          const channels = buffer.readUInt16LE(offset + 10);
          const sampleRate = buffer.readUInt32LE(offset + 12);
          const byteRate = buffer.readUInt32LE(offset + 16);

          const dataSize = buffer.length - 44;
          const duration = Math.round(dataSize / byteRate);

          return { sampleRate, channels, duration };
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
      }
      return null;
    } catch {
      return null;
    }
  }

  isReady(): boolean {
    return this.configured;
  }

  // BUG FIX 26/12/2025: Removida função duplicada isReadyAsync (já definida na linha 233)

  getConfig(): {
    configured: boolean;
    embeddingDim: number;
    transcriptionModel: string;
    embeddingModel: string;
    gpuManager: string;
  } {
    return {
      configured: this.configured,
      embeddingDim: TEXT_EMBEDDING_DIM,
      transcriptionModel: `${OPENAI_ASR_MODEL} (OpenAI ASR)`,
      embeddingModel: 'Qwen/Qwen3-Embedding-0.6B (GPU Manager Service, 1024 dim → Qdrant)',
      gpuManager: this.embeddingsConfigured ? 'enabled' : 'disabled',
    };
  }
}

// Singleton
let audioProcessorInstance: AudioProcessorService | null = null;

export function getAudioProcessor(): AudioProcessorService {
  if (!audioProcessorInstance) {
    audioProcessorInstance = new AudioProcessorService();
  }
  return audioProcessorInstance;
}

export const audioProcessor = getAudioProcessor();

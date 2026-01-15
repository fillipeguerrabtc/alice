/**
 * Audio Processor Service - Alice Enterprise Platform
 * 
 * ARQUITETURA 100% GPU (25/12/2025):
 * - Transcrição: Canary-1B via GPU Manager Service
 * - Text embedding: Qwen3-Embedding-0.6B via GPU Manager Service (1024 dim)
 * - Extração de metadata (duração, formato, bitrate)
 * - Embeddings de texto armazenados em Qdrant
 * 
 * GPU é OBRIGATÓRIO - SEM fallback CPU (Regra 6 - sem workarounds)
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import { requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/shared-utils';

const logger = createLogger('audio-processor');

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// URL é usada internamente pelo requestGpu, não precisa ser exposta aqui

// Dimensão dos embeddings de texto (SSOT: @alice/database)
export const TEXT_EMBEDDING_DIM = EMBEDDING_DIMENSIONS.TEXT;

// Timeouts
const WHISPER_TIMEOUT_MS = 600000; // 10 min para GPU
const EMBEDDING_TIMEOUT_MS = 30000; // 30s para embeddings

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

/**
 * Audio Processor Service - ARQUITETURA ENTERPRISE (25/12/2025)
 * 
 * - Transcrição: Canary-1B GPU via GPU Manager Service
 * - Embeddings: Qwen3-Embedding-0.6B GPU via GPU Manager Service (1024 dim → Qdrant)
 * 
 * GPU é OBRIGATÓRIO - sem fallback (Regra 6)
 */
class AudioProcessorService {
  private configured: boolean;
  private whisperConfigured: boolean;
  private embeddingsConfigured: boolean;

  constructor() {
    // GPU Manager Service é sempre usado, não precisa validar URLs individuais
    // ARQUITETURA ENTERPRISE (26/12/2025): GPU é OBRIGATÓRIO para todos serviços
    this.configured = true;
    this.whisperConfigured = true;  // ASR via GPU Manager Service
    this.embeddingsConfigured = true;  // Text embeddings via GPU Manager Service
    
    logger.info({ 
      gpuManager: 'enabled',
      embeddingDim: TEXT_EMBEDDING_DIM,
    }, 'Audio Processor - ARQUITETURA ENTERPRISE (ASR + Text Embeddings → Qdrant via GPU Manager Service)');
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

    // Transcrição via GPU (ASR Canary-1B)
    let transcription = '';
    let transcriptionLanguage: string | undefined;
    let transcriptionConfidence: number | undefined;
    let durationSeconds: number | null =
      typeof metadata.duration === 'number' && Number.isFinite(metadata.duration) ? metadata.duration : null;

    if (this.whisperConfigured) {
      try {
        logger.info({ audioSize: audioBuffer.length }, 'Transcrevendo via GPU (ASR Canary-1B)...');
        const result = await this.transcribeGpu(audioBuffer, mimeType, language);
        transcription = result.text;
        transcriptionLanguage = result.language;
        transcriptionConfidence = result.confidence;
        durationSeconds = result.duration_seconds;
        logger.info({ durationSeconds, processingTimeMs: result.processing_time_ms }, 'Transcrição GPU concluída');
      } catch (error) {
        logger.error({ error }, 'Erro na transcrição GPU');
        transcription = '[Transcrição não disponível - erro no processamento]';
      }
    } else {
      logger.error('Whisper GPU não configurado - transcrição não disponível');
      transcription = '[Transcrição não disponível - GPU não configurado]';
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
    }, 'Áudio processado via GPU');

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
   * Transcreve áudio via GPU (ASR Canary via GPU Manager Service)
   */
  private async transcribeGpu(
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
    try {
      // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service para ASR
      const base64Audio = audioBuffer.toString('base64');
      const audioDataUri = `data:${mimeType};base64,${base64Audio}`;
      
      const gpuResponse = await requestGpu({
        serviceType: GpuServiceType.ASR,
        endpoint: '/transcribe/json',
        method: 'POST',
        priority: GpuRequestPriority.LOW,
        timeout: WHISPER_TIMEOUT_MS,
        body: {
          audio: audioDataUri,
          language: (!language || language === 'auto') ? null : language,
        },
      });

      if (!gpuResponse.success || !gpuResponse.data) {
        throw new Error(gpuResponse.error || 'Erro na transcrição de áudio');
      }

      const result = gpuResponse.data as {
        text: string;
        language: string;
        confidence?: number;
        duration_seconds: number;
        processing_time_ms: number;
      };

      return {
        text: result.text.trim(),
        language: result.language,
        confidence: result.confidence,
        duration_seconds: result.duration_seconds,
        processing_time_ms: result.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        throw new Error(`Timeout na transcrição GPU após ${WHISPER_TIMEOUT_MS}ms`);
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
        body: { text },
      });

      if (!gpuResponse.success || !gpuResponse.data) {
        throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto');
      }

      const result = gpuResponse.data as {
        embedding: number[];
        model: string;
        dimension: number;
      };

      if (!result.embedding || result.embedding.length === 0) {
        throw new Error('Resposta de embedding GPU vazia');
      }

      // Validar dimensão (SSOT) - Enterprise-Grade
      validateEmbeddingDimension(result.embedding, TEXT_EMBEDDING_DIM, 'TEXT');

      return {
        embedding: result.embedding,
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

    const formatMap: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'audio/aac': 'aac',
      'audio/flac': 'flac',
      'audio/m4a': 'm4a',
    };
    metadata.format = formatMap[mimeType] || 'unknown';

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
      transcriptionModel: 'Canary-1B (GPU Manager Service)',
      embeddingModel: 'Qwen/Qwen3-Embedding-0.6B (GPU Manager Service, 1024 dim → Qdrant)',
      gpuManager: 'enabled',
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

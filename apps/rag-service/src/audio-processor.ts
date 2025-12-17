/**
 * Audio Processor Service - Alice Enterprise Platform
 * 
 * ARQUITETURA 100% GPU (Opção B - Alta Qualidade - 15/12/2025):
 * - Transcrição: Whisper large-v3 via GPU (Salad Cloud)
 * - Text embedding: BGE-M3 via GPU (Salad Cloud, 1024 dim)
 * - Extração de metadata (duração, formato, bitrate)
 * 
 * GPU é OBRIGATÓRIO - SEM fallback CPU (Regra 6 - sem workarounds)
 * Schema usa vector(1024) - incompatível com CPU (768 dim)
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { validateEmbeddingDimension } from '@alice/database';

const logger = createLogger('audio-processor');

// URLs dos serviços GPU (Salad Cloud) - OBRIGATÓRIOS
const SALAD_WHISPER_URL = process.env.SALAD_WHISPER_URL || '';
const EMBEDDINGS_GPU_URL = process.env.EMBEDDINGS_GPU_URL || '';

// Dimensão dos embeddings de texto - ARQUITETURA DUAL-DIMENSION (17/12/2025)
// gte-Qwen2-7B-instruct: 3584 dim (dimensão NATIVA do modelo)
// Armazenado como halfvec(3584) no PostgreSQL (limite HNSW: 4000)
export const TEXT_EMBEDDING_DIM = 3584;

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
 * Audio Processor Service - ARQUITETURA 100% GPU
 * 
 * - Transcrição: Whisper large-v3 GPU (Salad Cloud)
 * - Embeddings: BGE-M3 GPU (Salad Cloud, 1024 dim)
 * 
 * GPU é OBRIGATÓRIO - sem fallback (Regra 6)
 */
class AudioProcessorService {
  private whisperConfigured: boolean;
  private embeddingsConfigured: boolean;

  constructor() {
    this.whisperConfigured = SALAD_WHISPER_URL.length > 0;
    this.embeddingsConfigured = EMBEDDINGS_GPU_URL.length > 0;
    
    if (!this.whisperConfigured) {
      logger.warn('SALAD_WHISPER_URL não configurado - transcrição não funcionará');
    }
    if (!this.embeddingsConfigured) {
      logger.warn('EMBEDDINGS_GPU_URL não configurado - embeddings não funcionarão');
    }
    
    logger.info({ 
      whisperUrl: SALAD_WHISPER_URL || '(não configurado)',
      embeddingsUrl: EMBEDDINGS_GPU_URL || '(não configurado)',
      whisperConfigured: this.whisperConfigured,
      embeddingsConfigured: this.embeddingsConfigured,
      embeddingDim: TEXT_EMBEDDING_DIM,
    }, 'Audio Processor - ARQUITETURA 100% GPU (Whisper + BGE-M3)');
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

    // Transcrição via GPU (Whisper large-v3)
    let transcription = '';
    let transcriptionLanguage: string | undefined;
    let transcriptionConfidence: number | undefined;
    let durationSeconds: number | null =
      typeof metadata.duration === 'number' && Number.isFinite(metadata.duration) ? metadata.duration : null;

    if (this.whisperConfigured) {
      try {
        logger.info({ audioSize: audioBuffer.length }, 'Transcrevendo via GPU (Whisper large-v3)...');
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

    // Gerar embedding via GPU (BGE-M3)
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
   * Transcreve áudio via GPU (Whisper large-v3)
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
    const base64Audio = audioBuffer.toString('base64');
    const audioDataUri = `data:${mimeType};base64,${base64Audio}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);

    try {
      const response = await fetch(`${SALAD_WHISPER_URL}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: audioDataUri,
          language: (!language || language === 'auto') ? null : language,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper GPU API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as {
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout na transcrição GPU após ${WHISPER_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Gera embedding de texto via GPU (BGE-M3, 1024 dim)
   */
  private async generateTextEmbedding(
    text: string
  ): Promise<{ embedding: number[]; model: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    try {
      const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embeddings GPU API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as {
        embedding: number[];
        model: string;
        dimension: number;
      };

      if (!result.embedding || result.embedding.length === 0) {
        throw new Error('Resposta de embedding GPU vazia');
      }

      validateEmbeddingDimension(result.embedding, TEXT_EMBEDDING_DIM, 'TEXT');

      return {
        embedding: result.embedding,
        model: result.model || 'BAAI/bge-m3',
      };
    } finally {
      clearTimeout(timeoutId);
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
    return this.whisperConfigured && this.embeddingsConfigured;
  }

  async isReadyAsync(): Promise<boolean> {
    if (!this.isReady()) return false;

    const checkEndpoint = async (url: string, path: string): Promise<boolean> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${url}${path}`, {
          method: 'GET',
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const [whisperReady, embeddingsReady] = await Promise.all([
      checkEndpoint(SALAD_WHISPER_URL, '/ready'),
      checkEndpoint(EMBEDDINGS_GPU_URL, '/ready'),
    ]);

    return whisperReady && embeddingsReady;
  }

  getConfig(): {
    configured: boolean;
    embeddingDim: number;
    transcriptionModel: string;
    embeddingModel: string;
    whisperUrl: string;
    embeddingsUrl: string;
  } {
    return {
      configured: this.isReady(),
      embeddingDim: TEXT_EMBEDDING_DIM,
      transcriptionModel: 'faster-whisper large-v3 (GPU - Salad Cloud)',
      embeddingModel: 'BAAI/bge-m3 (GPU - Salad Cloud)',
      whisperUrl: SALAD_WHISPER_URL,
      embeddingsUrl: EMBEDDINGS_GPU_URL,
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

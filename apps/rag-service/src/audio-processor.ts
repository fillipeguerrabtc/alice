/**
 * Audio Processor Service - Alice Enterprise Platform
 * 
 * Processamento de áudio:
 * - Transcrição via Whisper (Salad Cloud)
 * - Text embedding da transcrição
 * - Extração de metadata (duração, formato, bitrate)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'audio-processor' });

// Configuração Salad Cloud
const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const SALAD_WHISPER_ENDPOINT = process.env.SALAD_WHISPER_ENDPOINT || 'https://api.salad.com/api/public';

// Dimensão dos embeddings de texto (multilingual-e5-base: 768 dim)
export const TEXT_EMBEDDING_DIM = 768;

export interface AudioMetadata {
  duration?: number; // segundos
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
  embedding: number[];
  embeddingModel: string;
  metadata: AudioMetadata;
  processedAt: string;
  processingTimeMs: number;
}

export interface AudioProcessorOptions {
  language?: string; // 'pt', 'en', etc. ou 'auto' para detecção
  generateEmbedding?: boolean;
}

class AudioProcessorService {
  private isConfigured: boolean = false;

  constructor() {
    if (SALAD_API_KEY && SALAD_ORGANIZATION_ID) {
      this.isConfigured = true;
      logger.info('Audio Processor configurado com Salad Cloud (Whisper)');
    } else {
      logger.warn('SALAD_API_KEY ou SALAD_ORGANIZATION_ID não configurados - transcrição indisponível');
    }
  }

  /**
   * Processa um arquivo de áudio: transcreve e gera embedding
   */
  async processAudio(
    audioBuffer: Buffer,
    mimeType: string,
    options: AudioProcessorOptions = {}
  ): Promise<ProcessedAudio> {
    const startTime = Date.now();
    const { language = 'auto', generateEmbedding = true } = options;

    // Extrair metadata básica
    const metadata = await this.extractMetadata(audioBuffer, mimeType);

    // Transcrever via Whisper
    let transcription = '';
    let transcriptionLanguage: string | undefined;
    let transcriptionConfidence: number | undefined;

    if (this.isConfigured) {
      try {
        const result = await this.transcribeWithWhisper(audioBuffer, mimeType, language);
        transcription = result.text;
        transcriptionLanguage = result.language;
        transcriptionConfidence = result.confidence;
      } catch (error) {
        logger.error({ error }, 'Erro na transcrição Whisper');
        transcription = '[Transcrição não disponível - erro no processamento]';
      }
    } else {
      // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO (Regra 6 CLAUDE.md - PROIBIDO mocks)
      logger.error('SALAD_API_KEY não configurado - transcrição indisponível em produção');
      throw new Error('Configuração Salad Cloud obrigatória para processamento de áudio. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.');
    }

    // Gerar embedding do texto transcrito
    let embedding: number[] = [];
    let embeddingModel = 'none';

    if (generateEmbedding && transcription && !transcription.startsWith('[')) {
      if (this.isConfigured) {
        try {
          const result = await this.generateTextEmbedding(transcription);
          embedding = result.embedding;
          embeddingModel = result.model;
        } catch (error) {
          logger.error({ error }, 'Erro ao gerar embedding do texto');
          embedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
          embeddingModel = 'error-fallback-zero';
        }
      } else {
        // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO (Regra 6 CLAUDE.md - PROIBIDO mocks)
        // Este bloco não deve ser alcançado pois já lançamos erro acima
        logger.error('SALAD_API_KEY não configurado - embedding indisponível');
        embedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
        embeddingModel = 'error-not-configured';
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      transcriptionLength: transcription.length,
      language: transcriptionLanguage,
      embeddingDim: embedding.length,
      embeddingModel,
      processingTimeMs,
    }, 'Áudio processado');

    return {
      transcription,
      transcriptionLanguage,
      transcriptionConfidence,
      embedding,
      embeddingModel,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Transcreve áudio usando Whisper via Salad Cloud
   */
  private async transcribeWithWhisper(
    audioBuffer: Buffer,
    mimeType: string,
    language: string
  ): Promise<{ text: string; language: string; confidence?: number }> {
    const base64Audio = audioBuffer.toString('base64');
    
    try {
      const response = await fetch(`${SALAD_WHISPER_ENDPOINT}/inference/whisper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Salad-Api-Key': SALAD_API_KEY!,
          'Salad-Organization': SALAD_ORGANIZATION_ID!,
        },
        body: JSON.stringify({
          audio: `data:${mimeType};base64,${base64Audio}`,
          model: 'whisper-large-v3',
          language: language === 'auto' ? undefined : language,
          task: 'transcribe',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { 
        text: string; 
        language: string; 
        segments?: Array<{ confidence?: number }>;
      };

      // Calcular confiança média dos segmentos
      let avgConfidence: number | undefined;
      if (result.segments && result.segments.length > 0) {
        const confidences = result.segments
          .filter(s => s.confidence !== undefined)
          .map(s => s.confidence!);
        if (confidences.length > 0) {
          avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        }
      }

      return {
        text: result.text.trim(),
        language: result.language,
        confidence: avgConfidence,
      };
    } catch (error) {
      logger.error({ error }, 'Erro na API Whisper');
      throw error;
    }
  }

  /**
   * Gera embedding de texto via Salad Cloud
   */
  private async generateTextEmbedding(
    text: string
  ): Promise<{ embedding: number[]; model: string }> {
    try {
      // REGRA 6: Serviço local autônomo - não depende de API externa
      // Serviço interno na rede Docker privada - não requer autenticação
      const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL || 'http://alice-clip-inference:8080';
      
      const response = await fetch(`${CLIP_SERVICE_URL}/inference/text-embedding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { 
        embedding: number[];
        model: string;
        processing_time_ms: number;
      };

      if (!result.embedding || result.embedding.length === 0) {
        throw new Error('Resposta de embedding vazia');
      }

      // Validar dimensão (deve ser 768 para multilingual-e5-base)
      if (result.embedding.length !== 768) {
        logger.warn(`Embedding com dimensão inesperada: ${result.embedding.length} (esperado: 768)`);
      }

      return {
        embedding: result.embedding,
        model: result.model || 'intfloat/multilingual-e5-base',
      };
    } catch (error) {
      logger.error({ error }, 'Erro na API de Embeddings');
      throw error;
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

    // Determinar formato baseado no MIME type
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

    // Tentar extrair informações básicas do header
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

  /**
   * Extrai informações básicas de arquivo MP3
   */
  private extractMp3Info(buffer: Buffer): {
    bitrate: number;
    sampleRate: number;
    channels: number;
    duration: number;
  } | null {
    try {
      // Procurar frame header MP3 (sync word: 0xFF + 0xE0-0xFF)
      for (let i = 0; i < Math.min(buffer.length - 4, 8192); i++) {
        if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
          const byte1 = buffer[i + 1];
          const byte2 = buffer[i + 2];
          const byte3 = buffer[i + 3];

          // Versão MPEG
          const version = (byte1 >> 3) & 0x03;
          
          // Tabela de bitrates (Layer III, MPEG1)
          const bitrateIndex = (byte2 >> 4) & 0x0F;
          const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
          const bitrate = bitrateTable[bitrateIndex] || 128;

          // Tabela de sample rates
          const sampleRateIndex = (byte2 >> 2) & 0x03;
          const sampleRateTable: Record<number, number[]> = {
            3: [44100, 48000, 32000], // MPEG1
            2: [22050, 24000, 16000], // MPEG2
            0: [11025, 12000, 8000],  // MPEG2.5
          };
          const sampleRate = (sampleRateTable[version] || sampleRateTable[3])[sampleRateIndex] || 44100;

          // Modo (stereo/mono)
          const mode = (byte3 >> 6) & 0x03;
          const channels = mode === 3 ? 1 : 2;

          // Estimar duração baseado no tamanho e bitrate
          const duration = Math.round((buffer.length * 8) / (bitrate * 1000));

          return { bitrate, sampleRate, channels, duration };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai informações básicas de arquivo WAV
   */
  private extractWavInfo(buffer: Buffer): {
    sampleRate: number;
    channels: number;
    duration: number;
  } | null {
    try {
      // Verificar header RIFF/WAVE
      if (buffer.slice(0, 4).toString() !== 'RIFF' ||
          buffer.slice(8, 12).toString() !== 'WAVE') {
        return null;
      }

      // Procurar chunk 'fmt '
      let offset = 12;
      while (offset < buffer.length - 8) {
        const chunkId = buffer.slice(offset, offset + 4).toString();
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
          const channels = buffer.readUInt16LE(offset + 10);
          const sampleRate = buffer.readUInt32LE(offset + 12);
          const byteRate = buffer.readUInt32LE(offset + 16);

          // Estimar duração
          const dataSize = buffer.length - 44; // Estimativa
          const duration = Math.round(dataSize / byteRate);

          return { sampleRate, channels, duration };
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++; // Padding
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Verifica se o serviço está configurado
   */
  isReady(): boolean {
    // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO (Regra 6 CLAUDE.md)
    return this.isConfigured;
  }

  /**
   * Retorna informações sobre a configuração
   */
  getConfig(): { 
    configured: boolean; 
    embeddingDim: number; 
    transcriptionModel: string;
    embeddingModel: string;
  } {
    return {
      configured: this.isConfigured, // Whisper ainda usa Salad Cloud, embeddings são locais
      embeddingDim: TEXT_EMBEDDING_DIM,
      transcriptionModel: this.isConfigured ? 'whisper-large-v3 (Salad Cloud)' : 'NÃO CONFIGURADO',
      embeddingModel: 'intfloat/multilingual-e5-base (Local)', // Embeddings sempre locais (Regra 6)
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

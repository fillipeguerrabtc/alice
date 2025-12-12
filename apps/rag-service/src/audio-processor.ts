/**
 * Audio Processor Service - Alice Enterprise Platform
 * 
 * Processamento de áudio 100% LOCAL (Regra 6 CLAUDE.md - Autonomia Total):
 * - Transcrição via faster-whisper (CPU Hetzner - 100% LOCAL)
 * - Text embedding da transcrição via multilingual-e5-base (CPU Hetzner - 100% LOCAL)
 * - Extração de metadata (duração, formato, bitrate)
 * 
 * ARQUITETURA AUTÔNOMA (Regra 6 CLAUDE.md):
 * - Transcrição: faster-whisper medium (100% LOCAL via CPU no Hetzner)
 * - Embeddings: multilingual-e5-base (100% LOCAL via CPU no Hetzner)
 * - NENHUMA dependência externa para processamento de áudio
 * - Serviço interno na rede Docker privada (alice-network)
 * 
 * Autor: Fillipe Guerra
 * Data: 11 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { validateEmbeddingDimension } from '@alice/database';

const logger = createLogger('audio-processor');

// URL do serviço multimodal LOCAL (CPU Hetzner) - embeddings + transcrição
const CLIP_SERVICE_URL = (() => {
  const raw = process.env.CLIP_SERVICE_URL;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : 'http://alice-clip-inference:8080';
})();

// Dimensão dos embeddings de texto (multilingual-e5-base: 768 dim)
export const TEXT_EMBEDDING_DIM = 768;

/**
 * Valida e parseia variável de ambiente como número inteiro positivo.
 * Fail-fast (Regra 6): aborta se valor inválido em produção.
 * 
 * @param envVar Nome da variável de ambiente
 * @param defaultValue Valor padrão se variável não estiver definida
 * @param minValue Valor mínimo permitido (default: 1)
 * @returns Número inteiro positivo validado
 * @throws Error se valor inválido em produção
 */
function parsePositiveIntEnv(envVar: string, defaultValue: number, minValue: number = 1): number {
  const rawValue = process.env[envVar];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = parseInt(rawValue, 10);
  // #region agent log (debug)
  typeof fetch === 'function' && fetch('http://127.0.0.1:7242/ingest/6d7f1213-e45f-42d8-962f-5affaf2cc480',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/rag-service/src/audio-processor.ts:parsePositiveIntEnv',message:'Parse env int (pre-validation)',data:{envVar,rawValue,parsed,defaultValue,minValue,nodeEnv:process.env.NODE_ENV ?? 'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'verify-1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion agent log (debug)
  
  // Enterprise-grade: validar que é um número finito positivo
  if (!Number.isFinite(parsed) || parsed < minValue) {
    const errorMsg = `Variável de ambiente ${envVar} inválida: "${rawValue}". Deve ser um número inteiro >= ${minValue}`;
    // #region agent log (debug)
    typeof fetch === 'function' && fetch('http://127.0.0.1:7242/ingest/6d7f1213-e45f-42d8-962f-5affaf2cc480',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/rag-service/src/audio-processor.ts:parsePositiveIntEnv',message:'Env int invalid (branch)',data:{envVar,rawValue,parsed,defaultValue,minValue,nodeEnv:process.env.NODE_ENV ?? 'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'verify-1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion agent log (debug)
    
    // Regra 6: Fail-fast em produção
    if (process.env.NODE_ENV === 'production') {
      logger.error({ envVar, rawValue, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    
    // Desenvolvimento: usar default com warning
    logger.warn({ envVar, rawValue, parsed, defaultValue }, `${errorMsg}. Usando valor padrão: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

// Timeout para transcrição (áudios longos podem demorar)
// Enterprise-grade: validação fail-fast (Regra 6)
const TRANSCRIPTION_TIMEOUT_MS = parsePositiveIntEnv('TRANSCRIPTION_TIMEOUT_MS', 300000, 1000); // 5 min default, mínimo 1s

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
  /**
   * Duração do áudio em segundos (observabilidade).
   * `null` significa "desconhecido" (ex: falha na transcrição), evitando reportar `0` (que pode significar áudio vazio).
   */
  durationSeconds: number | null;
  embedding: number[];
  embeddingModel: string;
  metadata: AudioMetadata;
  processedAt: string;
  processingTimeMs: number;
}

export interface AudioProcessorOptions {
  language?: string; // 'pt', 'en', etc. ou undefined para detecção automática
  generateEmbedding?: boolean;
}

/**
 * Audio Processor Service - 100% LOCAL
 * 
 * Processa áudio usando serviços locais no Hetzner:
 * - Transcrição: faster-whisper via clip-inference-service
 * - Embeddings: multilingual-e5-base via clip-inference-service
 */
class AudioProcessorService {
  private clipServiceUrl: string;

  constructor() {
    // Enterprise-grade: validar CLIP_SERVICE_URL no construtor (fail-fast - Regra 6)
    // Segue padrão de ImageProcessorService para consistência
    if (typeof CLIP_SERVICE_URL !== 'string' || CLIP_SERVICE_URL.length === 0) {
      const errorMsg = 'CLIP_SERVICE_URL não configurado ou inválido. Audio Processor requer serviço local de embeddings.';
      // #region agent log (debug)
      typeof fetch === 'function' && fetch('http://127.0.0.1:7242/ingest/6d7f1213-e45f-42d8-962f-5affaf2cc480',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/rag-service/src/audio-processor.ts:AudioProcessorService:constructor',message:'CLIP_SERVICE_URL invalid in constructor',data:{clipServiceUrl:CLIP_SERVICE_URL ?? null,nodeEnv:process.env.NODE_ENV ?? 'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'verify-1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion agent log (debug)
      
      // Regra 6: Fail-fast em produção
      if (process.env.NODE_ENV === 'production') {
        logger.error({ clipServiceUrl: CLIP_SERVICE_URL }, errorMsg);
        throw new Error(errorMsg);
      }
      
      // Desenvolvimento: warning mas permite continuar (pode ser configurado depois)
      logger.warn({ clipServiceUrl: CLIP_SERVICE_URL }, `${errorMsg} Continuando em modo desenvolvimento.`);
    }
    
    this.clipServiceUrl = CLIP_SERVICE_URL;
    // #region agent log (debug)
    typeof fetch === 'function' && fetch('http://127.0.0.1:7242/ingest/6d7f1213-e45f-42d8-962f-5affaf2cc480',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/rag-service/src/audio-processor.ts:AudioProcessorService:constructor',message:'Audio processor constructed',data:{clipServiceUrl:this.clipServiceUrl,timeoutMs:TRANSCRIPTION_TIMEOUT_MS,nodeEnv:process.env.NODE_ENV ?? 'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'verify-1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion agent log (debug)
    logger.info({ 
      clipServiceUrl: this.clipServiceUrl,
      transcriptionTimeout: TRANSCRIPTION_TIMEOUT_MS,
    }, 'Audio Processor inicializado - 100% LOCAL (CPU Hetzner)');
  }

  /**
   * Processa um arquivo de áudio: transcreve e gera embedding
   * TUDO LOCAL via clip-inference-service (CPU Hetzner)
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

    // Transcrever via Whisper LOCAL (faster-whisper no clip-inference-service)
    let transcription = '';
    let transcriptionLanguage: string | undefined;
    let transcriptionConfidence: number | undefined;
    // Preferir duração por metadata (quando disponível) para reduzir `null` em cenários de falha na transcrição.
    // Sem hardcoded: usa extração real do header (mp3/wav) quando possível.
    let durationSeconds: number | null =
      typeof metadata.duration === 'number' && Number.isFinite(metadata.duration) ? metadata.duration : null;

    try {
      const result = await this.transcribeLocal(audioBuffer, mimeType, language);
      transcription = result.text;
      transcriptionLanguage = result.language;
      transcriptionConfidence = result.confidence;
      durationSeconds = result.duration_seconds; // Capturar duração retornada pelo Whisper
    } catch (error) {
      logger.error({ error }, 'Erro na transcrição local (faster-whisper)');
      transcription = '[Transcrição não disponível - erro no processamento]';
      // durationSeconds mantém fallback por metadata (se disponível) em caso de erro.
    }

    // Gerar embedding do texto transcrito (100% LOCAL)
    let embedding: number[] = [];
    let embeddingModel = 'none';

    if (generateEmbedding && transcription && !transcription.startsWith('[')) {
      try {
        const result = await this.generateTextEmbedding(transcription);
        embedding = result.embedding;
        embeddingModel = result.model;
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar embedding do texto (serviço local)');
        // Regra 6 (CLAUDE.md): PROIBIDO retornar embeddings "falsos" (ex: vetor de zeros).
        // Em caso de falha, retornamos "sem embedding" e deixamos o call site persistir como NULL (ou ignorar).
        embedding = [];
        embeddingModel = 'unavailable';
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      transcriptionLength: transcription.length,
      language: transcriptionLanguage,
      durationSeconds, // Incluir duração no log para observabilidade
      embeddingDim: embedding.length,
      embeddingModel,
      processingTimeMs,
    }, 'Áudio processado (100% LOCAL)');

    return {
      transcription,
      transcriptionLanguage,
      transcriptionConfidence,
      durationSeconds, // Propagar duração para observabilidade e analytics
      embedding,
      embeddingModel,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Transcreve áudio usando faster-whisper LOCAL (clip-inference-service)
   * 
   * REGRA 6: Autonomia Total - transcrição 100% local via CPU no Hetzner
   * Serviço interno na rede Docker privada - não requer autenticação
   */
  private async transcribeLocal(
    audioBuffer: Buffer,
    mimeType: string,
    language?: string
  ): Promise<{ text: string; language: string; confidence?: number; duration_seconds: number }> {
    const base64Audio = audioBuffer.toString('base64');
    const audioDataUri = `data:${mimeType};base64,${base64Audio}`;

    const controller = new AbortController();
    // #region agent log (debug)
    typeof fetch === 'function' && fetch('http://127.0.0.1:7242/ingest/6d7f1213-e45f-42d8-962f-5affaf2cc480',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/rag-service/src/audio-processor.ts:transcribeLocal',message:'Transcribe timeout configured',data:{timeoutMs:TRANSCRIPTION_TIMEOUT_MS,isFinite:Number.isFinite(TRANSCRIPTION_TIMEOUT_MS),mimeType,language:language ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'verify-1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion agent log (debug)
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.clipServiceUrl}/inference/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: audioDataUri,
          // 'auto' ou undefined = detecção automática (envia null para faster-whisper)
          language: (!language || language === 'auto') ? null : language,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transcription API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as {
        text: string;
        language: string;  // Idioma DETECTADO pelo modelo
        requested_language?: string | null;  // Idioma SOLICITADO (pode ser null = auto)
        confidence?: number;
        duration_seconds: number;
        processing_time_ms: number;
        model: string;
      };

      logger.debug({
        detectedLanguage: result.language,
        requestedLanguage: result.requested_language,
        durationSeconds: result.duration_seconds,
        processingTimeMs: result.processing_time_ms,
        model: result.model,
      }, 'Transcrição local concluída');

      return {
        text: result.text.trim(),
        language: result.language,  // Retorna idioma DETECTADO (compatível com contrato atual)
        confidence: result.confidence,
        duration_seconds: result.duration_seconds,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout na transcrição após ${TRANSCRIPTION_TIMEOUT_MS}ms`);
      }
      logger.error({ error }, 'Erro na transcrição local');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Gera embedding de texto via serviço local (multilingual-e5-base)
   * 
   * REGRA 6: Autonomia Total - embeddings são 100% locais via CPU no Hetzner
   * Serviço interno na rede Docker privada - não requer autenticação
   */
  private async generateTextEmbedding(
    text: string
  ): Promise<{ embedding: number[]; model: string }> {
    try {
      const response = await fetch(`${this.clipServiceUrl}/inference/text-embedding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          context: 'passage', // Transcrições de áudio são documentos sendo indexados
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

      // Validar dimensão (deve ser 768 para multilingual-e5-base) - Enterprise-Grade
      validateEmbeddingDimension(result.embedding, 768, 'TEXT');

      return {
        embedding: result.embedding,
        model: result.model || 'intfloat/multilingual-e5-base',
      };
    } catch (error) {
      logger.error({ error }, 'Erro na API de Embeddings local');
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
   * Verifica se o serviço está configurado (síncrono).
   * 
   * IMPORTANTE (contrato estável):
   * - `isReady()` é **síncrono** e indica apenas se o processor está "configurado" localmente.
   * - Para prontidão REAL (com checagem de rede/capabilities), use `isReadyAsync()`.
   */
  isReady(): boolean {
    return typeof this.clipServiceUrl === 'string' && this.clipServiceUrl.length > 0;
  }

  /**
   * Readiness real (assíncrono): valida conectividade com o `alice-clip-inference`
   * (capabilities Whisper + text-embedding).
   *
   * Regra 16: Best Practices 2025 - health checks robustos para observabilidade
   */
  private async checkReadyAsync(): Promise<boolean> {
    // Audio processor depende APENAS das capacidades: whisper + text-embedding.
    // Não deve depender do status global do serviço (/health), pois pode estar "degraded" por outras capacidades.
    if (!this.isReady()) return false;

    const checkCapabilityReady = async (capabilityPath: string): Promise<boolean> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${this.clipServiceUrl}${capabilityPath}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          logger.warn(
            { status: response.status, capabilityPath, serviceUrl: this.clipServiceUrl },
            'Readiness de capability falhou'
          );
          return false;
        }

        return true;
      } catch (error) {
        logger.error(
          { error, capabilityPath, serviceUrl: this.clipServiceUrl },
          'Erro ao verificar readiness de capability'
        );
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const [whisperReady, textEmbeddingReady] = await Promise.all([
      checkCapabilityReady('/ready/whisper'),
      checkCapabilityReady('/ready/text-embedding'),
    ]);

    return whisperReady && textEmbeddingReady;
  }

  /**
   * Alias explícito para padronização com outros processors.
   * Contrato: SEMPRE assíncrono e retorna `Promise<boolean>`.
   */
  async isReadyAsync(): Promise<boolean> {
    return await this.checkReadyAsync();
  }

  /**
   * Retorna informações sobre a configuração
   */
  getConfig(): {
    configured: boolean;
    embeddingDim: number;
    transcriptionModel: string;
    embeddingModel: string;
    serviceUrl: string;
  } {
    // "configured" aqui significa que o serviço possui URL configurada.
    // O estado de prontidão real deve ser avaliado via `await isReadyAsync()` (health check com timeout).
    return {
      configured: typeof this.clipServiceUrl === 'string' && this.clipServiceUrl.length > 0,
      embeddingDim: TEXT_EMBEDDING_DIM,
      transcriptionModel: 'faster-whisper medium (LOCAL - CPU Hetzner)',
      embeddingModel: 'intfloat/multilingual-e5-base (LOCAL - CPU Hetzner)',
      serviceUrl: this.clipServiceUrl,
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

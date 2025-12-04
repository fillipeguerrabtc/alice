/**
 * Video Processor Service - Alice Enterprise Platform
 * 
 * Processamento de vídeos:
 * - Extração de áudio via FFmpeg
 * - Transcrição via Whisper (Salad Cloud)
 * - Extração de frames chave para CLIP embeddings
 * - Text embeddings da transcrição
 * - Circuit Breaker para resiliência (Regra 16 replit.md)
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import { getAudioProcessor, TEXT_EMBEDDING_DIM } from './audio-processor.js';
import { getImageProcessor, CLIP_EMBEDDING_DIM } from './image-processor.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const logger = createLogger('video-processor');

// Configuração
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const MAX_VIDEO_DURATION_SECONDS = parseInt(process.env.MAX_VIDEO_DURATION_SECONDS || '600', 10); // 10 minutos
const FRAMES_PER_MINUTE = parseInt(process.env.FRAMES_PER_MINUTE || '6', 10); // 6 frames por minuto = 1 a cada 10s
const MAX_FRAMES = parseInt(process.env.MAX_FRAMES || '30', 10); // Máximo de frames para processar

export interface VideoMetadata {
  duration?: number; // segundos
  width?: number;
  height?: number;
  format?: string;
  codec?: string;
  frameRate?: number;
  bitrate?: number;
  hasAudio?: boolean;
  audioCodec?: string;
  fileSize: number;
}

export interface ProcessedVideo {
  // Transcrição do áudio
  transcription: string;
  transcriptionLanguage?: string;
  transcriptionConfidence?: number;
  
  // Embeddings
  textEmbedding: number[]; // 1536 dim - da transcrição
  frameEmbeddings: number[][]; // Array de CLIP embeddings (768 dim cada) dos frames
  combinedEmbedding: number[]; // Embedding combinado para busca
  
  // Metadados
  embeddingModel: string;
  metadata: VideoMetadata;
  framesExtracted: number;
  processedAt: string;
  processingTimeMs: number;
}

export interface VideoProcessorOptions {
  language?: string; // 'pt', 'en', 'auto'
  extractFrames?: boolean;
  maxFrames?: number;
  generateTranscription?: boolean;
}

// ============================================================================
// CIRCUIT BREAKER - FFmpeg (Regra 16 - Melhores Práticas 2025)
// ============================================================================

interface FFmpegParams {
  inputPath: string;
  outputPath: string;
  args: string[];
}

async function runFFmpegInternal(params: FFmpegParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-i', params.inputPath, ...params.args, '-y', params.outputPath];
    
    logger.debug({ args }, 'Executando FFmpeg');
    
    const ffmpeg = spawn(FFMPEG_PATH, args);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg falhou com código ${code}: ${stderr.slice(-500)}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      reject(new Error(`Erro ao executar FFmpeg: ${err.message}`));
    });
  });
}

const ffmpegBreaker = createCircuitBreaker(runFFmpegInternal, {
  name: 'ffmpeg',
  ...CIRCUIT_BREAKER_PRESETS.default,
  timeout: 120000, // 2 minutos para processamento de vídeo
});

async function runFFmpeg(params: FFmpegParams): Promise<void> {
  return ffmpegBreaker.fire(params) as Promise<void>;
}

// ============================================================================
// VIDEO PROCESSOR SERVICE
// ============================================================================

class VideoProcessorService {
  private isConfigured: boolean = false;
  private tempDir: string;
  
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'alice-video-processor');
    this.checkConfiguration();
  }
  
  private async checkConfiguration(): Promise<void> {
    try {
      // Verificar se FFmpeg está disponível
      await this.runCommand(FFMPEG_PATH, ['-version']);
      await this.runCommand(FFPROBE_PATH, ['-version']);
      
      // Verificar se Salad Cloud está configurado
      const audioProcessor = getAudioProcessor();
      const imageProcessor = getImageProcessor();
      
      if (audioProcessor.isReady() && imageProcessor.isReady()) {
        this.isConfigured = true;
        logger.info('Video Processor configurado com FFmpeg + Salad Cloud');
      } else {
        logger.warn('Salad Cloud não configurado - embeddings de vídeo indisponíveis');
      }
    } catch (error) {
      logger.warn({ error }, 'FFmpeg não disponível - processamento de vídeo indisponível');
      this.isConfigured = false;
    }
  }
  
  private async runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${cmd} falhou: ${stderr}`));
        }
      });
      
      proc.on('error', reject);
    });
  }
  
  /**
   * Processa um vídeo: extrai áudio, transcreve, extrai frames e gera embeddings
   */
  async processVideo(
    videoBuffer: Buffer,
    mimeType: string,
    options: VideoProcessorOptions = {}
  ): Promise<ProcessedVideo> {
    const startTime = Date.now();
    const {
      language = 'auto',
      extractFrames = true,
      maxFrames = MAX_FRAMES,
      generateTranscription = true,
    } = options;
    
    if (!this.isConfigured) {
      throw new Error('Video Processor não configurado. Verifique FFmpeg e Salad Cloud.');
    }
    
    // Criar diretório temporário se não existir
    if (!existsSync(this.tempDir)) {
      await mkdir(this.tempDir, { recursive: true });
    }
    
    // Gerar ID único para este processamento
    const processId = crypto.randomUUID();
    const inputPath = path.join(this.tempDir, `${processId}_input.video`);
    const audioPath = path.join(this.tempDir, `${processId}_audio.wav`);
    const framesDir = path.join(this.tempDir, `${processId}_frames`);
    
    try {
      // Salvar vídeo temporariamente
      await writeFile(inputPath, videoBuffer);
      
      // Extrair metadados
      const metadata = await this.extractMetadata(inputPath, videoBuffer.length);
      
      // Verificar duração máxima
      if (metadata.duration && metadata.duration > MAX_VIDEO_DURATION_SECONDS) {
        throw new Error(`Vídeo muito longo: ${metadata.duration}s. Máximo permitido: ${MAX_VIDEO_DURATION_SECONDS}s`);
      }
      
      // Extrair áudio
      let transcription = '';
      let transcriptionLanguage: string | undefined;
      let transcriptionConfidence: number | undefined;
      let textEmbedding: number[] = [];
      
      if (generateTranscription && metadata.hasAudio) {
        logger.info({ processId }, 'Extraindo áudio do vídeo...');
        
        await runFFmpeg({
          inputPath,
          outputPath: audioPath,
          args: [
            '-vn', // Sem vídeo
            '-acodec', 'pcm_s16le', // WAV PCM
            '-ar', '16000', // 16kHz (otimizado para Whisper)
            '-ac', '1', // Mono
          ],
        });
        
        // Ler áudio e processar com Whisper
        const audioBuffer = await readFile(audioPath);
        const audioProcessor = getAudioProcessor();
        
        try {
          const audioResult = await audioProcessor.processAudio(audioBuffer, 'audio/wav', { language });
          transcription = audioResult.transcription;
          transcriptionLanguage = audioResult.transcriptionLanguage;
          transcriptionConfidence = audioResult.transcriptionConfidence;
          textEmbedding = audioResult.embedding;
        } catch (error) {
          logger.error({ error, processId }, 'Erro na transcrição do áudio do vídeo');
          transcription = '[Transcrição não disponível]';
          textEmbedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
        }
        
        // Limpar arquivo de áudio
        await unlink(audioPath).catch(() => {});
      } else {
        textEmbedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
        if (!metadata.hasAudio) {
          logger.info({ processId }, 'Vídeo sem áudio - pulando transcrição');
        }
      }
      
      // Extrair frames
      let frameEmbeddings: number[][] = [];
      let framesExtracted = 0;
      
      if (extractFrames && metadata.duration) {
        logger.info({ processId, duration: metadata.duration }, 'Extraindo frames do vídeo...');
        
        await mkdir(framesDir, { recursive: true });
        
        // Calcular intervalo entre frames
        const totalFrames = Math.min(
          Math.ceil((metadata.duration / 60) * FRAMES_PER_MINUTE),
          maxFrames
        );
        const interval = metadata.duration / totalFrames;
        
        // Extrair frames usando FFmpeg
        const framePattern = path.join(framesDir, 'frame_%03d.jpg');
        
        await runFFmpeg({
          inputPath,
          outputPath: framePattern,
          args: [
            '-vf', `fps=1/${interval},scale=512:-1`, // 1 frame por intervalo, escala para 512px
            '-q:v', '2', // Qualidade alta
            '-frames:v', String(totalFrames),
          ],
        });
        
        // Processar frames com CLIP
        const imageProcessor = getImageProcessor();
        
        for (let i = 1; i <= totalFrames; i++) {
          const framePath = path.join(framesDir, `frame_${String(i).padStart(3, '0')}.jpg`);
          
          try {
            if (existsSync(framePath)) {
              const frameBuffer = await readFile(framePath);
              const imageResult = await imageProcessor.processImage(frameBuffer, 'image/jpeg', {
                generateThumbnail: false,
                extractExif: false,
              });
              
              frameEmbeddings.push(imageResult.embedding);
              framesExtracted++;
              
              // Limpar frame
              await unlink(framePath).catch(() => {});
            }
          } catch (error) {
            logger.warn({ error, frame: i, processId }, 'Erro ao processar frame');
          }
        }
        
        logger.info({ processId, framesExtracted, totalAttempted: totalFrames }, 'Frames processados');
      }
      
      // Gerar embedding combinado
      const combinedEmbedding = this.combineEmbeddings(textEmbedding, frameEmbeddings);
      
      const processingTimeMs = Date.now() - startTime;
      
      logger.info({
        processId,
        transcriptionLength: transcription.length,
        framesExtracted,
        processingTimeMs,
      }, 'Vídeo processado com sucesso');
      
      return {
        transcription,
        transcriptionLanguage,
        transcriptionConfidence,
        textEmbedding,
        frameEmbeddings,
        combinedEmbedding,
        embeddingModel: 'whisper-large-v3 + ViT-L/14',
        metadata,
        framesExtracted,
        processedAt: new Date().toISOString(),
        processingTimeMs,
      };
    } finally {
      // Limpeza de arquivos temporários
      await unlink(inputPath).catch(() => {});
      
      // Limpar diretório de frames
      if (existsSync(framesDir)) {
        const { readdir } = await import('fs/promises');
        try {
          const files = await readdir(framesDir);
          for (const file of files) {
            await unlink(path.join(framesDir, file)).catch(() => {});
          }
          const { rmdir } = await import('fs/promises');
          await rmdir(framesDir).catch(() => {});
        } catch {
          // Ignorar erros de limpeza
        }
      }
    }
  }
  
  /**
   * Extrai metadados do vídeo usando FFprobe
   */
  private async extractMetadata(videoPath: string, fileSize: number): Promise<VideoMetadata> {
    try {
      const output = await this.runCommand(FFPROBE_PATH, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath,
      ]);
      
      const info = JSON.parse(output) as {
        format?: {
          duration?: string;
          bit_rate?: string;
          format_name?: string;
        };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          r_frame_rate?: string;
        }>;
      };
      
      const videoStream = info.streams?.find(s => s.codec_type === 'video');
      const audioStream = info.streams?.find(s => s.codec_type === 'audio');
      
      // Calcular frame rate
      let frameRate: number | undefined;
      if (videoStream?.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && den > 0) {
          frameRate = Math.round((num / den) * 100) / 100;
        }
      }
      
      return {
        duration: info.format?.duration ? parseFloat(info.format.duration) : undefined,
        width: videoStream?.width,
        height: videoStream?.height,
        format: info.format?.format_name,
        codec: videoStream?.codec_name,
        frameRate,
        bitrate: info.format?.bit_rate ? parseInt(info.format.bit_rate, 10) : undefined,
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name,
        fileSize,
      };
    } catch (error) {
      logger.warn({ error }, 'Erro ao extrair metadados do vídeo');
      return { fileSize };
    }
  }
  
  /**
   * Combina embeddings de texto e frames em um único embedding para busca
   * Usa média ponderada: texto tem peso maior pois contém mais informação semântica
   */
  private combineEmbeddings(
    textEmbedding: number[],
    frameEmbeddings: number[][]
  ): number[] {
    // Se não há frames, retorna embedding de texto expandido para 768 dim
    if (frameEmbeddings.length === 0) {
      // Truncar ou expandir para CLIP dim (768)
      if (textEmbedding.length >= CLIP_EMBEDDING_DIM) {
        return textEmbedding.slice(0, CLIP_EMBEDDING_DIM);
      } else {
        return [...textEmbedding, ...new Array(CLIP_EMBEDDING_DIM - textEmbedding.length).fill(0)];
      }
    }
    
    // Calcular média dos embeddings de frames
    const avgFrameEmbedding = new Array(CLIP_EMBEDDING_DIM).fill(0);
    for (const frame of frameEmbeddings) {
      for (let i = 0; i < frame.length; i++) {
        avgFrameEmbedding[i] += frame[i] / frameEmbeddings.length;
      }
    }
    
    // Se não há texto válido, retorna apenas média dos frames
    const hasValidText = textEmbedding.some(v => v !== 0);
    if (!hasValidText) {
      return avgFrameEmbedding;
    }
    
    // Combinar: 60% texto, 40% frames (texto geralmente mais relevante para busca)
    // Primeiro, normalizar textEmbedding para 768 dim
    const normalizedText = textEmbedding.slice(0, CLIP_EMBEDDING_DIM);
    while (normalizedText.length < CLIP_EMBEDDING_DIM) {
      normalizedText.push(0);
    }
    
    const combined = new Array(CLIP_EMBEDDING_DIM).fill(0);
    for (let i = 0; i < CLIP_EMBEDDING_DIM; i++) {
      combined[i] = (normalizedText[i] * 0.6) + (avgFrameEmbedding[i] * 0.4);
    }
    
    // Normalizar L2
    const magnitude = Math.sqrt(combined.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < combined.length; i++) {
        combined[i] /= magnitude;
      }
    }
    
    return combined;
  }
  
  /**
   * Verifica se o serviço está configurado
   */
  isReady(): boolean {
    return this.isConfigured;
  }
  
  /**
   * Retorna informações sobre a configuração
   */
  getConfig(): {
    configured: boolean;
    textEmbeddingDim: number;
    frameEmbeddingDim: number;
    maxDurationSeconds: number;
    framesPerMinute: number;
  } {
    return {
      configured: this.isConfigured,
      textEmbeddingDim: TEXT_EMBEDDING_DIM,
      frameEmbeddingDim: CLIP_EMBEDDING_DIM,
      maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
      framesPerMinute: FRAMES_PER_MINUTE,
    };
  }
}

// Singleton
let videoProcessorInstance: VideoProcessorService | null = null;

export function getVideoProcessor(): VideoProcessorService {
  if (!videoProcessorInstance) {
    videoProcessorInstance = new VideoProcessorService();
  }
  return videoProcessorInstance;
}

export const videoProcessor = getVideoProcessor();

/**
 * Retorna status do circuit breaker FFmpeg (Regra 16 - Observability)
 */
export function getFFmpegCircuitBreakerStatus(): {
  state: string;
  stats: {
    fires: number;
    failures: number;
    successes: number;
    fallbacks: number;
    timeouts: number;
    latencyMean: number;
  };
} {
  const stats = ffmpegBreaker.stats;
  return {
    state: ffmpegBreaker.opened ? 'open' : (ffmpegBreaker.halfOpen ? 'half-open' : 'closed'),
    stats: {
      fires: stats.fires || 0,
      failures: stats.failures || 0,
      successes: stats.successes || 0,
      fallbacks: stats.fallbacks || 0,
      timeouts: stats.timeouts || 0,
      latencyMean: stats.latencyMean || 0,
    },
  };
}


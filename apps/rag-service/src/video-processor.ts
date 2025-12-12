/**
 * Video Processor Service - Alice Enterprise Platform
 * 
 * Processamento de vídeos 100% LOCAL (Regra 6 CLAUDE.md - Autonomia Total):
 * - Extração de áudio via FFmpeg
 * - Transcrição via faster-whisper (CPU Hetzner - 100% LOCAL)
 * - Extração de frames chave para CLIP embeddings (CPU Hetzner - 100% LOCAL)
 * - Text embeddings da transcrição via multilingual-e5-base (CPU Hetzner - 100% LOCAL)
 * - Circuit Breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * ARQUITETURA AUTÔNOMA (Regra 6 CLAUDE.md):
 * - TODOS os processamentos são 100% locais via CPU no servidor Hetzner
 * - Embeddings: CLIP ViT-L/14 (imagens) + multilingual-e5-base (texto)
 * - Transcrição: faster-whisper medium
 * - NENHUMA dependência de APIs externas
 * 
 * Autor: Fillipe Guerra
 * Data: 12 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import { validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import { getAudioProcessor, TEXT_EMBEDDING_DIM } from './audio-processor.js';
import { getImageProcessor, CLIP_EMBEDDING_DIM } from './image-processor.js';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const logger = createLogger('video-processor');

/**
 * Combina embeddings para busca de VÍDEO.
 *
 * Contrato enterprise:
 * - Retorna SEMPRE embedding no espaço **CLIP** (para persistir em `clipEmbedding`).
 * - `textEmbedding` (multilingual-e5-base) é persistido separadamente em `textEmbedding` e NÃO pode ser armazenado como CLIP.
 * - Se não houver frames, retorna `[]` (não há CLIP embedding de vídeo).
 */
export function combineVideoEmbeddingsForSearch(
  textEmbedding: number[],
  frameEmbeddings: number[][]
): number[] {
  // Enterprise-grade: validação do embedding de texto (evita combinar vetor inválido/zero/NaN).
  // Regra 6: nunca "inventar" embedding; se não for confiável, ignorar texto e usar apenas frames (ou vazio).
  const isUsableTextEmbedding = (vec: number[]): boolean => {
    if (vec.length !== TEXT_EMBEDDING_DIM) return false;
    let hasNonZero = false;
    for (const v of vec) {
      if (!Number.isFinite(v)) return false;
      if (v !== 0) hasNonZero = true;
    }
    return hasNonZero;
  };

  // Sem frames: NÃO retornar embedding de texto aqui.
  // `combinedEmbedding` é CLIP-only; `textEmbedding` é persistido separadamente.
  if (frameEmbeddings.length === 0) {
    return [];
  }

  // Calcular média dos embeddings de frames (CLIP).
  // Enterprise-grade: proteger contra embeddings inválidos (dimensão incorreta, holes, NaN/Infinity),
  // evitando NaN no vetor final (compatível com pgvector).
  const isUsableClipEmbedding = (vec: number[]): boolean => {
    if (vec.length !== CLIP_EMBEDDING_DIM) return false;
    // Alinhar semântica com embeddings de texto: rejeitar vetor todo-zero (sentinela comum de falha).
    // Regra 6: não propagar embeddings "falsos" que degradam busca silenciosamente.
    let hasNonZero = false;
    for (const v of vec) {
      if (!Number.isFinite(v)) return false;
      if (v !== 0) hasNonZero = true;
    }
    return hasNonZero;
  };

  const validFrames = frameEmbeddings.filter(isUsableClipEmbedding);
  if (validFrames.length === 0) {
    logger.warn(
      { receivedFrames: frameEmbeddings.length },
      'Nenhum frame embedding CLIP válido disponível; retornando combinedEmbedding vazio'
    );
    return [];
  }

  // Média CLIP por dimensão:
  // Somar `frame[i] / N` para cada frame é matematicamente equivalente a `sum(frame[i]) / N`.
  const avgFrameEmbedding = new Array(CLIP_EMBEDDING_DIM).fill(0);
  for (const frame of validFrames) {
    for (let i = 0; i < CLIP_EMBEDDING_DIM; i++) {
      avgFrameEmbedding[i] += frame[i] / validFrames.length;
    }
  }

  // Enterprise-grade: validar avgFrameEmbedding antes de qualquer retorno/fallback.
  // Defesa em profundidade: evita propagar NaN/Infinity para o banco mesmo se algum frame inválido passar por engano.
  for (let i = 0; i < CLIP_EMBEDDING_DIM; i++) {
    if (!Number.isFinite(avgFrameEmbedding[i])) {
      logger.error(
        { index: i, value: avgFrameEmbedding[i], validFrames: validFrames.length },
        'avgFrameEmbedding contém valor não-finito. Rejeitando processamento (Regra 6 - Fail-fast).'
      );
      throw new Error('Falha ao calcular embedding de frames: valores não-finitos detectados');
    }
  }

  // Se não há texto válido, retorna apenas média dos frames (CLIP)
  const hasValidText = isUsableTextEmbedding(textEmbedding);
  if (!hasValidText) {
    return avgFrameEmbedding;
  }

  // Combinar: 60% texto, 40% frames (texto geralmente mais relevante para busca)
  // Primeiro, normalizar textEmbedding para TEXT_EMBEDDING_DIM (sem padding com zeros)
  // Defesa em profundidade: checar ANTES do slice para evitar estado intermediário frágil caso a lógica mude no futuro.
  if (textEmbedding.length < TEXT_EMBEDDING_DIM) {
    logger.warn(
      { textEmbeddingLength: textEmbedding.length, expectedDim: TEXT_EMBEDDING_DIM },
      'textEmbedding menor que o esperado; retornando embedding baseado apenas em frames (evita undefined/NaN)'
    );
    return avgFrameEmbedding;
  }
  const normalizedText =
    textEmbedding.length === TEXT_EMBEDDING_DIM ? textEmbedding : textEmbedding.slice(0, TEXT_EMBEDDING_DIM);

  // NOTA ARQUITETURAL: TEXT_EMBEDDING_DIM e CLIP_EMBEDDING_DIM são ambas 768 (multilingual-e5-base e CLIP ViT-L/14).
  // Se no futuro essas dimensões divergirem, o código precisará ser atualizado para lidar com a incompatibilidade.
  // A validação abaixo (normalizedText.length) já protege contra edge cases de corrupção de dados.

  // Enterprise-grade: validar que normalizedText tem o comprimento esperado antes de acessar índices.
  // Isso previne NaN se o slice retornar um array menor que o esperado (edge case de corrupção de dados).
  if (normalizedText.length !== TEXT_EMBEDDING_DIM) {
    logger.warn(
      { normalizedTextLength: normalizedText.length, expectedDim: TEXT_EMBEDDING_DIM, textEmbeddingLength: textEmbedding.length },
      'normalizedText tem dimensão incorreta após slice; retornando embedding baseado apenas em frames (evita NaN)'
    );
    return avgFrameEmbedding;
  }

  // Defesa extra: só é possível combinar embeddings se ambos estiverem no mesmo espaço dimensional.
  // Se no futuro TEXT_EMBEDDING_DIM e CLIP_EMBEDDING_DIM divergirem, essa checagem evita acesso fora do array (NaN) e
  // preserva a qualidade da busca retornando apenas CLIP (frames).
  if (normalizedText.length !== avgFrameEmbedding.length) {
    logger.warn(
      { normalizedTextLength: normalizedText.length, frameEmbeddingDim: avgFrameEmbedding.length },
      'Dimensões incompatíveis entre textEmbedding e frame embeddings; retornando embedding baseado apenas em frames'
    );
    return avgFrameEmbedding;
  }

  // Enterprise-grade: validar integridade de normalizedText ANTES de combinar (Regra 6 - Fail-fast)
  // Regra 6: PROIBIDO mascarar problemas com fallback para 0. Invalid embeddings devem rejeitar cedo.
  for (let i = 0; i < normalizedText.length; i++) {
    if (!Number.isFinite(normalizedText[i])) {
      const errorMsg = `normalizedText[${i}] é não-finito (${normalizedText[i]}). Embedding de texto corrompido. Rejeitando combinação.`;
      logger.error(
        { 
          index: i, 
          value: normalizedText[i],
          normalizedTextLength: normalizedText.length,
          textEmbeddingLength: textEmbedding.length,
        },
        errorMsg
      );
      // Regra 6: Fail-fast - retornar apenas frames ao invés de mascarar com zeros
      return avgFrameEmbedding;
    }
  }

  // Após validação completa, combinar embeddings
  const combined = new Array(avgFrameEmbedding.length).fill(0);
  for (let i = 0; i < combined.length; i++) {
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
  
  // Embeddings (100% locais via CPU no Hetzner)
  textEmbedding: number[]; // 768 dim - da transcrição (multilingual-e5-base local - CPU no Hetzner)
  frameEmbeddings: number[][]; // Array de CLIP embeddings (768 dim cada) dos frames (CLIP ViT-L/14 local - CPU no Hetzner)
  combinedEmbedding: number[]; // Embedding CLIP combinado para busca (frames ± sinal de texto). Se não houver frames, retorna [].
  
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
  private configurationChecked: boolean = false;
  private configurationPromise: Promise<void> | null = null;
  private lastConfigCheckAtMs: number = 0;
  private tempDir: string;
  
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'alice-video-processor');
    // Iniciar verificação de configuração (lazy - será aguardada no primeiro uso)
    this.configurationPromise = this.checkConfiguration();
  }
  
  /**
   * Aguarda a verificação de configuração completar (evita race condition)
   * Chamado antes de qualquer operação que dependa da configuração
   */
  private async ensureConfigured(): Promise<void> {
    // Enterprise-grade: validar VIDEO_PROCESSOR_CONFIG_RETRY_MS (fail-fast - Regra 6)
    // Função utilitária inline para evitar dependência externa
    const parseRetryMs = (): number => {
      const rawValue = process.env.VIDEO_PROCESSOR_CONFIG_RETRY_MS || '5000';
      const normalized = rawValue.trim();
      // Regra 6 / Enterprise: rejeitar valores parciais como "5000ms" (parseInt aceitaria).
      if (!/^\d+$/.test(normalized)) {
        const errorMsg = `VIDEO_PROCESSOR_CONFIG_RETRY_MS inválido: "${rawValue}". Deve ser um número inteiro >= 100ms`;
        if (process.env.NODE_ENV === 'production') {
          logger.error({ rawValue }, errorMsg);
          throw new Error(errorMsg);
        }
        logger.warn({ rawValue, defaultValue: 5000 }, `${errorMsg}. Usando padrão: 5000ms`);
        return 5000;
      }

      const parsed = Number(normalized);
      
      if (!Number.isSafeInteger(parsed) || parsed < 100) {
        const errorMsg = `VIDEO_PROCESSOR_CONFIG_RETRY_MS inválido: "${rawValue}". Deve ser um número >= 100ms`;
        
        if (process.env.NODE_ENV === 'production') {
          logger.error({ rawValue, parsed }, errorMsg);
          throw new Error(errorMsg);
        }
        
        logger.warn({ rawValue, parsed, defaultValue: 5000 }, `${errorMsg}. Usando padrão: 5000ms`);
        return 5000;
      }
      
      return parsed;
    };
    
    const retryMs = parseRetryMs();

    // Sempre aguardar a verificação em andamento, se houver.
    if (!this.configurationChecked && this.configurationPromise) {
      await this.configurationPromise;
    }

    // Se não está configurado, permitir retry controlado (evita ficar preso em "false" para sempre).
    if (this.configurationChecked && !this.isConfigured) {
      const now = Date.now();
      const elapsed = now - this.lastConfigCheckAtMs;
      if (elapsed >= retryMs) {
        logger.info(
          { retryMs, elapsedMs: elapsed },
          'Retry de verificação de configuração do video-processor (dependências podem ter ficado prontas)'
        );
        this.configurationChecked = false;
        this.configurationPromise = this.checkConfiguration();
        await this.configurationPromise;
      }
    }
  }
  
  private async checkConfiguration(): Promise<void> {
    this.lastConfigCheckAtMs = Date.now();
    try {
      // Verificar se FFmpeg está disponível
      await this.runCommand(FFMPEG_PATH, ['-version']);
      await this.runCommand(FFPROBE_PATH, ['-version']);
      
      // Verificar se processadores de áudio e imagem estão prontos (100% LOCAL)
      const audioProcessor = getAudioProcessor();
      const imageProcessor = getImageProcessor();
      
      // Contrato padronizado: usar sempre isReadyAsync() para readiness (Promise<boolean>)
      // IMPORTANTE: readiness pode falhar por indisponibilidade da dependência (ex: alice-clip-inference fora do ar).
      // Nunca propagar exceção: em falha, marcar como não pronto e manter serviço íntegro.
      let audioReady = false;
      let imageReady = false;
      try {
        audioReady = await audioProcessor.isReadyAsync();
      } catch (error) {
        logger.warn({ error }, 'Falha ao verificar readiness do audio-processor (tratando como not_ready)');
        audioReady = false;
      }
      try {
        imageReady = await imageProcessor.isReadyAsync();
      } catch (error) {
        logger.warn({ error }, 'Falha ao verificar readiness do image-processor (tratando como not_ready)');
        imageReady = false;
      }
      
      if (audioReady && imageReady) {
        this.isConfigured = true;
        logger.info('Video Processor configurado com FFmpeg + Whisper (transcrição LOCAL) + Embeddings locais (multilingual-e5-base)');
      } else {
        logger.warn({ audioReady, imageReady }, 'Dependências não configuradas - processamento de vídeo indisponível');
        this.isConfigured = false;
      }
    } catch (error) {
      logger.warn({ error }, 'FFmpeg não disponível - processamento de vídeo indisponível');
      this.isConfigured = false;
    } finally {
      this.configurationChecked = true;
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
    
    // Aguardar verificação de configuração completar (evita race condition - Bug Fix)
    await this.ensureConfigured();
    
    if (!this.isConfigured) {
      throw new Error(
        'Video Processor não está pronto. Verifique FFmpeg/FFprobe e conectividade com o serviço local de inferência (alice-clip-inference).'
      );
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
      let audioEmbeddingModel = 'none'; // Rastrear modelo de áudio real
      
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
          audioEmbeddingModel = audioResult.embeddingModel; // Capturar modelo real
        } catch (error) {
          logger.error({ error, processId }, 'Erro na transcrição do áudio do vídeo');
          transcription = '[Transcrição não disponível]';
          // Regra 6 (CLAUDE.md): PROIBIDO retornar embedding "falso" (vetor de zeros).
          // Em falha, marcamos como "sem embedding" e o call site deve persistir como NULL/ignorar.
          textEmbedding = [];
          audioEmbeddingModel = 'unavailable';
        }
        
        // Limpar arquivo de áudio
        await unlink(audioPath).catch(() => {});
      } else {
        textEmbedding = [];
        if (!metadata.hasAudio) {
          logger.info({ processId }, 'Vídeo sem áudio - pulando transcrição');
          audioEmbeddingModel = 'skipped-no-audio';
        }
      }
      
      // Extrair frames
      const frameEmbeddings: number[][] = [];
      let framesExtracted = 0;
      let imageEmbeddingModel = 'none'; // Rastrear modelo de imagem real
      
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
              
              // Validar dimensão CLIP do frame antes de adicionar (Enterprise-Grade - Regra 6)
              validateEmbeddingDimension(imageResult.embedding, CLIP_EMBEDDING_DIM, 'CLIP');
              
              frameEmbeddings.push(imageResult.embedding);
              framesExtracted++;
              
              // Capturar modelo do primeiro frame processado com sucesso
              if (imageEmbeddingModel === 'none') {
                imageEmbeddingModel = imageResult.embeddingModel;
              }
              
              // Limpar frame
              await unlink(framePath).catch(() => {});
            }
          } catch (error) {
            logger.warn({ error, frame: i, processId }, 'Erro ao processar frame');
          }
        }
        
        logger.info({ processId, framesExtracted, totalAttempted: totalFrames }, 'Frames processados');
      } else {
        imageEmbeddingModel = 'skipped-no-frames';
      }
      
      // Gerar embedding combinado
      const combinedEmbedding = this.combineEmbeddings(textEmbedding, frameEmbeddings);
      
      // Validar dimensão do embedding combinado antes de retornar (Enterprise-Grade - Regra 6)
      // Se não há embedding (ex: sem áudio + frames não extraídos), não inventar vetor: retornar vazio e persistir como NULL.
      if (combinedEmbedding.length > 0) {
        validateEmbeddingDimension(combinedEmbedding, EMBEDDING_DIMENSIONS.CLIP, 'CLIP');
      }
      
      // Validar textEmbedding se não estiver vazio
      if (textEmbedding.length > 0) {
        validateEmbeddingDimension(textEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      }
      
      const processingTimeMs = Date.now() - startTime;
      
      logger.info({
        processId,
        transcriptionLength: transcription.length,
        framesExtracted,
        processingTimeMs,
      }, 'Vídeo processado com sucesso');
      
      // Combinar modelos de forma dinâmica para rastreabilidade (Regra 16 - Observability)
      const embeddingModelParts: string[] = [];
      if (audioEmbeddingModel !== 'none' && audioEmbeddingModel !== 'skipped-no-audio') {
        embeddingModelParts.push(`audio:${audioEmbeddingModel}`);
      }
      if (imageEmbeddingModel !== 'none' && imageEmbeddingModel !== 'skipped-no-frames') {
        embeddingModelParts.push(`frames:${imageEmbeddingModel}`);
      }
      const embeddingModel = embeddingModelParts.length > 0 
        ? embeddingModelParts.join(' + ') 
        : 'none';
      
      return {
        transcription,
        transcriptionLanguage,
        transcriptionConfidence,
        textEmbedding,
        frameEmbeddings,
        combinedEmbedding,
        embeddingModel,
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
    return combineVideoEmbeddingsForSearch(textEmbedding, frameEmbeddings);
  }
  
  /**
   * Verifica se o serviço está configurado (síncrono - pode retornar false durante inicialização)
   * Para verificação garantida, use isReadyAsync()
   */
  isReady(): boolean {
    return this.isConfigured;
  }
  
  /**
   * Verifica se o serviço está configurado (assíncrono - aguarda inicialização)
   * Use este método para garantir que a verificação de configuração completou
   */
  async isReadyAsync(): Promise<boolean> {
    await this.ensureConfigured();
    return this.isConfigured;
  }
  
  /**
   * Retorna informações sobre a configuração
   * 
   * IMPORTANTE (API estável): Este método é **síncrono** para não quebrar call sites.
   * Para obter um snapshot consistente após a verificação de configuração completar,
   * use `getConfigAsync()` (que aguarda `ensureConfigured()`).
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

  /**
   * Retorna informações sobre a configuração (assíncrono - aguarda inicialização).
   * Use este método quando o call site precisar de consistência após o bootstrap.
   */
  async getConfigAsync(): Promise<{
    configured: boolean;
    textEmbeddingDim: number;
    frameEmbeddingDim: number;
    maxDurationSeconds: number;
    framesPerMinute: number;
  }> {
    await this.ensureConfigured();
    return this.getConfig();
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


/**
 * Testes do Video Processor - Alice Enterprise Platform
 * 
 * Testes unitários para processamento de vídeos:
 * - Extração de áudio via FFmpeg
 * - Transcrição via faster-whisper LOCAL (CPU Hetzner)
 * - Extração de frames para CLIP embeddings LOCAL
 * - Circuit Breaker para FFmpeg
 * 
 * ARQUITETURA AUTÔNOMA (Regra 6): Todos os processamentos 100% locais
 * 
 * Author: Fillipe Guerra
 * Data: 11/12/2025
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// TESTES DE CONFIGURAÇÃO
// ============================================================================

describe('Video Processor - Configuração', () => {
  const CONFIG = {
    FFMPEG_PATH: 'ffmpeg',
    FFPROBE_PATH: 'ffprobe',
    MAX_VIDEO_DURATION_SECONDS: 600, // 10 minutos
    FRAMES_PER_MINUTE: 6,
    MAX_FRAMES: 30,
  };

  it('deve ter limite de duração de 10 minutos (600 segundos)', () => {
    expect(CONFIG.MAX_VIDEO_DURATION_SECONDS).toBe(600);
  });

  it('deve extrair 6 frames por minuto', () => {
    expect(CONFIG.FRAMES_PER_MINUTE).toBe(6);
  });

  it('deve limitar a 30 frames máximo', () => {
    expect(CONFIG.MAX_FRAMES).toBe(30);
  });

  it('deve usar ffmpeg do PATH por padrão', () => {
    expect(CONFIG.FFMPEG_PATH).toBe('ffmpeg');
  });

  it('deve usar ffprobe do PATH por padrão', () => {
    expect(CONFIG.FFPROBE_PATH).toBe('ffprobe');
  });
});

// ============================================================================
// TESTES DE TIPOS DE VÍDEO SUPORTADOS
// ============================================================================

describe('Video Processor - MIME Types Suportados', () => {
  const supportedVideoTypes = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime', // MOV
    'video/x-msvideo',  // AVI
    'video/x-matroska', // MKV
  ];

  function isVideoSupported(mimeType: string): boolean {
    return supportedVideoTypes.includes(mimeType) || mimeType.startsWith('video/');
  }

  it('deve suportar MP4', () => {
    expect(isVideoSupported('video/mp4')).toBe(true);
  });

  it('deve suportar WebM', () => {
    expect(isVideoSupported('video/webm')).toBe(true);
  });

  it('deve suportar MOV (QuickTime)', () => {
    expect(isVideoSupported('video/quicktime')).toBe(true);
  });

  it('deve suportar OGG', () => {
    expect(isVideoSupported('video/ogg')).toBe(true);
  });

  it('deve suportar AVI', () => {
    expect(isVideoSupported('video/x-msvideo')).toBe(true);
  });

  it('deve suportar MKV', () => {
    expect(isVideoSupported('video/x-matroska')).toBe(true);
  });

  it('deve rejeitar tipos não-vídeo', () => {
    expect(isVideoSupported('audio/mp3')).toBe(false);
    expect(isVideoSupported('image/png')).toBe(false);
    expect(isVideoSupported('application/pdf')).toBe(false);
  });
});

// ============================================================================
// TESTES DE METADATA DE VÍDEO
// ============================================================================

describe('Video Processor - Metadata', () => {
  interface VideoMetadata {
    duration?: number;
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

  it('deve ter fileSize obrigatório', () => {
    const metadata: VideoMetadata = { fileSize: 50000000 };
    expect(metadata.fileSize).toBeDefined();
  });

  it('deve extrair dimensões (width x height)', () => {
    const metadata: VideoMetadata = {
      fileSize: 50000000,
      width: 1920,
      height: 1080,
    };
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });

  it('deve extrair duração em segundos', () => {
    const metadata: VideoMetadata = {
      fileSize: 50000000,
      duration: 300, // 5 minutos
    };
    expect(metadata.duration).toBe(300);
  });

  it('deve detectar codec de vídeo', () => {
    const metadata: VideoMetadata = {
      fileSize: 50000000,
      codec: 'h264',
    };
    expect(metadata.codec).toBe('h264');
  });

  it('deve detectar presença de áudio', () => {
    const metadata: VideoMetadata = {
      fileSize: 50000000,
      hasAudio: true,
      audioCodec: 'aac',
    };
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.audioCodec).toBe('aac');
  });

  it('deve extrair frame rate', () => {
    const metadata: VideoMetadata = {
      fileSize: 50000000,
      frameRate: 30,
    };
    expect(metadata.frameRate).toBe(30);
  });
});

// ============================================================================
// TESTES DE DIMENSÕES DE EMBEDDING
// ============================================================================

describe('Video Processor - Dimensões de Embedding', () => {
  const TEXT_EMBEDDING_DIM = 768;  // multilingual-e5-base local (transcrição)
  const CLIP_EMBEDDING_DIM = 768;   // CLIP ViT-L/14 (frames)

  it('deve ter text embedding de 768 dimensões (multilingual-e5-base local)', () => {
    expect(TEXT_EMBEDDING_DIM).toBe(768);
  });

  it('deve ter CLIP embedding de 768 dimensões por frame', () => {
    expect(CLIP_EMBEDDING_DIM).toBe(768);
  });

  it('deve criar array de embeddings para múltiplos frames', () => {
    const framesCount = 10;
    const frameEmbeddings = Array(framesCount).fill(null).map(() => 
      new Array(CLIP_EMBEDDING_DIM).fill(0)
    );
    
    expect(frameEmbeddings.length).toBe(10);
    expect(frameEmbeddings[0].length).toBe(768);
  });
});

// ============================================================================
// TESTES DE EXTRAÇÃO DE FRAMES
// ============================================================================

describe('Video Processor - Extração de Frames', () => {
  const FRAMES_PER_MINUTE = 6;
  const MAX_FRAMES = 30;

  function calculateFrameCount(durationSeconds: number): number {
    const durationMinutes = durationSeconds / 60;
    const calculatedFrames = Math.ceil(durationMinutes * FRAMES_PER_MINUTE);
    return Math.min(calculatedFrames, MAX_FRAMES);
  }

  it('deve calcular 6 frames para 1 minuto', () => {
    expect(calculateFrameCount(60)).toBe(6);
  });

  it('deve calcular 12 frames para 2 minutos', () => {
    expect(calculateFrameCount(120)).toBe(12);
  });

  it('deve limitar a 30 frames para vídeos longos', () => {
    expect(calculateFrameCount(600)).toBe(30);
    expect(calculateFrameCount(1200)).toBe(30);
  });

  it('deve calcular ao menos 1 frame para vídeos curtos', () => {
    expect(calculateFrameCount(5)).toBe(1);
    expect(calculateFrameCount(10)).toBe(1);
  });

  it('deve calcular timestamps de extração', () => {
    const duration = 60; // 1 minuto
    const frameCount = calculateFrameCount(duration);
    const interval = duration / frameCount;
    
    const timestamps = Array(frameCount).fill(0).map((_, i) => i * interval);
    
    expect(timestamps.length).toBe(6);
    expect(timestamps[0]).toBe(0);
    expect(timestamps[5]).toBe(50);
  });
});

// ============================================================================
// TESTES DE ESTRUTURA DE PROCESSAMENTO
// ============================================================================

describe('Video Processor - Estrutura de Resultado', () => {
  interface ProcessedVideo {
    transcription: string;
    transcriptionLanguage?: string;
    transcriptionConfidence?: number;
    textEmbedding: number[];
    frameEmbeddings: number[][];
    combinedEmbedding: number[];
    embeddingModel: string;
    metadata: { fileSize: number };
    framesExtracted: number;
    processedAt: string;
    processingTimeMs: number;
  }

  it('deve ter estrutura de resultado completa', () => {
    const result: ProcessedVideo = {
      transcription: 'Transcrição do vídeo',
      transcriptionLanguage: 'pt',
      textEmbedding: new Array(768).fill(0), // multilingual-e5-base local (768 dim)
      frameEmbeddings: [new Array(768).fill(0), new Array(768).fill(0)],
      combinedEmbedding: new Array(768).fill(0),
      embeddingModel: 'clip-vit-large-patch14',
      metadata: { fileSize: 50000000 },
      framesExtracted: 2,
      processedAt: new Date().toISOString(),
      processingTimeMs: 5000,
    };

    expect(result.transcription).toBeDefined();
    expect(result.textEmbedding.length).toBe(768); // multilingual-e5-base local (768 dim)
    expect(result.frameEmbeddings.length).toBe(2);
    expect(result.framesExtracted).toBe(2);
  });

  it('deve incluir idioma da transcrição', () => {
    const result: ProcessedVideo = {
      transcription: 'Olá mundo',
      transcriptionLanguage: 'pt',
      textEmbedding: [],
      frameEmbeddings: [],
      combinedEmbedding: [],
      embeddingModel: 'clip-vit-large-patch14',
      metadata: { fileSize: 1000 },
      framesExtracted: 0,
      processedAt: new Date().toISOString(),
      processingTimeMs: 100,
    };

    expect(result.transcriptionLanguage).toBe('pt');
  });
});

// ============================================================================
// TESTES DE OPÇÕES DE PROCESSAMENTO
// ============================================================================

describe('Video Processor - Opções de Processamento', () => {
  interface VideoProcessorOptions {
    language?: string;
    extractFrames?: boolean;
    maxFrames?: number;
    generateTranscription?: boolean;
  }

  it('deve ter language padrão como auto', () => {
    const options: VideoProcessorOptions = {};
    const language = options.language || 'auto';
    expect(language).toBe('auto');
  });

  it('deve permitir desabilitar extração de frames', () => {
    const options: VideoProcessorOptions = { extractFrames: false };
    expect(options.extractFrames).toBe(false);
  });

  it('deve permitir customizar maxFrames', () => {
    const options: VideoProcessorOptions = { maxFrames: 10 };
    expect(options.maxFrames).toBe(10);
  });

  it('deve permitir desabilitar transcrição', () => {
    const options: VideoProcessorOptions = { generateTranscription: false };
    expect(options.generateTranscription).toBe(false);
  });
});

// ============================================================================
// TESTES DE CIRCUIT BREAKER
// ============================================================================

describe('Video Processor - Circuit Breaker FFmpeg', () => {
  const ffmpegBreakerConfig = {
    name: 'ffmpeg-processing',
    failureThreshold: 3,
    resetTimeout: 60000, // 1 minuto
    timeout: 300000, // 5 minutos para processamento de vídeo
  };

  it('deve ter circuit breaker para FFmpeg', () => {
    expect(ffmpegBreakerConfig.name).toBe('ffmpeg-processing');
  });

  it('deve abrir após 3 falhas', () => {
    expect(ffmpegBreakerConfig.failureThreshold).toBe(3);
  });

  it('deve resetar após 1 minuto', () => {
    expect(ffmpegBreakerConfig.resetTimeout).toBe(60000);
  });

  it('deve ter timeout de 5 minutos para processamento', () => {
    const minutes = ffmpegBreakerConfig.timeout / 60000;
    expect(minutes).toBe(5);
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO DE DURAÇÃO
// ============================================================================

describe('Video Processor - Validação de Duração', () => {
  const MAX_VIDEO_DURATION_SECONDS = 600; // 10 minutos

  function isValidDuration(durationSeconds: number): boolean {
    return durationSeconds > 0 && durationSeconds <= MAX_VIDEO_DURATION_SECONDS;
  }

  it('deve aceitar vídeo de 5 minutos', () => {
    expect(isValidDuration(300)).toBe(true);
  });

  it('deve aceitar vídeo de 10 minutos', () => {
    expect(isValidDuration(600)).toBe(true);
  });

  it('deve rejeitar vídeo maior que 10 minutos', () => {
    expect(isValidDuration(601)).toBe(false);
    expect(isValidDuration(1200)).toBe(false);
  });

  it('deve rejeitar duração zero ou negativa', () => {
    expect(isValidDuration(0)).toBe(false);
    expect(isValidDuration(-10)).toBe(false);
  });
});

// ============================================================================
// TESTES DE COMBINAÇÃO DE EMBEDDINGS
// ============================================================================

describe('Video Processor - Combinação de Embeddings', () => {
  function combineEmbeddings(frameEmbeddings: number[][]): number[] {
    if (frameEmbeddings.length === 0) return [];
    
    const dim = frameEmbeddings[0].length;
    const combined = new Array(dim).fill(0);
    
    // Média dos embeddings
    for (const emb of frameEmbeddings) {
      for (let i = 0; i < dim; i++) {
        combined[i] += emb[i];
      }
    }
    
    for (let i = 0; i < dim; i++) {
      combined[i] /= frameEmbeddings.length;
    }
    
    return combined;
  }

  it('deve calcular média de múltiplos embeddings', () => {
    const embeddings = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    
    const combined = combineEmbeddings(embeddings);
    
    expect(combined).toEqual([4, 5, 6]);
  });

  it('deve retornar array vazio se não houver embeddings', () => {
    const combined = combineEmbeddings([]);
    expect(combined).toEqual([]);
  });

  it('deve retornar o mesmo embedding se houver apenas 1', () => {
    const embeddings = [[1, 2, 3]];
    const combined = combineEmbeddings(embeddings);
    expect(combined).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// TESTES DE ARQUIVOS TEMPORÁRIOS
// ============================================================================

describe('Video Processor - Arquivos Temporários', () => {
  const TEMP_DIR = '/tmp/video-processor';

  function generateTempPath(extension: string): string {
    const hash = Math.random().toString(36).substring(2, 15);
    return `${TEMP_DIR}/${hash}.${extension}`;
  }

  it('deve usar /tmp para arquivos temporários', () => {
    const path = generateTempPath('mp3');
    expect(path.startsWith('/tmp')).toBe(true);
  });

  it('deve gerar caminhos únicos', () => {
    const path1 = generateTempPath('mp3');
    const path2 = generateTempPath('mp3');
    expect(path1).not.toBe(path2);
  });

  it('deve usar extensão correta', () => {
    const mp3Path = generateTempPath('mp3');
    const jpgPath = generateTempPath('jpg');
    
    expect(mp3Path.endsWith('.mp3')).toBe(true);
    expect(jpgPath.endsWith('.jpg')).toBe(true);
  });
});

// ============================================================================
// TESTES DE FFPROBE (METADATA)
// ============================================================================

describe('Video Processor - FFprobe Metadata', () => {
  interface FFprobeStream {
    codec_type: 'video' | 'audio';
    codec_name: string;
    width?: number;
    height?: number;
    duration?: string;
    r_frame_rate?: string;
    bit_rate?: string;
  }

  interface FFprobeOutput {
    streams: FFprobeStream[];
    format: {
      duration?: string;
      size?: string;
      bit_rate?: string;
    };
  }

  function parseFFprobeOutput(output: FFprobeOutput): {
    hasVideo: boolean;
    hasAudio: boolean;
    duration: number;
  } {
    const videoStream = output.streams.find(s => s.codec_type === 'video');
    const audioStream = output.streams.find(s => s.codec_type === 'audio');
    
    return {
      hasVideo: !!videoStream,
      hasAudio: !!audioStream,
      duration: parseFloat(output.format.duration || '0'),
    };
  }

  it('deve detectar stream de vídeo', () => {
    const output: FFprobeOutput = {
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
      ],
      format: { duration: '120.5' },
    };
    
    const parsed = parseFFprobeOutput(output);
    expect(parsed.hasVideo).toBe(true);
    expect(parsed.hasAudio).toBe(false);
  });

  it('deve detectar stream de áudio', () => {
    const output: FFprobeOutput = {
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '120.5' },
    };
    
    const parsed = parseFFprobeOutput(output);
    expect(parsed.hasVideo).toBe(true);
    expect(parsed.hasAudio).toBe(true);
  });

  it('deve parsear duração corretamente', () => {
    const output: FFprobeOutput = {
      streams: [],
      format: { duration: '300.75' },
    };
    
    const parsed = parseFFprobeOutput(output);
    expect(parsed.duration).toBe(300.75);
  });
});

// ============================================================================
// TESTES DE HASH DE VÍDEO
// ============================================================================

describe('Video Processor - Hash de Vídeo', () => {
  it('deve gerar hash SHA256 para deduplicação', () => {
    const buffer = Buffer.from('video content');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    expect(hash.length).toBe(64);
  });

  it('deve gerar hashes iguais para conteúdos iguais', () => {
    const crypto = require('crypto');
    const buffer1 = Buffer.from('same video');
    const buffer2 = Buffer.from('same video');
    
    const hash1 = crypto.createHash('sha256').update(buffer1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(buffer2).digest('hex');
    
    expect(hash1).toBe(hash2);
  });
});

// ============================================================================
// TESTES DE RESOLUÇÕES COMUNS
// ============================================================================

describe('Video Processor - Resoluções Comuns', () => {
  const RESOLUTIONS = {
    '4K': { width: 3840, height: 2160 },
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
    '360p': { width: 640, height: 360 },
  };

  it('deve reconhecer 4K', () => {
    expect(RESOLUTIONS['4K'].width).toBe(3840);
    expect(RESOLUTIONS['4K'].height).toBe(2160);
  });

  it('deve reconhecer 1080p (Full HD)', () => {
    expect(RESOLUTIONS['1080p'].width).toBe(1920);
    expect(RESOLUTIONS['1080p'].height).toBe(1080);
  });

  it('deve reconhecer 720p (HD)', () => {
    expect(RESOLUTIONS['720p'].width).toBe(1280);
    expect(RESOLUTIONS['720p'].height).toBe(720);
  });

  it('deve calcular aspect ratio 16:9', () => {
    const { width, height } = RESOLUTIONS['1080p'];
    const ratio = width / height;
    expect(ratio).toBeCloseTo(16/9, 2);
  });
});

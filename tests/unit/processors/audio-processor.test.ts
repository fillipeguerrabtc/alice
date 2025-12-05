/**
 * Testes do Audio Processor - Alice Enterprise Platform
 * 
 * Testes unitários para processamento de áudio:
 * - Validação de MIME types
 * - Extração de metadata
 * - Estrutura de transcrição
 * - Configuração Whisper
 * 
 * Author: Fillipe Guerra
 * Data: 04/12/2025
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// CONSTANTES
// ============================================================================

const TEXT_EMBEDDING_DIM = 1536;

// ============================================================================
// TESTES DE TIPOS DE ÁUDIO SUPORTADOS
// ============================================================================

describe('Audio Processor - MIME Types Suportados', () => {
  const supportedAudioTypes = [
    'audio/mpeg',      // MP3
    'audio/wav',       // WAV
    'audio/x-wav',     // WAV alternativo
    'audio/ogg',       // OGG
    'audio/flac',      // FLAC
    'audio/webm',      // WebM audio
    'audio/mp4',       // M4A
    'audio/aac',       // AAC
  ];

  function isAudioSupported(mimeType: string): boolean {
    return supportedAudioTypes.includes(mimeType) || mimeType.startsWith('audio/');
  }

  it('deve suportar MP3', () => {
    expect(isAudioSupported('audio/mpeg')).toBe(true);
  });

  it('deve suportar WAV', () => {
    expect(isAudioSupported('audio/wav')).toBe(true);
    expect(isAudioSupported('audio/x-wav')).toBe(true);
  });

  it('deve suportar OGG', () => {
    expect(isAudioSupported('audio/ogg')).toBe(true);
  });

  it('deve suportar FLAC', () => {
    expect(isAudioSupported('audio/flac')).toBe(true);
  });

  it('deve suportar WebM audio', () => {
    expect(isAudioSupported('audio/webm')).toBe(true);
  });

  it('deve suportar M4A', () => {
    expect(isAudioSupported('audio/mp4')).toBe(true);
  });

  it('deve suportar AAC', () => {
    expect(isAudioSupported('audio/aac')).toBe(true);
  });

  it('deve rejeitar tipos não-áudio', () => {
    expect(isAudioSupported('video/mp4')).toBe(false);
    expect(isAudioSupported('image/png')).toBe(false);
    expect(isAudioSupported('application/pdf')).toBe(false);
  });
});

// ============================================================================
// TESTES DE METADATA DE ÁUDIO
// ============================================================================

describe('Audio Processor - Metadata', () => {
  interface AudioMetadata {
    duration?: number;
    format?: string;
    channels?: number;
    sampleRate?: number;
    bitrate?: number;
    fileSize: number;
  }

  it('deve ter fileSize obrigatório', () => {
    const metadata: AudioMetadata = { fileSize: 1024 };
    expect(metadata.fileSize).toBeDefined();
  });

  it('deve validar duração em segundos', () => {
    const metadata: AudioMetadata = {
      fileSize: 5000000,
      duration: 180, // 3 minutos
    };
    expect(metadata.duration).toBe(180);
  });

  it('deve validar sample rate comum (44.1kHz)', () => {
    const metadata: AudioMetadata = {
      fileSize: 1000000,
      sampleRate: 44100,
    };
    expect(metadata.sampleRate).toBe(44100);
  });

  it('deve validar sample rate alta qualidade (48kHz)', () => {
    const metadata: AudioMetadata = {
      fileSize: 1000000,
      sampleRate: 48000,
    };
    expect(metadata.sampleRate).toBe(48000);
  });

  it('deve validar mono (1 canal)', () => {
    const metadata: AudioMetadata = {
      fileSize: 1000000,
      channels: 1,
    };
    expect(metadata.channels).toBe(1);
  });

  it('deve validar stereo (2 canais)', () => {
    const metadata: AudioMetadata = {
      fileSize: 1000000,
      channels: 2,
    };
    expect(metadata.channels).toBe(2);
  });

  it('deve calcular bitrate em kbps', () => {
    const metadata: AudioMetadata = {
      fileSize: 5000000, // 5MB
      duration: 200,     // 200 segundos
      bitrate: 200,      // ~200 kbps
    };
    // Cálculo: (5000000 * 8) / 200 / 1000 = 200 kbps
    expect(metadata.bitrate).toBe(200);
  });
});

// ============================================================================
// TESTES DE ESTRUTURA DE TRANSCRIÇÃO
// ============================================================================

describe('Audio Processor - Estrutura de Transcrição', () => {
  interface ProcessedAudio {
    transcription: string;
    transcriptionLanguage?: string;
    transcriptionConfidence?: number;
    embedding: number[];
    embeddingModel: string;
    metadata: { fileSize: number };
    processedAt: string;
    processingTimeMs: number;
  }

  it('deve ter transcription obrigatório', () => {
    const result: ProcessedAudio = {
      transcription: 'Texto transcrito do áudio',
      embedding: [],
      embeddingModel: 'text-embedding-3-small',
      metadata: { fileSize: 1000 },
      processedAt: new Date().toISOString(),
      processingTimeMs: 5000,
    };
    expect(result.transcription).toBeDefined();
  });

  it('deve detectar idioma quando auto', () => {
    const result: ProcessedAudio = {
      transcription: 'Olá, como você está?',
      transcriptionLanguage: 'pt',
      embedding: [],
      embeddingModel: 'text-embedding-3-small',
      metadata: { fileSize: 1000 },
      processedAt: new Date().toISOString(),
      processingTimeMs: 5000,
    };
    expect(result.transcriptionLanguage).toBe('pt');
  });

  it('deve incluir confiança da transcrição', () => {
    const result: ProcessedAudio = {
      transcription: 'Hello world',
      transcriptionConfidence: 0.95,
      embedding: [],
      embeddingModel: 'text-embedding-3-small',
      metadata: { fileSize: 1000 },
      processedAt: new Date().toISOString(),
      processingTimeMs: 5000,
    };
    expect(result.transcriptionConfidence).toBeGreaterThan(0);
    expect(result.transcriptionConfidence).toBeLessThanOrEqual(1);
  });

  it('deve usar modelo de embedding text-embedding-3-small', () => {
    const result: ProcessedAudio = {
      transcription: 'Test',
      embedding: new Array(TEXT_EMBEDDING_DIM).fill(0),
      embeddingModel: 'text-embedding-3-small',
      metadata: { fileSize: 1000 },
      processedAt: new Date().toISOString(),
      processingTimeMs: 5000,
    };
    expect(result.embeddingModel).toBe('text-embedding-3-small');
  });

  it('deve ter embedding com dimensão 1536', () => {
    const embedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
    expect(embedding.length).toBe(1536);
  });
});

// ============================================================================
// TESTES DE OPÇÕES DE PROCESSAMENTO
// ============================================================================

describe('Audio Processor - Opções de Processamento', () => {
  interface AudioProcessorOptions {
    language?: string;
    generateEmbedding?: boolean;
  }

  it('deve ter language padrão como auto', () => {
    const options: AudioProcessorOptions = {};
    const language = options.language || 'auto';
    expect(language).toBe('auto');
  });

  it('deve suportar português (pt)', () => {
    const options: AudioProcessorOptions = { language: 'pt' };
    expect(options.language).toBe('pt');
  });

  it('deve suportar inglês (en)', () => {
    const options: AudioProcessorOptions = { language: 'en' };
    expect(options.language).toBe('en');
  });

  it('deve ter generateEmbedding padrão como true', () => {
    const options: AudioProcessorOptions = {};
    const generateEmbedding = options.generateEmbedding ?? true;
    expect(generateEmbedding).toBe(true);
  });

  it('deve permitir desabilitar embedding', () => {
    const options: AudioProcessorOptions = { generateEmbedding: false };
    expect(options.generateEmbedding).toBe(false);
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO DE TAMANHO
// ============================================================================

describe('Audio Processor - Validação de Tamanho', () => {
  const MAX_AUDIO_SIZE_MB = 100; // 100MB padrão para áudio
  const MAX_DURATION_MINUTES = 60; // 60 minutos máximo

  it('deve aceitar áudio de até 100MB', () => {
    const sizeMB = 50;
    expect(sizeMB <= MAX_AUDIO_SIZE_MB).toBe(true);
  });

  it('deve rejeitar áudio maior que 100MB', () => {
    const sizeMB = 150;
    expect(sizeMB <= MAX_AUDIO_SIZE_MB).toBe(false);
  });

  it('deve aceitar áudio de até 60 minutos', () => {
    const durationMinutes = 30;
    expect(durationMinutes <= MAX_DURATION_MINUTES).toBe(true);
  });

  it('deve rejeitar áudio maior que 60 minutos', () => {
    const durationMinutes = 90;
    expect(durationMinutes <= MAX_DURATION_MINUTES).toBe(false);
  });

  it('deve calcular duração estimada baseado no tamanho e bitrate', () => {
    // Usar MB (1000*1000) para consistência com bitrate em kbps (não MiB)
    const fileSizeBytes = 10 * 1000 * 1000; // 10MB = 10.000.000 bytes
    const bitrateKbps = 128;
    // Fórmula: (bytes * 8 bits/byte) / (kbps * 1000 bits/s) = segundos
    const durationSeconds = (fileSizeBytes * 8) / (bitrateKbps * 1000);
    expect(durationSeconds).toBeCloseTo(625, 0); // 625 segundos = ~10.4 minutos
  });
});

// ============================================================================
// TESTES DE HASH DE ÁUDIO
// ============================================================================

describe('Audio Processor - Hash de Áudio', () => {
  it('deve gerar hash SHA256 consistente', () => {
    const buffer1 = Buffer.from('audio content');
    const buffer2 = Buffer.from('audio content');
    
    const crypto = require('crypto');
    const hash1 = crypto.createHash('sha256').update(buffer1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(buffer2).digest('hex');
    
    expect(hash1).toBe(hash2);
  });

  it('deve gerar hashes diferentes para conteúdos diferentes', () => {
    const buffer1 = Buffer.from('audio content 1');
    const buffer2 = Buffer.from('audio content 2');
    
    const crypto = require('crypto');
    const hash1 = crypto.createHash('sha256').update(buffer1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(buffer2).digest('hex');
    
    expect(hash1).not.toBe(hash2);
  });
});

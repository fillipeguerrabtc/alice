/**
 * Document Processor Service - Alice Enterprise Platform
 * 
 * Processamento de documentos:
 * - PDF: Extração de texto via pdf-parse
 * - DOCX: Extração de texto via mammoth
 * - XLSX: Extração de texto via exceljs (CVE-2024-22363, CVE-2024-3766 corrigidos)
 * - TXT/MD: Leitura direta
 * - Text embeddings do conteúdo extraído (Salad Cloud)
 * - Circuit Breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import type { Worksheet, Row } from 'exceljs';

const logger = createLogger('document-processor');

// Configuração Salad Cloud
const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const SALAD_EMBEDDINGS_ENDPOINT = process.env.SALAD_EMBEDDINGS_ENDPOINT || 'https://api.salad.com/api/public';

// Dimensão dos embeddings de texto
export const TEXT_EMBEDDING_DIM = 1536;

// Limites de processamento
const MAX_DOCUMENT_SIZE_MB = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || '50', 10);
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH || '100000', 10); // 100k caracteres
const CHUNK_SIZE = parseInt(process.env.DOCUMENT_CHUNK_SIZE || '8000', 10); // Tamanho de cada chunk para embedding

export interface DocumentMetadata {
  pageCount?: number;
  wordCount?: number;
  characterCount?: number;
  format: string;
  language?: string;
  title?: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  fileSize: number;
}

export interface DocumentChunk {
  text: string;
  pageNumber?: number;
  chunkIndex: number;
  embedding: number[];
}

export interface ProcessedDocument {
  // Texto extraído
  fullText: string;
  chunks: DocumentChunk[];
  
  // Embedding combinado (média dos chunks)
  combinedEmbedding: number[];
  
  // Metadados
  embeddingModel: string;
  metadata: DocumentMetadata;
  processedAt: string;
  processingTimeMs: number;
}

export interface DocumentProcessorOptions {
  extractMetadata?: boolean;
  generateEmbeddings?: boolean;
  chunkSize?: number;
  maxChunks?: number;
}

// ============================================================================
// CIRCUIT BREAKER - Embedding API (Regra 16 - Melhores Práticas 2025)
// ============================================================================

interface EmbeddingParams {
  text: string;
}

async function generateEmbeddingInternal(params: EmbeddingParams): Promise<{ embedding: number[]; model: string }> {
  const response = await fetch(`${SALAD_EMBEDDINGS_ENDPOINT}/inference/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Salad-Api-Key': SALAD_API_KEY!,
      'Salad-Organization': SALAD_ORGANIZATION_ID!,
    },
    body: JSON.stringify({
      input: params.text,
      model: 'text-embedding-3-small',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as {
    data: Array<{ embedding: number[] }>;
    model: string;
  };

  if (!result.data || result.data.length === 0) {
    throw new Error('Resposta de embedding vazia');
  }

  return {
    embedding: result.data[0].embedding,
    model: result.model || 'text-embedding-3-small',
  };
}

const embeddingBreaker = createCircuitBreaker(generateEmbeddingInternal, {
  name: 'document-embedding',
  ...CIRCUIT_BREAKER_PRESETS.textEmbeddings,
});

async function generateEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
  return embeddingBreaker.fire({ text }) as Promise<{ embedding: number[]; model: string }>;
}

// ============================================================================
// DOCUMENT PROCESSOR SERVICE
// ============================================================================

class DocumentProcessorService {
  private isConfigured: boolean = false;

  constructor() {
    if (SALAD_API_KEY && SALAD_ORGANIZATION_ID) {
      this.isConfigured = true;
      logger.info('Document Processor configurado com Salad Cloud');
    } else {
      logger.warn('SALAD_API_KEY ou SALAD_ORGANIZATION_ID não configurados - embeddings indisponíveis');
    }
  }

  /**
   * Processa um documento: extrai texto e gera embeddings
   */
  async processDocument(
    documentBuffer: Buffer,
    mimeType: string,
    options: DocumentProcessorOptions = {}
  ): Promise<ProcessedDocument> {
    const startTime = Date.now();
    const {
      extractMetadata = true,
      generateEmbeddings = true,
      chunkSize = CHUNK_SIZE,
      maxChunks = 50,
    } = options;

    // Verificar tamanho máximo
    const sizeMB = documentBuffer.length / (1024 * 1024);
    if (sizeMB > MAX_DOCUMENT_SIZE_MB) {
      throw new Error(`Documento muito grande: ${sizeMB.toFixed(2)}MB. Máximo: ${MAX_DOCUMENT_SIZE_MB}MB`);
    }

    // Extrair texto baseado no tipo de documento
    let fullText = '';
    let metadata: DocumentMetadata = {
      format: this.getFormatFromMimeType(mimeType),
      fileSize: documentBuffer.length,
    };

    try {
      switch (mimeType) {
        case 'application/pdf':
          const pdfResult = await this.extractPdfText(documentBuffer, extractMetadata);
          fullText = pdfResult.text;
          metadata = { ...metadata, ...pdfResult.metadata };
          break;

        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          const docxResult = await this.extractDocxText(documentBuffer);
          fullText = docxResult.text;
          metadata = { ...metadata, ...docxResult.metadata };
          break;

        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/vnd.ms-excel':
          const xlsxResult = await this.extractXlsxText(documentBuffer);
          fullText = xlsxResult.text;
          metadata = { ...metadata, ...xlsxResult.metadata };
          break;

        case 'text/plain':
        case 'text/markdown':
        case 'text/csv':
          fullText = documentBuffer.toString('utf-8');
          break;

        default:
          // Tentar como texto puro
          fullText = documentBuffer.toString('utf-8');
          logger.warn({ mimeType }, 'Tipo de documento não reconhecido, tratando como texto');
      }
    } catch (error) {
      logger.error({ error, mimeType }, 'Erro ao extrair texto do documento');
      throw new Error(`Falha ao processar documento ${metadata.format}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }

    // Limitar tamanho do texto
    if (fullText.length > MAX_TEXT_LENGTH) {
      logger.warn({
        originalLength: fullText.length,
        truncatedTo: MAX_TEXT_LENGTH,
      }, 'Texto truncado devido ao limite máximo');
      fullText = fullText.slice(0, MAX_TEXT_LENGTH);
    }

    // Atualizar metadados com contagens
    metadata.characterCount = fullText.length;
    metadata.wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    // Dividir em chunks
    const textChunks = this.splitIntoChunks(fullText, chunkSize, maxChunks);

    // Gerar embeddings para cada chunk
    const chunks: DocumentChunk[] = [];
    const combinedEmbedding: number[] = new Array(TEXT_EMBEDDING_DIM).fill(0);
    let embeddingModel = 'none';

    if (generateEmbeddings) {
      // Embeddings solicitados - verificar se está configurado
      if (!this.isConfigured) {
        // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO quando embeddings são solicitados (Regra 6 CLAUDE.md)
        logger.error('SALAD_API_KEY não configurado - embeddings solicitados mas indisponíveis');
        throw new Error('Configuração Salad Cloud obrigatória para gerar embeddings. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.');
      }
      
      logger.info({ chunkCount: textChunks.length }, 'Gerando embeddings para chunks do documento');

      for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        
        try {
          const result = await generateEmbedding(chunkText);
          embeddingModel = result.model;

          chunks.push({
            text: chunkText,
            chunkIndex: i,
            embedding: result.embedding,
          });

          // Acumular para média
          for (let j = 0; j < result.embedding.length; j++) {
            combinedEmbedding[j] += result.embedding[j];
          }
        } catch (error) {
          logger.warn({ error, chunkIndex: i }, 'Erro ao gerar embedding para chunk');
          
          chunks.push({
            text: chunkText,
            chunkIndex: i,
            embedding: new Array(TEXT_EMBEDDING_DIM).fill(0),
          });
        }
      }

      // Calcular média dos embeddings
      if (chunks.length > 0) {
        const validChunks = chunks.filter(c => c.embedding.some(v => v !== 0)).length;
        if (validChunks > 0) {
          for (let i = 0; i < combinedEmbedding.length; i++) {
            combinedEmbedding[i] /= validChunks;
          }
        }
      }
    } else {
      // Sem embeddings solicitados - apenas extração de texto (permitido mesmo sem Salad Cloud)
      logger.info({ chunkCount: textChunks.length }, 'Extraindo texto sem embeddings (generateEmbeddings=false)');
      
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          text: textChunks[i],
          chunkIndex: i,
          embedding: [],
        });
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      format: metadata.format,
      characterCount: metadata.characterCount,
      wordCount: metadata.wordCount,
      chunkCount: chunks.length,
      processingTimeMs,
    }, 'Documento processado');

    return {
      fullText,
      chunks,
      combinedEmbedding,
      embeddingModel,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Extrai texto de PDF usando pdf-parse
   */
  private async extractPdfText(
    buffer: Buffer,
    extractMetadata: boolean
  ): Promise<{ text: string; metadata: Partial<DocumentMetadata> }> {
    // Importação dinâmica para não quebrar se a lib não estiver instalada
    const pdfParse = (await import('pdf-parse')).default;
    
    const data = await pdfParse(buffer);
    
    const metadata: Partial<DocumentMetadata> = {
      pageCount: data.numpages,
    };

    if (extractMetadata && data.info) {
      if (data.info.Title) metadata.title = String(data.info.Title);
      if (data.info.Author) metadata.author = String(data.info.Author);
      if (data.info.CreationDate) metadata.createdAt = String(data.info.CreationDate);
      if (data.info.ModDate) metadata.modifiedAt = String(data.info.ModDate);
    }

    return {
      text: data.text,
      metadata,
    };
  }

  /**
   * Extrai texto de DOCX usando mammoth
   */
  private async extractDocxText(
    buffer: Buffer
  ): Promise<{ text: string; metadata: Partial<DocumentMetadata> }> {
    const mammoth = await import('mammoth');
    
    const result = await mammoth.extractRawText({ buffer });
    
    return {
      text: result.value,
      metadata: {},
    };
  }

  /**
   * Extrai texto de uma célula ExcelJS, tratando todos os tipos possíveis:
   * - Primitivos: string, number, boolean
   * - Date: converte para ISO string
   * - CellFormulaValue: extrai .result (resultado da fórmula)
   * - CellHyperlinkValue: extrai .text (texto do link)
   * - CellRichTextValue: concatena .richText[].text
   * - CellErrorValue: extrai .error.message ou código
   * - null/undefined: retorna string vazia
   * 
   * Evita "[object Object]" que ocorreria com String() simples
   * 
   * @param cell - Valor da célula ExcelJS
   * @param depth - Profundidade de recursão (proteção contra loops infinitos)
   */
  private extractCellText(cell: unknown, depth: number = 0): string {
    // Proteção contra recursão infinita (máximo 3 níveis: 0, 1, 2)
    const MAX_DEPTH = 3;
    if (depth >= MAX_DEPTH) {
      return '';
    }

    // Null ou undefined
    if (cell === null || cell === undefined) {
      return '';
    }

    // Primitivos - conversão direta, sem recursão
    if (typeof cell === 'string') {
      return cell;
    }
    if (typeof cell === 'number' || typeof cell === 'boolean') {
      return String(cell);
    }

    // Date - conversão direta, sem recursão
    if (cell instanceof Date) {
      return cell.toISOString();
    }

    // Objeto complexo do ExcelJS
    if (typeof cell === 'object') {
      const obj = cell as Record<string, unknown>;

      // CellRichTextValue: { richText: [{ text: string, font?: ... }, ...] }
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text?: string }>)
          .map(part => part.text || '')
          .join('');
      }

      // CellHyperlinkValue: { text: string, hyperlink: string }
      // Verifica AMBOS text e hyperlink para garantir que é realmente um hyperlink
      if ('text' in obj && 'hyperlink' in obj && typeof obj.text === 'string') {
        return obj.text;
      }

      // CellFormulaValue: { formula: string, result?: unknown }
      // Para RAG, só o resultado importa - fórmula bruta não tem valor semântico
      if ('formula' in obj) {
        // Usa o resultado da fórmula se disponível
        if ('result' in obj && obj.result !== undefined) {
          // Conversão direta para tipos primitivos (evita recursão desnecessária)
          const result = obj.result;
          if (typeof result === 'string') return result;
          if (typeof result === 'number' || typeof result === 'boolean') return String(result);
          if (result instanceof Date) return result.toISOString();
          // Objeto complexo: recursão com depth incrementado
          return this.extractCellText(result, depth + 1);
        }
        // Sem resultado: retorna vazio (fórmula bruta não ajuda RAG)
        return '';
      }

      // CellErrorValue: { error: { message?: string, ... } }
      // Retorna apenas a mensagem de erro (ex: #DIV/0!, #REF!, #VALUE!)
      // Sem prefixo redundante já que códigos Excel começam com #
      // Validação completa: error deve ser objeto não-nulo (não primitivo)
      if ('error' in obj && typeof obj.error === 'object' && obj.error !== null) {
        const error = obj.error as Record<string, unknown>;
        if ('message' in error) {
          return String(error.message);
        }
        return '#ERROR';
      }

      // SharedStringValue ou outros: tenta .value
      if ('value' in obj && obj.value !== undefined) {
        // Conversão direta para tipos primitivos (evita recursão desnecessária)
        const val = obj.value;
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        if (val instanceof Date) return val.toISOString();
        // Objeto complexo: recursão com depth incrementado
        return this.extractCellText(val, depth + 1);
      }

      // Objeto genérico com text (mas NÃO é hyperlink - já verificado acima)
      // Ex: { text: 'Texto simples' } sem propriedade hyperlink
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text;
      }
    }

    // Fallback: tenta converter para string (não deve chegar aqui)
    const str = String(cell);
    // Evita retornar "[object Object]"
    if (str === '[object Object]') {
      return '';
    }
    return str;
  }

  /**
   * Extrai texto de XLSX usando exceljs (substituição do xlsx vulnerável)
   * CVE-2024-22363, CVE-2024-3766 corrigidos pela substituição
   * 
   * Trata corretamente todos os tipos de célula do ExcelJS:
   * Formula, Hyperlink, RichText, Error, além de primitivos e Date
   */
  private async extractXlsxText(
    buffer: Buffer | ArrayBuffer | ArrayBufferView
  ): Promise<{ text: string; metadata: Partial<DocumentMetadata> }> {
    // Import dinâmico do exceljs
    // exceljs pode exportar como default ou como módulo direto dependendo do bundler/ambiente
    // Abordagem defensiva: verificar ambos os padrões de export
    // REGRA 8: TypeScript strict, zero any - tipagem correta do dynamic import
    const excelModule = await import('exceljs');
    
    // Type guard para verificar se é default export ou named export
    // exceljs 4.4.0 pode exportar como:
    // - { default: { Workbook, ... } } (objeto com propriedades)
    // - { default: class Workbook {} } (função construtora/classe como default)
    // - { Workbook, ... } (named exports diretos)
    // Verificar se tem propriedade 'default' e se é um objeto ou função válida
    const ExcelJSLib = (
      'default' in excelModule &&
      excelModule.default !== null &&
      (
        (typeof excelModule.default === 'object' && 'Workbook' in excelModule.default) ||
        typeof excelModule.default === 'function'
      )
    )
      ? excelModule.default as typeof excelModule
      : excelModule;
    
    const workbook = new ExcelJSLib.Workbook();
    // Garantir que buffer é um Buffer do Node.js (não Buffer<ArrayBufferLike> de Web APIs)
    // exceljs 4.4.0+ requer Buffer do Node.js, não tipos genéricos de Buffer
    // REGRA 6: Enterprise-grade - validação robusta + isolamento TOTAL de buffer
    // Buffer.from(buffer) cria cópia quando buffer é Buffer ou TypedArray
    // Buffer.from(arrayBuffer) compartilha memória - converter via Uint8Array para forçar cópia
    // Isso garante isolamento verdadeiro e evita mutação do buffer original durante load
    let nodeBuffer: Buffer;
    if (Buffer.isBuffer(buffer)) {
      // Buffer do Node.js - Buffer.from() cria cópia isolada
      nodeBuffer = Buffer.from(buffer);
    } else if (ArrayBuffer.isView(buffer)) {
      // TypedArray (Uint8Array, etc.) - Buffer.from() cria cópia isolada
      const typedArray = buffer as ArrayBufferView;
      const { buffer: arrayBuffer, byteOffset, byteLength } = typedArray;
      nodeBuffer = Buffer.from(new Uint8Array(arrayBuffer, byteOffset, byteLength));
    } else {
      // ArrayBuffer ou Buffer<ArrayBufferLike> - converter via Uint8Array para forçar cópia
      if (buffer instanceof ArrayBuffer) {
        nodeBuffer = Buffer.from(new Uint8Array(buffer));
      } else {
        throw new Error('Tipo de buffer não suportado para processamento XLSX. Esperado Buffer, TypedArray ou ArrayBuffer.');
      }
    }
    await workbook.xlsx.load(nodeBuffer);
    
    let text = '';
    workbook.eachSheet((worksheet: Worksheet, sheetId: number) => {
      const sheetName = worksheet.name || `Sheet${sheetId}`;
      const rows: string[] = [];
      
      worksheet.eachRow({ includeEmpty: false }, (row: Row) => {
        // row.values é 1-indexed, então slice(1) para pular o primeiro elemento vazio
        // Null-check para evitar TypeError se row.values for undefined
        const values = (row.values || []) as unknown[];
        const cellTexts = values.slice(1).map(cell => this.extractCellText(cell));
        
        // Verifica se pelo menos uma célula tem conteúdo real (não apenas vírgulas vazias)
        const hasContent = cellTexts.some(text => text.trim() !== '');
        if (hasContent) {
          rows.push(cellTexts.join(','));
        }
      });
      
      if (rows.length > 0) {
        text += `\n=== Planilha: ${sheetName} ===\n${rows.join('\n')}\n`;
      }
    });

    return {
      text: text.trim(),
      metadata: {
        pageCount: workbook.worksheets.length,
      },
    };
  }

  /**
   * Divide texto em chunks com overlap para contexto
   */
  private splitIntoChunks(text: string, chunkSize: number, maxChunks: number): string[] {
    const chunks: string[] = [];
    const overlap = Math.floor(chunkSize * 0.1); // 10% de overlap

    // Normalizar whitespace
    const normalizedText = text.replace(/\s+/g, ' ').trim();

    if (normalizedText.length <= chunkSize) {
      return [normalizedText];
    }

    let start = 0;
    while (start < normalizedText.length && chunks.length < maxChunks) {
      let end = start + chunkSize;

      // Tentar quebrar em um espaço para não cortar palavras
      if (end < normalizedText.length) {
        const lastSpace = normalizedText.lastIndexOf(' ', end);
        if (lastSpace > start + chunkSize * 0.8) {
          end = lastSpace;
        }
      }

      const chunk = normalizedText.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Próximo chunk começa com overlap
      start = end - overlap;
    }

    if (chunks.length >= maxChunks) {
      logger.warn({
        originalLength: normalizedText.length,
        chunks: chunks.length,
        maxChunks,
      }, 'Documento truncado devido ao limite máximo de chunks');
    }

    return chunks;
  }

  /**
   * Mapeia MIME type para formato legível
   */
  private getFormatFromMimeType(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/msword': 'DOC',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
      'application/vnd.ms-excel': 'XLS',
      'text/plain': 'TXT',
      'text/markdown': 'MD',
      'text/csv': 'CSV',
    };

    return formatMap[mimeType] || 'UNKNOWN';
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
    embeddingDim: number;
    maxDocumentSizeMB: number;
    chunkSize: number;
    supportedFormats: string[];
  } {
    return {
      configured: this.isConfigured,
      embeddingDim: TEXT_EMBEDDING_DIM,
      maxDocumentSizeMB: MAX_DOCUMENT_SIZE_MB,
      chunkSize: CHUNK_SIZE,
      supportedFormats: ['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'TXT', 'MD', 'CSV'],
    };
  }
}

// Singleton
let documentProcessorInstance: DocumentProcessorService | null = null;

export function getDocumentProcessor(): DocumentProcessorService {
  if (!documentProcessorInstance) {
    documentProcessorInstance = new DocumentProcessorService();
  }
  return documentProcessorInstance;
}

export const documentProcessor = getDocumentProcessor();

/**
 * Retorna status do circuit breaker de embeddings (Regra 16 - Observability)
 */
export function getDocumentEmbeddingCircuitBreakerStatus(): {
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
  const stats = embeddingBreaker.stats;
  return {
    state: embeddingBreaker.opened ? 'open' : (embeddingBreaker.halfOpen ? 'half-open' : 'closed'),
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


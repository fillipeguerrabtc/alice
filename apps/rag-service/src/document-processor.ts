/**
 * Document Processor Service - Alice Enterprise Platform
 * 
 * Processamento de documentos:
 * - PDF: Extração de texto via pdf-parse
 * - DOCX: Extração de texto via mammoth
 * - XLSX: Extração de texto via exceljs (CVE-2024-22363, CVE-2024-3766 corrigidos)
 * - TXT/MD: Leitura direta
 * - Text embeddings do conteúdo extraído (Salad Cloud)
 * - Circuit Breaker para resiliência (Regra 16 replit.md)
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

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
    let combinedEmbedding: number[] = new Array(TEXT_EMBEDDING_DIM).fill(0);
    let embeddingModel = 'none';

    if (generateEmbeddings) {
      // Embeddings solicitados - verificar se está configurado
      if (!this.isConfigured) {
        // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO quando embeddings são solicitados (Regra 6 replit.md)
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
   */
  private extractCellText(cell: unknown): string {
    // Null ou undefined
    if (cell === null || cell === undefined) {
      return '';
    }

    // Primitivos
    if (typeof cell === 'string') {
      return cell;
    }
    if (typeof cell === 'number' || typeof cell === 'boolean') {
      return String(cell);
    }

    // Date
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
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text;
      }

      // CellFormulaValue: { formula: string, result?: unknown }
      if ('formula' in obj) {
        // Usa o resultado da fórmula se disponível
        if ('result' in obj && obj.result !== undefined) {
          return this.extractCellText(obj.result);
        }
        // Fallback: mostra a fórmula
        return `=${String(obj.formula)}`;
      }

      // CellErrorValue: { error: { message?: string, ... } }
      if ('error' in obj) {
        const error = obj.error as Record<string, unknown>;
        if (error && typeof error.message === 'string') {
          return `#ERROR: ${error.message}`;
        }
        return '#ERROR';
      }

      // SharedStringValue ou outros: tenta .value
      if ('value' in obj && obj.value !== undefined) {
        return this.extractCellText(obj.value);
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
    buffer: Buffer
  ): Promise<{ text: string; metadata: Partial<DocumentMetadata> }> {
    const ExcelJS = await import('exceljs');
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    
    let text = '';
    let totalRows = 0;

    workbook.eachSheet((worksheet, sheetId) => {
      const sheetName = worksheet.name || `Sheet${sheetId}`;
      const rows: string[] = [];
      
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        // row.values é 1-indexed, então slice(1) para pular o primeiro elemento vazio
        const values = row.values as unknown[];
        const rowText = values.slice(1).map(cell => this.extractCellText(cell)).join(',');
        
        if (rowText.trim()) {
          rows.push(rowText);
        }
      });
      
      if (rows.length > 0) {
        text += `\n=== Planilha: ${sheetName} ===\n${rows.join('\n')}\n`;
        totalRows += rows.length;
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


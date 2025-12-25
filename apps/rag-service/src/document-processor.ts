/**
 * Document Processor Service - Alice Enterprise Platform
 * 
 * Processamento de documentos:
 * - PDF: Extração de texto via pdf-parse
 * - DOCX: Extração de texto via mammoth
 * - XLSX: Extração de texto via exceljs (CVE-2024-22363, CVE-2024-3766 corrigidos)
 * - TXT/MD: Leitura direta
 * - Text embeddings via GPU (Qwen3-Embedding-8B, 4096 dim)
 * - Circuit Breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * ARQUITETURA 100% GPU (25/12/2025):
 * - Embeddings via GPU Manager Service (Qwen3-Embedding-8B, 4096 dim)
 * - Embeddings de texto armazenados em Qdrant
 * - GPU é OBRIGATÓRIO - sem fallback CPU (Regra 6)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 *
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/shared-utils';
import { validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import type { Worksheet, Row } from 'exceljs';

const logger = createLogger('document-processor');

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// URL é usada internamente pelo requestGpu, não precisa ser exposta aqui

// Dimensão dos embeddings de texto - ARQUITETURA UNIFICADA (17/12/2025)
// Qwen3-Embedding-8B: 4096 dim (8B params, máxima qualidade)
// Armazenado em Qdrant (suporta HNSW com 4096+ dim)
export const TEXT_EMBEDDING_DIM = 4096;

// ============================================================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE - CORREÇÃO AUDITORIA 17/12/2025
// Bug: parseInt sem validação de NaN causava:
// - sizeMB > NaN = false → bypass de limite de tamanho (vulnerabilidade)
// - fullText.length > NaN = false → texto ilimitado (DoS)
// - end - NaN = NaN → loop infinito em splitIntoChunks (crash)
// ============================================================================

/**
 * Parseia variável de ambiente como inteiro com validação robusta
 * CORREÇÃO AUDITORIA 17/12/2025: parseInt sem validação de NaN é anti-pattern
 * 
 * @param envValue - Valor da variável de ambiente
 * @param defaultValue - Valor padrão se inválido
 * @param varName - Nome da variável para logging
 * @returns Inteiro válido ou throw em produção se inválido
 */
function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  
  // Regra 6: Rejeitar valores parciais como "50MB" (parseInt aceitaria como 50)
  if (!/^\d+$/.test(trimmed)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  return parsed;
}

// Limites de processamento - VALIDADOS contra NaN (CORREÇÃO AUDITORIA 17/12/2025)
const MAX_DOCUMENT_SIZE_MB = parseEnvInt(process.env.MAX_DOCUMENT_SIZE_MB, 50, 'MAX_DOCUMENT_SIZE_MB');
const MAX_TEXT_LENGTH = parseEnvInt(process.env.MAX_TEXT_LENGTH, 100000, 'MAX_TEXT_LENGTH'); // 100k caracteres
const CHUNK_SIZE = parseEnvInt(process.env.DOCUMENT_CHUNK_SIZE, 8000, 'DOCUMENT_CHUNK_SIZE'); // Tamanho de cada chunk para embedding

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
  // ARQUITETURA ENTERPRISE (25/12/2025) - Qwen3-Embedding-8B via GPU Manager Service (4096 dim → Qdrant)
  // GPU é OBRIGATÓRIO - sem fallback CPU (Regra 6)
  
  try {
    // Enfileirar requisição no GPU Manager com prioridade MEDIUM (embeddings RAG)
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.EMBEDDINGS,
      endpoint: '/embed/text',
      method: 'POST',
      priority: GpuRequestPriority.MEDIUM,
      timeout: 30000, // 30s timeout
      body: {
        text: params.text,
      },
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

    // Validar dimensão (deve ser 4096 para Qwen3-Embedding-8B) - Enterprise-Grade
    validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    return {
      embedding: result.embedding,
      model: result.model || 'Qwen/Qwen3-Embedding-8B',
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Erro desconhecido ao gerar embedding: ${String(error)}`);
  }
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
  private isConfigured: boolean;

  constructor() {
    // ARQUITETURA ENTERPRISE (25/12/2025) - Qwen3-Embedding-8B via GPU Manager Service (Hetzner GEX44) → Qdrant
    this.isConfigured = typeof GPU_MANAGER_URL === 'string' && GPU_MANAGER_URL.length > 0;
    
    if (!this.isConfigured) {
      logger.warn('GPU Manager Service não configurado - embeddings de documento não funcionarão');
    } else {
      logger.info({ gpuManagerUrl: GPU_MANAGER_URL, embeddingDim: TEXT_EMBEDDING_DIM }, 
        'Document Processor - ARQUITETURA ENTERPRISE (Qwen3-Embedding-8B, 4096 dim → Qdrant)');
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
    let combinedEmbedding: number[] = [];
    let embeddingModel = 'none';

    if (generateEmbeddings) {
      // Regra 6 (Fail-fast): se embeddings foram solicitados mas não há chunks,
      // o documento não tem texto extraível útil (ou está vazio/apenas whitespace).
      // Não retornar "sucesso" com embeddings vazios.
      if (textChunks.length === 0) {
        logger.error(
          { format: metadata.format, characterCount: metadata.characterCount, wordCount: metadata.wordCount },
          'Nenhum chunk de texto gerado para embeddings. Rejeitando processamento (Regra 6 - Fail-fast).'
        );
        throw new Error('Documento sem texto extraível para gerar embeddings');
      }

      // REGRA 6: Serviço local sempre disponível (serviço interno na rede Docker)
      // Não requer verificação de configuração externa
      logger.info({ chunkCount: textChunks.length }, 'Gerando embeddings para chunks do documento (serviço local)');

      // Acumuladores (zeros aqui são apenas estado inicial matemático; NÃO é fallback retornado ao cliente).
      const sumEmbedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
      let successfulEmbeddings = 0;
      let hadEmbeddingError = false;

      for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        
        try {
          const result = await generateEmbedding(chunkText);
          embeddingModel = result.model;

          // Enterprise-grade: garantir dimensão esperada (4096) antes de acumular.
          // Isso evita "corrupção silenciosa" do embedding médio caso a dependência retorne dimensão inesperada.
          validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

          chunks.push({
            text: chunkText,
            chunkIndex: i,
            embedding: result.embedding,
          });

          // Acumular para média
          for (let j = 0; j < TEXT_EMBEDDING_DIM; j++) {
            sumEmbedding[j] += result.embedding[j];
          }
          successfulEmbeddings++;
        } catch (error) {
          logger.error({ error, chunkIndex: i, totalChunks: textChunks.length }, 'Erro ao gerar embedding para chunk');
          hadEmbeddingError = true;
          
          // Regra 6: Não incluir chunks com embedding vazio no resultado (evita inconsistência de dados).
          // Apenas chunks bem-sucedidos serão incluídos. Se TODOS falharem, o processamento falhará (fail-fast).
          // O texto do chunk que falhou não será incluído no resultado, mas será logado para análise.
        }
      }

      // Calcular média dos embeddings (apenas dos chunks com embedding real)
      // Regra 6: Se TODOS os chunks falharam, não retornar combinedEmbedding vazio (fail-fast)
      if (successfulEmbeddings > 0) {
        combinedEmbedding = sumEmbedding.map((v) => v / successfulEmbeddings);
        
        // Enterprise-grade: validar que combinedEmbedding resultante é válido (não contém NaN/Infinity)
        const hasInvalidValues = combinedEmbedding.some(v => !Number.isFinite(v));
        if (hasInvalidValues) {
          logger.error(
            { 
              successfulEmbeddings,
              totalChunks: textChunks.length,
              combinedEmbeddingLength: combinedEmbedding.length,
            },
            'combinedEmbedding contém valores não-finitos após cálculo da média. Rejeitando processamento (Regra 6 - Fail-fast).'
          );
          throw new Error('Falha ao gerar embedding combinado: valores não-finitos detectados na média dos chunks');
        }
      } else {
        // Regra 6: Se nenhum chunk teve sucesso, falhar explicitamente ao invés de retornar array vazio
        if (hadEmbeddingError) {
          logger.error(
            { totalChunks: textChunks.length },
            'Falha ao gerar embeddings para TODOS os chunks do documento. Rejeitando processamento (Regra 6 - Fail-fast).'
          );
          throw new Error('Falha ao gerar embeddings: nenhum chunk foi processado com sucesso');
        }

        // Regra 6 (Fail-fast): se chegamos aqui, algo está inconsistente (ex.: chunks > 0, mas nenhum embedding).
        // Não mascarar como "sucesso" com embedding vazio.
        logger.error(
          { totalChunks: textChunks.length, successfulEmbeddings, hadEmbeddingError },
          'Nenhum embedding gerado sem erro explícito. Rejeitando processamento (Regra 6 - Fail-fast).'
        );
        throw new Error('Falha ao gerar embeddings: nenhum chunk foi processado com sucesso');
      }
    } else {
      // Sem embeddings solicitados - apenas extração de texto
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
    // REGRA 6: Enterprise-grade - validação robusta + isolamento TOTAL de buffer
    // exceljs define seu próprio tipo 'interface Buffer extends ArrayBuffer' (linha 1 do index.d.ts)
    // que conflita com Buffer<ArrayBufferLike> do @types/node 22+. A solução é converter
    // para Uint8Array e usar .buffer para obter ArrayBuffer compatível com ambos os tipos.
    // Isso garante isolamento de memória e compatibilidade de tipos.
    let arrayBuffer: ArrayBuffer;
    if (Buffer.isBuffer(buffer)) {
      // Buffer do Node.js: criar cópia isolada via Uint8Array
      const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      arrayBuffer = uint8.slice().buffer; // slice() cria cópia isolada
    } else if (ArrayBuffer.isView(buffer)) {
      // TypedArray (Uint8Array, DataView, etc.): extrair ArrayBuffer com cópia
      const typedArray = buffer as ArrayBufferView;
      const uint8 = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
      arrayBuffer = uint8.slice().buffer;
    } else if (buffer instanceof ArrayBuffer) {
      // ArrayBuffer puro: criar cópia isolada
      arrayBuffer = buffer.slice(0);
    } else {
      throw new Error('Tipo de buffer não suportado para processamento XLSX. Esperado Buffer, TypedArray ou ArrayBuffer.');
    }
    // exceljs aceita ArrayBuffer diretamente pois sua interface Buffer extends ArrayBuffer
    // Cast via unknown necessário para satisfazer tipagem do método load(buffer: Buffer)
    await workbook.xlsx.load(arrayBuffer as unknown as import('exceljs').Buffer);
    
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
   * Readiness real (assíncrono): valida conectividade com o serviço GPU de embeddings
   */
  async isReadyAsync(): Promise<boolean> {
    if (!this.isConfigured) return false;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      // Verificar se GPU Manager Service está pronto
      const response = await fetch(`${process.env.GPU_MANAGER_URL || 'http://gpu-manager-service:3010'}/ready`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, gpuManagerUrl: GPU_MANAGER_URL },
          'Serviço GPU de embeddings não está pronto'
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar readiness do GPU Manager Service');
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
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


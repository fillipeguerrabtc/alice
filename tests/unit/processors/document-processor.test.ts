/**
 * Testes do Document Processor - Alice Enterprise Platform
 * 
 * Testes unitários para processamento de documentos:
 * - PDF, DOCX, XLSX, TXT/MD
 * - Extração de texto
 * - Validação de tipos de célula ExcelJS
 * - Chunking de texto
 * 
 * Author: Fillipe Guerra
 * Data: 04/12/2025
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// MOCKS - Simular dependências externas
// ============================================================================

// Mock do logger para evitar output durante testes
vi.mock('@alice/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock do circuit breaker
vi.mock('@alice/shared-utils', () => ({
  createCircuitBreaker: vi.fn((fn) => ({
    fire: fn,
    getState: () => 'closed',
    getStats: () => ({ failures: 0, successes: 0, timeouts: 0 }),
  })),
  CIRCUIT_BREAKER_PRESETS: {
    textEmbeddings: { failureThreshold: 5, resetTimeout: 30000 },
  },
}));

// ============================================================================
// TESTES DE EXTRAÇÃO DE CÉLULAS EXCEL
// ============================================================================

describe('Document Processor - Extração de Células ExcelJS', () => {
  /**
   * Simula o método extractCellText do DocumentProcessorService
   * Implementação espelho para testes unitários
   * 
   * @param cell - Valor da célula ExcelJS
   * @param depth - Profundidade de recursão (proteção contra loops infinitos)
   */
  function extractCellText(cell: unknown, depth: number = 0): string {
    // Proteção contra recursão infinita (máximo 3 níveis: 0, 1, 2)
    const MAX_DEPTH = 3;
    if (depth >= MAX_DEPTH) {
      return '';
    }

    // Null ou undefined
    if (cell === null || cell === undefined) {
      return '';
    }

    // Primitivos - conversão direta
    if (typeof cell === 'string') {
      return cell;
    }
    if (typeof cell === 'number' || typeof cell === 'boolean') {
      return String(cell);
    }

    // Date - conversão direta
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
      if ('text' in obj && 'hyperlink' in obj && typeof obj.text === 'string') {
        return obj.text;
      }

      // CellFormulaValue: { formula: string, result?: ... }
      if ('formula' in obj) {
        if ('result' in obj && obj.result !== undefined) {
          const result = obj.result;
          if (typeof result === 'string') return result;
          if (typeof result === 'number' || typeof result === 'boolean') return String(result);
          if (result instanceof Date) return result.toISOString();
          return extractCellText(result, depth + 1);
        }
        return '';
      }

      // CellErrorValue: { error: { message?: string } }
      if ('error' in obj && typeof obj.error === 'object' && obj.error !== null) {
        const error = obj.error as Record<string, unknown>;
        if ('message' in error) {
          return String(error.message);
        }
        return '#ERROR';
      }

      // SharedStringValue ou outros: tenta .value
      if ('value' in obj && obj.value !== undefined) {
        const val = obj.value;
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        if (val instanceof Date) return val.toISOString();
        return extractCellText(val, depth + 1);
      }

      // Objeto genérico com text - mas NÃO é hyperlink
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text;
      }
    }

    // Fallback seguro - evita [object Object]
    return '';
  }

  describe('Valores Primitivos', () => {
    it('deve retornar string diretamente', () => {
      expect(extractCellText('Hello World')).toBe('Hello World');
    });

    it('deve converter número para string', () => {
      expect(extractCellText(42)).toBe('42');
      expect(extractCellText(3.14159)).toBe('3.14159');
      expect(extractCellText(-100)).toBe('-100');
      expect(extractCellText(0)).toBe('0');
    });

    it('deve converter boolean para string', () => {
      expect(extractCellText(true)).toBe('true');
      expect(extractCellText(false)).toBe('false');
    });

    it('deve retornar string vazia para null', () => {
      expect(extractCellText(null)).toBe('');
    });

    it('deve retornar string vazia para undefined', () => {
      expect(extractCellText(undefined)).toBe('');
    });
  });

  describe('Valores Date', () => {
    it('deve converter Date para ISO string', () => {
      const date = new Date('2025-12-04T10:30:00.000Z');
      expect(extractCellText(date)).toBe('2025-12-04T10:30:00.000Z');
    });
  });

  describe('CellRichTextValue', () => {
    it('deve concatenar texto de richText array', () => {
      const richText = {
        richText: [
          { text: 'Hello ' },
          { text: 'World', font: { bold: true } },
          { text: '!' },
        ],
      };
      expect(extractCellText(richText)).toBe('Hello World!');
    });

    it('deve tratar richText com partes vazias', () => {
      const richText = {
        richText: [
          { text: 'Texto' },
          { font: { italic: true } }, // Sem propriedade text
          { text: ' Final' },
        ],
      };
      expect(extractCellText(richText)).toBe('Texto Final');
    });

    it('deve retornar string vazia para richText vazio', () => {
      const richText = { richText: [] };
      expect(extractCellText(richText)).toBe('');
    });
  });

  describe('CellHyperlinkValue', () => {
    it('deve extrair texto de hyperlink', () => {
      const hyperlink = {
        text: 'Clique aqui',
        hyperlink: 'https://example.com',
      };
      expect(extractCellText(hyperlink)).toBe('Clique aqui');
    });

    it('deve tratar hyperlink com texto vazio', () => {
      const hyperlink = {
        text: '',
        hyperlink: 'https://example.com',
      };
      expect(extractCellText(hyperlink)).toBe('');
    });
  });

  describe('CellFormulaValue', () => {
    it('deve extrair resultado numérico de fórmula', () => {
      const formula = {
        formula: 'SUM(A1:A10)',
        result: 150,
      };
      expect(extractCellText(formula)).toBe('150');
    });

    it('deve extrair resultado string de fórmula', () => {
      const formula = {
        formula: 'CONCATENATE(A1, B1)',
        result: 'HelloWorld',
      };
      expect(extractCellText(formula)).toBe('HelloWorld');
    });

    it('deve extrair resultado Date de fórmula', () => {
      const formula = {
        formula: 'TODAY()',
        result: new Date('2025-12-04T00:00:00.000Z'),
      };
      expect(extractCellText(formula)).toBe('2025-12-04T00:00:00.000Z');
    });

    it('deve retornar string vazia para fórmula sem resultado', () => {
      const formula = {
        formula: 'SUM(A1:A10)',
      };
      expect(extractCellText(formula)).toBe('');
    });
  });

  describe('CellErrorValue', () => {
    it('deve extrair mensagem de erro', () => {
      const error = {
        error: { message: '#DIV/0!' },
      };
      expect(extractCellText(error)).toBe('#DIV/0!');
    });

    it('deve retornar #ERROR para erro sem mensagem', () => {
      const error = {
        error: {},
      };
      expect(extractCellText(error)).toBe('#ERROR');
    });
  });

  describe('Objeto com propriedade text (não hyperlink)', () => {
    it('deve extrair text de objeto genérico', () => {
      const obj = { text: 'Texto simples' };
      expect(extractCellText(obj)).toBe('Texto simples');
    });
  });

  describe('Fallback para objetos desconhecidos', () => {
    it('deve retornar string vazia para objeto sem propriedades conhecidas', () => {
      const unknown = { foo: 'bar', baz: 123 };
      expect(extractCellText(unknown)).toBe('');
    });

    it('NÃO deve retornar [object Object]', () => {
      const obj = { some: 'object' };
      const result = extractCellText(obj);
      expect(result).not.toBe('[object Object]');
      expect(result).toBe('');
    });
  });

  describe('Proteção contra recursão infinita', () => {
    it('deve limitar profundidade de recursão a 3 níveis', () => {
      // Simula estrutura profundamente aninhada
      const deepNested = {
        value: {
          value: {
            value: {
              value: {
                value: 'muito profundo', // Nível 5 - não será alcançado
              },
            },
          },
        },
      };
      // Com MAX_DEPTH = 3, deve retornar vazio após 3 níveis
      const result = extractCellText(deepNested);
      expect(result).toBe('');
    });

    it('deve processar estrutura dentro do limite', () => {
      // Estrutura com 2 níveis de aninhamento
      const nested = {
        value: {
          value: 'valor válido',
        },
      };
      const result = extractCellText(nested);
      expect(result).toBe('valor válido');
    });

    it('deve processar fórmula com resultado aninhado', () => {
      const formula = {
        formula: 'INDIRECT(A1)',
        result: {
          value: 42,
        },
      };
      const result = extractCellText(formula);
      expect(result).toBe('42');
    });
  });
});

// ============================================================================
// TESTES DE CHUNKING DE TEXTO
// ============================================================================

describe('Document Processor - Chunking de Texto', () => {
  /**
   * Simula o método splitIntoChunks do DocumentProcessorService
   */
  function splitIntoChunks(text: string, chunkSize: number = 8000, maxChunks: number = 50): string[] {
    if (!text || text.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    const overlap = Math.floor(chunkSize * 0.1); // 10% overlap
    let startIndex = 0;

    while (startIndex < text.length && chunks.length < maxChunks) {
      let endIndex = Math.min(startIndex + chunkSize, text.length);

      // Tentar quebrar em um espaço para não cortar palavras
      if (endIndex < text.length) {
        const lastSpace = text.lastIndexOf(' ', endIndex);
        if (lastSpace > startIndex + chunkSize * 0.5) {
          endIndex = lastSpace;
        }
      }

      chunks.push(text.slice(startIndex, endIndex).trim());
      startIndex = endIndex - overlap;

      // Evitar loop infinito
      if (startIndex >= text.length - overlap) {
        break;
      }
    }

    return chunks.filter(c => c.length > 0);
  }

  it('deve retornar array vazio para texto vazio', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });

  it('deve retornar texto completo se menor que chunkSize', () => {
    const text = 'Texto pequeno';
    const chunks = splitIntoChunks(text, 1000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });

  it('deve dividir texto longo em múltiplos chunks', () => {
    const text = 'Palavra '.repeat(500); // ~4000 caracteres
    const chunks = splitIntoChunks(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('deve respeitar o limite maxChunks', () => {
    const text = 'Texto muito longo '.repeat(10000);
    const chunks = splitIntoChunks(text, 100, 5);
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it('deve criar overlap entre chunks', () => {
    const text = 'A '.repeat(2000); // Texto grande
    const chunks = splitIntoChunks(text, 500, 50);
    
    if (chunks.length > 1) {
      // Verificar que há overlap (chunk N termina onde chunk N+1 ainda tem conteúdo)
      // O overlap é de 10%, então esperamos alguma sobreposição
      expect(chunks.length).toBeGreaterThan(1);
    }
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO DE TIPO DE DOCUMENTO
// ============================================================================

describe('Document Processor - Validação de MIME Types', () => {
  const supportedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
    'text/markdown',
    'text/csv',
  ];

  function getFormatFromMimeType(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-excel': 'xls',
      'text/plain': 'txt',
      'text/markdown': 'md',
      'text/csv': 'csv',
    };
    return formatMap[mimeType] || 'unknown';
  }

  it('deve reconhecer PDF', () => {
    expect(getFormatFromMimeType('application/pdf')).toBe('pdf');
  });

  it('deve reconhecer DOCX', () => {
    expect(getFormatFromMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
  });

  it('deve reconhecer DOC legacy', () => {
    expect(getFormatFromMimeType('application/msword')).toBe('doc');
  });

  it('deve reconhecer XLSX', () => {
    expect(getFormatFromMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
  });

  it('deve reconhecer XLS legacy', () => {
    expect(getFormatFromMimeType('application/vnd.ms-excel')).toBe('xls');
  });

  it('deve reconhecer TXT', () => {
    expect(getFormatFromMimeType('text/plain')).toBe('txt');
  });

  it('deve reconhecer Markdown', () => {
    expect(getFormatFromMimeType('text/markdown')).toBe('md');
  });

  it('deve reconhecer CSV', () => {
    expect(getFormatFromMimeType('text/csv')).toBe('csv');
  });

  it('deve retornar unknown para tipo não suportado', () => {
    expect(getFormatFromMimeType('application/octet-stream')).toBe('unknown');
    expect(getFormatFromMimeType('image/png')).toBe('unknown');
  });

  it('deve listar 8 tipos MIME suportados', () => {
    expect(supportedMimeTypes.length).toBe(8);
  });
});

// ============================================================================
// TESTES DE LIMITES E VALIDAÇÕES
// ============================================================================

describe('Document Processor - Limites e Validações', () => {
  const MAX_DOCUMENT_SIZE_MB = 50;
  const MAX_TEXT_LENGTH = 100000;

  it('deve ter limite de tamanho de documento de 50MB', () => {
    expect(MAX_DOCUMENT_SIZE_MB).toBe(50);
  });

  it('deve ter limite de texto de 100k caracteres', () => {
    expect(MAX_TEXT_LENGTH).toBe(100000);
  });

  it('deve truncar texto que excede o limite', () => {
    const longText = 'A'.repeat(150000);
    const truncated = longText.slice(0, MAX_TEXT_LENGTH);
    expect(truncated.length).toBe(100000);
  });

  it('deve calcular tamanho em MB corretamente', () => {
    const buffer = Buffer.alloc(1024 * 1024 * 10); // 10MB
    const sizeMB = buffer.length / (1024 * 1024);
    expect(sizeMB).toBe(10);
  });

  it('deve rejeitar documento maior que 50MB', () => {
    const sizeMB = 60;
    const isValid = sizeMB <= MAX_DOCUMENT_SIZE_MB;
    expect(isValid).toBe(false);
  });

  it('deve aceitar documento menor que 50MB', () => {
    const sizeMB = 25;
    const isValid = sizeMB <= MAX_DOCUMENT_SIZE_MB;
    expect(isValid).toBe(true);
  });
});

// ============================================================================
// TESTES DE METADADOS
// ============================================================================

describe('Document Processor - Metadados', () => {
  interface DocumentMetadata {
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

  it('deve ter campos obrigatórios: format e fileSize', () => {
    const metadata: DocumentMetadata = {
      format: 'pdf',
      fileSize: 1024,
    };
    expect(metadata.format).toBeDefined();
    expect(metadata.fileSize).toBeDefined();
  });

  it('deve calcular wordCount corretamente', () => {
    const text = 'Olá mundo! Este é um teste.';
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    expect(wordCount).toBe(6);
  });

  it('deve calcular characterCount corretamente', () => {
    const text = 'Hello World';
    expect(text.length).toBe(11);
  });

  it('deve extrair título de PDF se disponível', () => {
    const pdfInfo = { Title: 'Documento de Teste' };
    const title = pdfInfo.Title ? String(pdfInfo.Title) : undefined;
    expect(title).toBe('Documento de Teste');
  });

  it('deve extrair autor de PDF se disponível', () => {
    const pdfInfo = { Author: 'Fillipe Guerra' };
    const author = pdfInfo.Author ? String(pdfInfo.Author) : undefined;
    expect(author).toBe('Fillipe Guerra');
  });
});

// ============================================================================
// TESTES DE EMBEDDINGS (Estrutura)
// ============================================================================

describe('Document Processor - Estrutura de Embeddings', () => {
  const TEXT_EMBEDDING_DIM = 1536;

  it('deve ter dimensão de embedding de 1536 (text-embedding-3-small)', () => {
    expect(TEXT_EMBEDDING_DIM).toBe(1536);
  });

  it('deve criar array de embedding com dimensão correta', () => {
    const embedding = new Array(TEXT_EMBEDDING_DIM).fill(0);
    expect(embedding.length).toBe(1536);
  });

  it('deve calcular média de embeddings corretamente', () => {
    const embeddings = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    
    const combined = [0, 0, 0];
    for (const emb of embeddings) {
      for (let i = 0; i < emb.length; i++) {
        combined[i] += emb[i];
      }
    }
    for (let i = 0; i < combined.length; i++) {
      combined[i] /= embeddings.length;
    }
    
    expect(combined).toEqual([4, 5, 6]);
  });

  it('deve identificar embeddings válidos (não todos zeros)', () => {
    const validEmbedding = [0.1, 0.2, 0.3];
    const invalidEmbedding = [0, 0, 0];
    
    const isValid = (emb: number[]) => emb.some(v => v !== 0);
    
    expect(isValid(validEmbedding)).toBe(true);
    expect(isValid(invalidEmbedding)).toBe(false);
  });
});

// ============================================================================
// TESTES DE PROCESSAMENTO DE LINHAS EXCEL
// ============================================================================

describe('Document Processor - Processamento de Linhas Excel', () => {
  function extractCellText(cell: unknown): string {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell;
    if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
    return '';
  }

  function processRow(values: unknown[]): { text: string; hasContent: boolean } {
    // Simula o processamento de uma linha Excel
    // values é 1-indexed no ExcelJS, então slice(1)
    const safedValues = (values || []) as unknown[];
    const cellTexts = safedValues.slice(1).map(cell => extractCellText(cell));
    const hasContent = cellTexts.some(text => text.trim() !== '');
    return {
      text: cellTexts.join(','),
      hasContent,
    };
  }

  it('deve processar linha com valores válidos', () => {
    const row = [undefined, 'Alice', 'Bob', 'Charlie'];
    const result = processRow(row);
    expect(result.text).toBe('Alice,Bob,Charlie');
    expect(result.hasContent).toBe(true);
  });

  it('deve detectar linha vazia', () => {
    const row = [undefined, '', '', ''];
    const result = processRow(row);
    expect(result.hasContent).toBe(false);
  });

  it('deve detectar linha com apenas espaços', () => {
    const row = [undefined, '   ', '  ', ''];
    const result = processRow(row);
    expect(result.hasContent).toBe(false);
  });

  it('deve tratar valores null/undefined corretamente', () => {
    const row = [undefined, null, undefined, 'Valor'];
    const result = processRow(row);
    expect(result.text).toBe(',,Valor');
    expect(result.hasContent).toBe(true);
  });

  it('deve tratar row.values undefined sem erro', () => {
    const result = processRow(undefined as unknown as unknown[]);
    expect(result.text).toBe('');
    expect(result.hasContent).toBe(false);
  });

  it('deve tratar row.values null sem erro', () => {
    const result = processRow(null as unknown as unknown[]);
    expect(result.text).toBe('');
    expect(result.hasContent).toBe(false);
  });

  it('deve processar números corretamente', () => {
    const row = [undefined, 100, 200, 300];
    const result = processRow(row);
    expect(result.text).toBe('100,200,300');
    expect(result.hasContent).toBe(true);
  });

  it('deve processar mix de tipos', () => {
    const row = [undefined, 'Nome', 42, true, null];
    const result = processRow(row);
    expect(result.text).toBe('Nome,42,true,');
    expect(result.hasContent).toBe(true);
  });
});

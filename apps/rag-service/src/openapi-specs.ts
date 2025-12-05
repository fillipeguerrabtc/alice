/**
 * Alice Enterprise Platform - RAG Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

export const ragServicePaths = {
  '/health': { get: { summary: 'Health check', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
  '/ready': { get: { summary: 'Readiness check', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' } } } },
  '/api/rag/documents': {
    get: {
      summary: 'Listar documentos',
      tags: ['Documents'],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'type', in: 'query', schema: { type: 'string', enum: ['text', 'image', 'audio', 'video', 'document'] } },
      ],
      responses: { 200: { description: 'Lista de documentos' } },
    },
    post: {
      summary: 'Upload de documento',
      tags: ['Documents'],
      requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } },
      responses: { 201: { description: 'Documento criado' }, 400: { description: 'Tipo não suportado' } },
    },
  },
  '/api/rag/documents/{id}': {
    get: { summary: 'Buscar documento', tags: ['Documents'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Documento' }, 404: { $ref: '#/components/responses/NotFound' } } },
    delete: { summary: 'Remover documento', tags: ['Documents'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Removido' } } },
  },
  '/api/rag/search': {
    post: {
      summary: 'Busca semântica',
      description: 'Realiza busca semântica usando pgvector.',
      tags: ['Search'],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 }, threshold: { type: 'number', default: 0.7 }, filter: { type: 'object', properties: { type: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } } } },
      responses: { 200: { description: 'Resultados da busca', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' }, similarity: { type: 'number' }, metadata: { type: 'object' } } } } } } } } } },
    },
  },
  '/api/rag/search/multimodal': {
    post: { summary: 'Busca multimodal', tags: ['Search'], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { query: { type: 'string' }, image: { type: 'string', format: 'binary' }, limit: { type: 'integer' } } } } } }, responses: { 200: { description: 'Resultados' } } },
  },
  '/api/rag/chunks': { get: { summary: 'Listar chunks', tags: ['Chunks'], parameters: [{ name: 'documentId', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Lista de chunks' } } } },
  '/api/rag/chunks/{id}': { get: { summary: 'Buscar chunk', tags: ['Chunks'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Chunk' } } } },
  '/api/rag/embeddings': {
    post: { summary: 'Gerar embedding', tags: ['Embeddings'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } } }, responses: { 200: { description: 'Embedding (1536 dim)', content: { 'application/json': { schema: { type: 'object', properties: { embedding: { type: 'array', items: { type: 'number' } }, dimensions: { type: 'integer' } } } } } } } },
  },
  '/api/rag/embeddings/image': {
    post: { summary: 'CLIP embedding para imagem', tags: ['Embeddings'], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } } } } }, responses: { 200: { description: 'CLIP embedding (768 dim)' } } },
  },
  '/api/rag/stats': { get: { summary: 'Estatísticas', tags: ['Health'], responses: { 200: { description: 'Stats', content: { 'application/json': { schema: { type: 'object', properties: { totalDocuments: { type: 'integer' }, totalChunks: { type: 'integer' }, storageUsed: { type: 'string' } } } } } } } } },
  '/api/rag/reindex': { post: { summary: 'Reindexar documento', tags: ['Documents'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['documentId'], properties: { documentId: { type: 'string' } } } } } }, responses: { 202: { description: 'Iniciado' } } } },
  '/metrics': { get: { summary: 'Métricas Prometheus', tags: ['Health'], security: [], responses: { 200: { description: 'Métricas' } } } },
};

export const ragServiceSchemas = {};

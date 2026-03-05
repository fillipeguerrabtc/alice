/**
 * Alice Enterprise Platform - RAG Service OpenAPI Specs
 * Author: Fillipe Guerra
 * Date: 11 Dec 2025
 */

export const ragServicePaths = {
  '/health': {
    get: {
      summary: 'Health check',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'OK' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness check',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Ready' } },
    },
  },
  '/metrics': {
    get: {
      summary: 'Prometheus metrics',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Metrics' } },
    },
  },

  '/api/rag/workers/document-processing': {
    get: {
      summary: 'Document processing worker status',
      tags: ['Workers'],
      'x-required-permission': 'rag:documents:read',
      responses: { 200: { description: 'Worker status' } },
    },
  },

  '/api/rag/documents': {
    get: {
      summary: 'List documents',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:read',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        {
          name: 'type',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['text', 'image', 'audio', 'document'],
          },
        },
      ],
      responses: { 200: { description: 'Document list' } },
    },
    post: {
      summary: 'Create document',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:write',
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
                title: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Document created' },
        400: { description: 'Unsupported type' },
      },
    },
  },

  '/api/rag/documents/upload': {
    post: {
      summary: 'Upload document file',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:upload',
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Upload accepted' },
      },
    },
  },

  '/api/rag/documents/{id}': {
    get: {
      summary: 'Get document',
      tags: ['Documents'],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: { description: 'Document' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    patch: {
      summary: 'Update document',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:write',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Document updated' } },
    },
    delete: {
      summary: 'Delete document',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:delete',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 204: { description: 'Deleted' } },
    },
  },

  '/api/rag/documents/{id}/status': {
    get: {
      summary: 'Get document processing status',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:read',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Document status' } },
    },
  },

  '/api/rag/documents/{id}/reprocess': {
    post: {
      summary: 'Reprocess document',
      tags: ['Documents'],
      'x-required-permission': 'rag:documents:write',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 202: { description: 'Reprocess queued' } },
    },
  },

  '/api/rag/documents/{id}/send-to-training': {
    post: {
      summary: 'Send document to training',
      tags: ['Documents', 'Training'],
      'x-required-permission': 'training:training_data:write',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Document sent to training' } },
    },
  },

  '/api/rag/search': {
    post: {
      summary: 'Semantic search',
      description: 'Run semantic retrieval using pgvector.',
      tags: ['Search'],
      'x-required-permission': 'rag:documents:read',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 10 },
                threshold: { type: 'number', default: 0.7 },
                filter: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Search results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        content: { type: 'string' },
                        similarity: { type: 'number' },
                        metadata: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  '/api/rag/context': {
    post: {
      summary: 'Build RAG context',
      tags: ['Search'],
      'x-required-permission': 'rag:documents:read',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                conversationId: { type: 'string' },
                namespaceId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Context response' } },
    },
  },

  '/api/rag/search/multimodal': {
    post: {
      summary: 'Multimodal search',
      tags: ['Search'],
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                image: { type: 'string', format: 'binary' },
                limit: { type: 'integer' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Results' } },
    },
  },

  '/api/rag/chunks': {
    get: {
      summary: 'List chunks',
      tags: ['Chunks'],
      parameters: [
        {
          name: 'documentId',
          in: 'query',
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Chunk list' } },
    },
  },

  '/api/rag/chunks/{id}': {
    get: {
      summary: 'Get chunk',
      tags: ['Chunks'],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Chunk' } },
    },
  },

  '/api/rag/namespaces/{id}/stats': {
    get: {
      summary: 'Namespace stats',
      tags: ['Namespaces'],
      'x-required-permission': 'rag:namespaces:read',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Namespace stats' } },
    },
  },

  '/api/rag/web-search': {
    post: {
      summary: 'Web search via SearXNG',
      tags: ['Search'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 5 },
                mode: { type: 'string', enum: ['web', 'deepweb'] },
                engines: { type: 'array', items: { type: 'string' } },
                categories: { type: 'string' },
                language: { type: 'string' },
                safesearch: { type: 'string' },
                timeRange: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Web results' },
        503: { description: 'Web search not configured' },
      },
    },
  },

  '/api/rag/web-search/images': {
    post: {
      summary: 'Image search via SearXNG',
      tags: ['Search'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 5 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Image search results' },
        503: { description: 'Web search not configured' },
      },
    },
  },

  '/api/rag/classify': {
    post: {
      summary: 'Classify query (internal/web/hybrid)',
      tags: ['Search'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Query classification' } },
    },
  },

  '/api/rag/agentic': {
    post: {
      summary: 'Agentic search (internal + web/deep web)',
      tags: ['Search'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                namespaceId: { type: 'string' },
                limit: { type: 'integer', default: 5 },
                threshold: { type: 'number', default: 0.6 },
                forceMode: { type: 'string', enum: ['internal', 'web', 'hybrid'] },
                webMode: { type: 'string', enum: ['web', 'deepweb'] },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Agentic context response' } },
    },
  },

  '/api/rag/agentic/status': {
    get: {
      summary: 'Agentic status (circuit breakers)',
      tags: ['Search'],
      responses: { 200: { description: 'Agentic status' } },
    },
  },

  '/api/rag/embeddings': {
    post: {
      summary: 'Generate embedding',
      tags: ['Embeddings'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['text'],
              properties: {
                text: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Embedding response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  embedding: {
                    type: 'array',
                    items: { type: 'number' },
                  },
                  dimensions: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },

  '/api/rag/stats': {
    get: {
      summary: 'Service stats',
      tags: ['Health'],
      responses: {
        200: {
          description: 'Stats',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  totalDocuments: { type: 'integer' },
                  totalChunks: { type: 'integer' },
                  storageUsed: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },

  '/api/rag/reindex': {
    post: {
      summary: 'Reindex document',
      tags: ['Documents'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['documentId'],
              properties: {
                documentId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 202: { description: 'Started' } },
    },
  },

  '/api/media/uploads/{id}/send-to-training': {
    post: {
      summary: 'Send media upload to training',
      tags: ['Media', 'Training'],
      'x-required-permission': 'training:training_data:write',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: 'Media sent to training' } },
    },
  },
};

export const ragServiceSchemas = {};

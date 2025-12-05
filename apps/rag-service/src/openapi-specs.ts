/**
 * Alice Enterprise Platform - RAG Service OpenAPI Specs
 * 
 * Documentação OpenAPI 3.0 para o serviço RAG.
 * 
 * Author: Fillipe Guerra
 * Data: 05/12/2025
 */

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check básico
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Serviço saudável
 */

/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Readiness check
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Serviço pronto
 */

/**
 * @openapi
 * /api/rag/documents:
 *   get:
 *     summary: Listar documentos
 *     tags: [Documents]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *       - name: type
 *         in: query
 *         schema:
 *           type: string
 *           enum: [text, image, audio, video, document]
 *     responses:
 *       200:
 *         description: Lista de documentos
 *   post:
 *     summary: Upload de documento
 *     tags: [Documents]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               title:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Documento criado
 *       400:
 *         description: Tipo de arquivo não suportado
 */

/**
 * @openapi
 * /api/rag/documents/{id}:
 *   get:
 *     summary: Buscar documento
 *     tags: [Documents]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dados do documento
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Remover documento
 *     tags: [Documents]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Documento removido
 */

/**
 * @openapi
 * /api/rag/search:
 *   post:
 *     summary: Busca semântica
 *     description: Realiza busca semântica usando pgvector.
 *     tags: [Search]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query]
 *             properties:
 *               query:
 *                 type: string
 *                 description: Texto para busca
 *               limit:
 *                 type: integer
 *                 default: 10
 *               threshold:
 *                 type: number
 *                 description: Similaridade mínima (0-1)
 *                 default: 0.7
 *               filter:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                   tags:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: Resultados da busca
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       content:
 *                         type: string
 *                       similarity:
 *                         type: number
 *                       metadata:
 *                         type: object
 */

/**
 * @openapi
 * /api/rag/search/multimodal:
 *   post:
 *     summary: Busca multimodal (texto + imagem)
 *     tags: [Search]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *               limit:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Resultados multimodais
 */

/**
 * @openapi
 * /api/rag/chunks:
 *   get:
 *     summary: Listar chunks
 *     tags: [Chunks]
 *     parameters:
 *       - name: documentId
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de chunks
 */

/**
 * @openapi
 * /api/rag/chunks/{id}:
 *   get:
 *     summary: Buscar chunk
 *     tags: [Chunks]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dados do chunk
 */

/**
 * @openapi
 * /api/rag/embeddings:
 *   post:
 *     summary: Gerar embedding
 *     tags: [Embeddings]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Embedding gerado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 embedding:
 *                   type: array
 *                   items:
 *                     type: number
 *                 dimensions:
 *                   type: integer
 */

/**
 * @openapi
 * /api/rag/embeddings/image:
 *   post:
 *     summary: Gerar CLIP embedding para imagem
 *     tags: [Embeddings]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: CLIP embedding (768 dim)
 */

/**
 * @openapi
 * /api/rag/stats:
 *   get:
 *     summary: Estatísticas do RAG
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Estatísticas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalDocuments:
 *                   type: integer
 *                 totalChunks:
 *                   type: integer
 *                 storageUsed:
 *                   type: string
 */

/**
 * @openapi
 * /api/rag/reindex:
 *   post:
 *     summary: Reindexar documento
 *     tags: [Documents]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documentId]
 *             properties:
 *               documentId:
 *                 type: string
 *     responses:
 *       202:
 *         description: Reindexação iniciada
 */

/**
 * @openapi
 * /metrics:
 *   get:
 *     summary: Métricas Prometheus
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Métricas
 */

export {};

/**
 * Alice Enterprise Platform - Training Service OpenAPI Specs
 * 
 * Documentação OpenAPI 3.0 para o serviço de treinamento.
 * 
 * Author: Fillipe Guerra
 * Data: 05/12/2025
 */

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
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
 * /api/training/jobs:
 *   get:
 *     summary: Listar jobs de treinamento
 *     tags: [Training Jobs]
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, failed, cancelled]
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TrainingJob'
 *
 * components:
 *   schemas:
 *     TrainingJob:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, running, completed, failed, cancelled]
 *         type:
 *           type: string
 *           enum: [lora, full]
 *         progress:
 *           type: number
 *         startedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *   post:
 *     summary: Criar job de treinamento
 *     tags: [Training Jobs]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [datasetId, type]
 *             properties:
 *               datasetId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [lora, full]
 *                 default: lora
 *               hyperparameters:
 *                 type: object
 *                 properties:
 *                   learningRate:
 *                     type: number
 *                   epochs:
 *                     type: integer
 *                   batchSize:
 *                     type: integer
 *     responses:
 *       201:
 *         description: Job criado
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */

/**
 * @openapi
 * /api/training/jobs/{id}:
 *   get:
 *     summary: Buscar job
 *     tags: [Training Jobs]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dados do job
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Cancelar job
 *     tags: [Training Jobs]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Job cancelado
 */

/**
 * @openapi
 * /api/training/datasets:
 *   get:
 *     summary: Listar datasets
 *     tags: [Datasets]
 *     responses:
 *       200:
 *         description: Lista de datasets
 *   post:
 *     summary: Criar dataset
 *     tags: [Datasets]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Dataset criado
 */

/**
 * @openapi
 * /api/training/datasets/{id}:
 *   get:
 *     summary: Buscar dataset
 *     tags: [Datasets]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dados do dataset
 *   delete:
 *     summary: Remover dataset
 *     tags: [Datasets]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Dataset removido
 */

/**
 * @openapi
 * /api/training/datasets/{id}/examples:
 *   post:
 *     summary: Adicionar exemplo ao dataset
 *     tags: [Datasets]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [input, output]
 *             properties:
 *               input:
 *                 type: string
 *               output:
 *                 type: string
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *     responses:
 *       201:
 *         description: Exemplo adicionado
 */

/**
 * @openapi
 * /api/training/datasets/{id}/export:
 *   get:
 *     summary: Exportar dataset em JSONL
 *     tags: [Datasets]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Arquivo JSONL
 *         content:
 *           application/jsonl:
 *             schema:
 *               type: string
 */

/**
 * @openapi
 * /api/training/models:
 *   get:
 *     summary: Listar versões de modelos
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: Lista de modelos
 */

/**
 * @openapi
 * /api/training/models/{id}/activate:
 *   post:
 *     summary: Ativar versão do modelo
 *     tags: [Models]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Modelo ativado
 */

/**
 * @openapi
 * /api/training/auto-learning/status:
 *   get:
 *     summary: Status do auto-learning
 *     tags: [Auto-Learning]
 *     responses:
 *       200:
 *         description: Status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 nextScheduledRun:
 *                   type: string
 *                   format: date-time
 *                 lastRun:
 *                   type: string
 *                   format: date-time
 *                 examplesCollected:
 *                   type: integer
 */

/**
 * @openapi
 * /api/training/auto-learning/trigger:
 *   post:
 *     summary: Disparar ciclo de auto-learning
 *     tags: [Auto-Learning]
 *     responses:
 *       202:
 *         description: Ciclo iniciado
 */

/**
 * @openapi
 * /api/training/stats:
 *   get:
 *     summary: Estatísticas de treinamento
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Estatísticas
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

import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { desc, eq, sql, schema, type Database } from '@alice/database';
import {
  requireAuth,
  requirePermission,
  requireSameTenant,
  getCorrelationId,
  deletePointsByFilter,
  TEXT_COLLECTION_NAME,
  isQdrantConfigured,
} from '@alice/shared-utils';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  enqueueDocumentProcessingJob,
} from './document-processing-queue.js';

const documentsQuerySchema = z.object({
  namespaceId: z.string().uuid().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

const getTenantIdFromRequest = (req: Request): string | undefined => req.tenantId;

function getRequestCorrelationId(req: Request): string {
  const header = req.headers['x-correlation-id'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  const contextCorrelationId = getCorrelationId();
  if (contextCorrelationId !== 'no-context') {
    return contextCorrelationId;
  }
  return crypto.randomUUID();
}

interface RegisterRagDocumentRoutesParams {
  app: Express;
  db: Database;
  logger: Logger;
  parseDocumentProcessingMetadata: (metadata: unknown) => {
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
    processingError: string | null;
    processedAt: string | null;
    chunksCount: number | null;
  };
  invalidateRagCachesForTenant: (tenantId: string) => Promise<void>;
}

export function registerRagDocumentRoutes(params: RegisterRagDocumentRoutesParams): void {
  const {
    app,
    db,
    logger,
    parseDocumentProcessingMetadata,
    invalidateRagCachesForTenant,
  } = params;

  app.get('/api/rag/documents', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;

    const correlationId = getRequestCorrelationId(req);
    const queryResult = documentsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }
    const { namespaceId } = queryResult.data;

    try {
      const documents = await db.query.documents.findMany({
        with: { namespace: true },
        where: namespaceId ? eq(schema.documents.namespaceId, namespaceId) : undefined,
        orderBy: [desc(schema.documents.criadoEm)],
        limit: 100,
      });

      const tenantDocuments = documents.filter(doc =>
        doc.namespace?.tenantId === tenantId
      );

      res.json({ documents: tenantDocuments });
    } catch (error) {
      logger.error({ error, tenantId, namespaceId, correlationId }, 'Falha ao buscar documentos');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/rag/documents/:id/status', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const idValidation = z.object({ id: z.string().uuid('ID inválido') }).safeParse(req.params);
    if (!idValidation.success) {
      return res.status(400).json({ error: 'ID inválido', details: idValidation.error.format() });
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    try {
      const document = await db.query.documents.findFirst({
        where: eq(schema.documents.id, idValidation.data.id),
        with: { namespace: true },
      });

      if (!document || !document.namespace || document.namespace.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Documento não encontrado para este tenant' });
      }

      const metadataState = parseDocumentProcessingMetadata(document.metadata);
      const processingStatus = document.processado
        ? 'completed'
        : metadataState.processingStatus;

      return res.json({
        processado: document.processado,
        processingStatus,
        processingError: metadataState.processingError,
        processedAt: metadataState.processedAt,
        chunksCount: metadataState.chunksCount,
        sentToTrainingAt: document.sentToTrainingAt,
      });
    } catch (error) {
      logger.error({ error, documentId: req.params.id, tenantId, correlationId: getRequestCorrelationId(req) }, 'Falha ao consultar status do documento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.post('/api/rag/documents/:id/reprocess', requireAuth(), requirePermission('rag:documents:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const idValidation = z.object({ id: z.string().uuid('ID inválido') }).safeParse(req.params);
    if (!idValidation.success) {
      return res.status(400).json({ error: 'ID inválido', details: idValidation.error.format() });
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    try {
      const document = await db.query.documents.findFirst({
        where: eq(schema.documents.id, idValidation.data.id),
        with: { namespace: true },
      });

      if (!document || !document.namespace || document.namespace.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Documento não encontrado para este tenant' });
      }
      if (!document.conteudo || document.conteudo.trim().length === 0) {
        return res.status(422).json({ error: 'Documento sem conteúdo para reprocessamento' });
      }

      const correlationId = getRequestCorrelationId(req);
      const metadataBase = typeof document.metadata === 'object' && document.metadata !== null
        ? document.metadata as Record<string, unknown>
        : {};

      await db
        .update(schema.documents)
        .set({
          processado: false,
          metadata: {
            ...metadataBase,
            processingStatus: 'pending',
            processingError: null,
            reprocessRequestedAt: new Date().toISOString(),
            correlationId,
          },
          atualizadoEm: new Date(),
        })
        .where(eq(schema.documents.id, document.id));

      const jobId = await enqueueDocumentProcessingJob(
        {
          jobId: crypto.randomUUID(),
          tenantId,
          documentId: document.id,
          namespaceId: document.namespaceId || document.namespace.id,
          priority: 5,
          correlationId,
          attempts: 0,
        },
        { force: true }
      );

      return res.json({ jobId });
    } catch (error) {
      logger.error({ error, documentId: req.params.id, tenantId, correlationId: getRequestCorrelationId(req) }, 'Falha ao solicitar reprocessamento do documento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.delete('/api/rag/documents/:id', requireAuth(), requirePermission('rag:documents:delete'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
    }
    const { id } = paramsResult.data;

    const tenantId = req.tenantId;
    const correlationId = getRequestCorrelationId(req);

    try {
      const document = await db.query.documents.findFirst({
        with: { namespace: true },
        where: eq(schema.documents.id, id),
      });

      if (!document || document.namespace?.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Documento não encontrado ou acesso negado' });
      }

      if (isQdrantConfigured()) {
        try {
          await deletePointsByFilter(TEXT_COLLECTION_NAME, {
            must: [
              { key: 'tenantId', match: { value: tenantId } },
              { key: 'documentId', match: { value: id } },
              { key: 'type', match: { value: 'document_chunk' } },
            ],
          });
        } catch (qdrantError) {
          logger.error(
            {
              error: qdrantError,
              tenantId,
              documentId: id,
              correlationId,
            },
            'Falha ao excluir embeddings do documento no Qdrant'
          );
          return res.status(502).json({ error: 'Falha ao excluir embeddings do documento' });
        }
      }

      await db.delete(schema.documentChunks)
        .where(eq(schema.documentChunks.documentId, id));

      await db.delete(schema.documents)
        .where(eq(schema.documents.id, id));

      if (tenantId) {
        await invalidateRagCachesForTenant(tenantId);
      }

      logger.info({ documentId: id, tenantId, correlationId }, 'Documento excluído');
      res.json({ success: true });
    } catch (error) {
      logger.error({ error, documentId: id, tenantId, correlationId }, 'Falha ao excluir documento');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/rag/namespaces/:id/stats', requirePermission('rag:namespaces:read'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
    }
    const { id } = paramsResult.data;

    try {
      const documents = await db.query.documents.findMany({
        where: eq(schema.documents.namespaceId, id),
      });

      const totalDocuments = documents.length;
      const processedDocuments = documents.filter(d => d.processado).length;

      const chunks = await db.select({ count: sql<number>`count(*)` })
        .from(schema.documentChunks)
        .innerJoin(schema.documents, eq(schema.documentChunks.documentId, schema.documents.id))
        .where(eq(schema.documents.namespaceId, id));

      res.json({
        totalDocuments,
        processedDocuments,
        totalChunks: chunks[0]?.count || 0,
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter estatísticas');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });
}

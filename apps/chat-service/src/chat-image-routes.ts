import type { Express, Request, RequestHandler, Response } from 'express';
import { and, desc, eq, getDatabase, schema } from '@alice/database';
import {
  ResourceAccessError,
  assertAuthorizedResourceAccess,
  filterAccessibleResources,
  type Role,
} from '@alice/shared-utils';
import { z } from 'zod';

interface ChatImageRoutesLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

type ImageGenerationInput = {
  tenantId: string;
  userId: string;
  prompt: string;
  negativePrompt?: string | null;
  width?: number;
  height?: number;
  conversationId?: string | null;
  messageId?: string | null;
  internalHeaders?: Record<string, string>;
};

interface RegisterChatImageRoutesParams {
  app: Express;
  logger: ChatImageRoutesLogger;
  openAiApiKey?: string;
  getTenantIdFromRequest: (req: Request) => string | undefined;
  requireAuth: () => RequestHandler;
  requireSameTenant: (tenantResolver: (req: Request) => string | undefined) => RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  buildInternalServiceHeaders: (params: {
    userId: string;
    tenantId: string;
    role: Role;
    customRoleId?: string | null;
  }) => Record<string, string>;
  generateImageFromPrompt: (input: ImageGenerationInput) => Promise<unknown>;
}

const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
});

const imageGenerationSchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    negativePrompt: z.string().max(1000).optional(),
    width: z.number().int().min(1024).max(1536).default(1024),
    height: z.number().int().min(1024).max(1536).default(1024),
  })
  .superRefine((value, ctx) => {
    const size = `${value.width}x${value.height}`;
    const allowed = new Set(['1024x1024', '1536x1024', '1024x1536']);
    if (!allowed.has(size)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tamanho inválido. Use 1024x1024, 1536x1024 ou 1024x1536.',
        path: ['width'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tamanho inválido. Use 1024x1024, 1536x1024 ou 1024x1536.',
        path: ['height'],
      });
    }
  });

const imageScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
});

const imageApproveSchema = z.object({
  approved: z.boolean(),
});

const generatedImagesQuerySchema = z.object({
  status: z.enum(['pending', 'generating', 'completed', 'failed', 'all']).optional().default('all'),
  approved: z.enum(['true', 'false', 'pending', 'all']).optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit deve ser numérico')
    .optional()
    .default('20')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100'),
  offset: z
    .string()
    .regex(/^\d+$/, 'offset deve ser numérico')
    .optional()
    .default('0')
    .transform(Number)
    .refine((n) => n >= 0, 'offset deve ser >= 0'),
});

type GalleryImageSource = 'generated' | 'upload';

type GalleryImage = {
  id: string;
  source: GalleryImageSource;
  tenantId: string | null;
  conversationId: string | null;
  messageId: string | null;
  createdBy: string | null;
  prompt: string;
  negativePrompt: string | null;
  model: string | null;
  mimeType: string | null;
  steps: number | null;
  seed: number | null;
  width: number | null;
  height: number | null;
  guidanceScale: number | null;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  imagePath: string | null;
  thumbnailPath: string | null;
  imageUrl: string | null;
  feedbackScore: number | null;
  approvedForTraining: boolean | null;
  usedInFineTuning: boolean | null;
  generationTimeMs: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  criadoEm: Date | string | null;
};

function mapUploadStatus(status: string | null | undefined): GalleryImage['status'] {
  switch (status) {
    case 'processing':
      return 'generating';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}

function resolveUploadMetadata(upload: typeof schema.mediaUploads.$inferSelect): Record<string, unknown> | null {
  return (upload.extractedMetadata as Record<string, unknown> | null) ?? null;
}

function resolveUploadPrompt(upload: typeof schema.mediaUploads.$inferSelect): string {
  const metadata = resolveUploadMetadata(upload);
  const description = metadata?.description;
  if (typeof description === 'string' && description.trim().length > 0) {
    return description.trim();
  }
  if (upload.llmDescription && upload.llmDescription.trim().length > 0) {
    return upload.llmDescription.trim();
  }
  return upload.originalFilename;
}

function resolveUploadThumbnail(upload: typeof schema.mediaUploads.$inferSelect): string | null {
  const metadata = resolveUploadMetadata(upload);
  const thumbnailUrl = metadata?.thumbnailUrl;
  if (typeof thumbnailUrl === 'string' && thumbnailUrl.trim().length > 0) {
    return thumbnailUrl;
  }
  const thumbnailPath = metadata?.thumbnailPath;
  if (typeof thumbnailPath === 'string' && thumbnailPath.trim().length > 0) {
    return thumbnailPath;
  }
  return upload.thumbnailPath ?? null;
}

function normalizeGeneratedImage(image: typeof schema.generatedImages.$inferSelect): GalleryImage {
  const metadata = (image.metadata as Record<string, unknown> | null) ?? null;
  const metadataMimeType = metadata?.mimeType;
  return {
    id: image.id,
    source: 'generated',
    tenantId: image.tenantId ?? null,
    conversationId: image.conversationId ?? null,
    messageId: image.messageId ?? null,
    createdBy: image.createdBy ?? null,
    prompt: image.prompt,
    negativePrompt: image.negativePrompt ?? null,
    model: image.model ?? null,
    mimeType:
      typeof metadataMimeType === 'string' && metadataMimeType.trim().length > 0 ? metadataMimeType.trim() : null,
    steps: image.steps ?? null,
    seed: image.seed ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    guidanceScale: image.guidanceScale ?? null,
    status: image.status ?? 'pending',
    imagePath: image.imagePath ?? null,
    thumbnailPath: image.thumbnailPath ?? null,
    imageUrl: image.imageUrl ?? null,
    feedbackScore: image.feedbackScore ?? null,
    approvedForTraining: image.approvedForTraining ?? null,
    usedInFineTuning: image.usedInFineTuning ?? null,
    generationTimeMs: image.generationTimeMs ?? null,
    errorMessage: image.errorMessage ?? null,
    metadata,
    criadoEm: image.criadoEm ?? null,
  };
}

function normalizeUploadImage(upload: typeof schema.mediaUploads.$inferSelect): GalleryImage {
  const metadata = resolveUploadMetadata(upload);
  const model = metadata?.visionModel;
  return {
    id: upload.id,
    source: 'upload',
    tenantId: upload.tenantId ?? null,
    conversationId: upload.conversationId ?? null,
    messageId: upload.messageId ?? null,
    createdBy: upload.userId ?? null,
    prompt: resolveUploadPrompt(upload),
    negativePrompt: null,
    model: typeof model === 'string' && model.trim().length > 0 ? model.trim() : null,
    mimeType: upload.mimeType ?? null,
    steps: null,
    seed: null,
    width: upload.width ?? null,
    height: upload.height ?? null,
    guidanceScale: null,
    status: mapUploadStatus(upload.processingStatus ?? null),
    imagePath: upload.filePath ?? null,
    thumbnailPath: resolveUploadThumbnail(upload),
    imageUrl: upload.fileUrl ?? null,
    feedbackScore: null,
    approvedForTraining: null,
    usedInFineTuning: upload.usedInFineTuning ?? null,
    generationTimeMs: upload.processingTimeMs ?? null,
    errorMessage: upload.processingError ?? null,
    metadata,
    criadoEm: upload.criadoEm ?? null,
  };
}

function applyGalleryFilters(images: GalleryImage[], query: z.infer<typeof generatedImagesQuerySchema>): GalleryImage[] {
  let filtered = images;
  if (query.status && query.status !== 'all') {
    filtered = filtered.filter((image) => image.status === query.status);
  }
  if (query.approved === 'true') {
    filtered = filtered.filter((image) => image.approvedForTraining === true);
  } else if (query.approved === 'false') {
    filtered = filtered.filter((image) => image.approvedForTraining === false);
  } else if (query.approved === 'pending') {
    filtered = filtered.filter((image) => image.approvedForTraining === null);
  }
  return filtered;
}

export function registerChatImageRoutes(params: RegisterChatImageRoutesParams): void {
  const {
    app,
    logger,
    openAiApiKey,
    getTenantIdFromRequest,
    requireAuth,
    requireSameTenant,
    requirePermission,
    buildInternalServiceHeaders,
    generateImageFromPrompt,
  } = params;

  const db = getDatabase();

  app.post(
    '/api/chat/images/generate',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:generate:write'),
    async (req: Request, res: Response) => {
      const tenantId = req.tenantId;
      const userId = req.user?.userId;

      if (!tenantId || !userId) {
        return res.status(401).json({ error: 'Autenticação necessária' });
      }

      const parseResult = imageGenerationSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/chat/images/generate');
        return res.status(400).json({ error: 'Input inválido' });
      }

      if (!openAiApiKey) {
        return res.status(503).json({ error: 'OpenAI não configurado', code: 'OPENAI_NOT_CONFIGURED' });
      }

      const { prompt, negativePrompt, width, height } = parseResult.data;
      const internalHeaders = buildInternalServiceHeaders({
        userId,
        tenantId,
        role: req.user?.role ?? 'guest',
      });

      try {
        const image = await generateImageFromPrompt({
          tenantId,
          userId,
          prompt,
          negativePrompt,
          width,
          height,
          internalHeaders,
        });
        return res.json({ image });
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar imagem via OpenAI');
        return res
          .status(502)
          .json({ error: 'Falha ao gerar imagem', details: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
    },
  );

  app.post(
    '/api/chat/images/:id/rate',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:generate:write'),
    async (req: Request, res: Response) => {
      const paramsResult = uuidParamSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return res.status(400).json({ error: 'ID de imagem inválido', details: paramsResult.error.format() });
      }
      const { id } = paramsResult.data;

      const tenantId = req.tenantId;

      const parseResult = imageScoreSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Input inválido' });
      }
      const { score } = parseResult.data;

      if (!tenantId) {
        return res.status(401).json({ error: 'Autenticação necessária' });
      }

      try {
        await assertAuthorizedResourceAccess({
          actor: {
            ...req.user,
            tenantId,
          },
          resourceType: 'generated_image',
          resourceId: id,
          permission: 'write',
          tenantId,
          db,
        });

        await db.update(schema.generatedImages).set({ feedbackScore: score }).where(eq(schema.generatedImages.id, id));

        logger.info({ imageId: id, score }, 'Feedback de imagem registrado');
        return res.json({ message: 'Feedback registrado com sucesso' });
      } catch (error) {
        if (error instanceof ResourceAccessError) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        logger.error({ error, imageId: id }, 'Erro ao registrar feedback');
        return res.status(500).json({ error: 'Erro ao registrar feedback' });
      }
    },
  );

  app.post(
    '/api/chat/images/:id/approve',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:approve:write'),
    async (req: Request, res: Response) => {
      const paramsResult = uuidParamSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return res.status(400).json({ error: 'ID de imagem inválido', details: paramsResult.error.format() });
      }
      const { id } = paramsResult.data;

      const tenantId = req.tenantId;

      const parseResult = imageApproveSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Input inválido' });
      }
      const { approved } = parseResult.data;

      if (!tenantId) {
        return res.status(401).json({ error: 'Autenticação necessária' });
      }

      try {
        await assertAuthorizedResourceAccess({
          actor: {
            ...req.user,
            tenantId,
          },
          resourceType: 'generated_image',
          resourceId: id,
          permission: 'approve',
          tenantId,
          db,
        });

        await db
          .update(schema.generatedImages)
          .set({ approvedForTraining: approved })
          .where(eq(schema.generatedImages.id, id));

        logger.info({ imageId: id, approved }, 'Status de aprovação para treinamento atualizado');
        return res.json({ message: `Imagem ${approved ? 'aprovada' : 'reprovada'} para treinamento` });
      } catch (error) {
        if (error instanceof ResourceAccessError) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        logger.error({ error, imageId: id }, 'Erro ao aprovar imagem');
        return res.status(500).json({ error: 'Erro ao aprovar imagem' });
      }
    },
  );

  app.get(
    '/api/chat/images/stats',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:generate:read'),
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId;
        if (!tenantId) {
          return res.status(401).json({ error: 'Autenticação necessária' });
        }
        const [generatedImages, mediaUploads] = await Promise.all([
          db.query.generatedImages.findMany({
            where: eq(schema.generatedImages.tenantId, tenantId),
          }),
          db.query.mediaUploads.findMany({
            where: and(eq(schema.mediaUploads.tenantId, tenantId), eq(schema.mediaUploads.mediaType, 'image')),
          }),
        ]);

        const [allowedGeneratedImages, allowedMediaUploads] = await Promise.all([
          filterAccessibleResources({
            actor: {
              ...req.user,
              tenantId,
            },
            tenantId,
            resourceType: 'generated_image',
            permission: 'read',
            resources: generatedImages,
            db,
          }),
          filterAccessibleResources({
            actor: {
              ...req.user,
              tenantId,
            },
            tenantId,
            resourceType: 'media_upload',
            permission: 'read',
            resources: mediaUploads,
            db,
          }),
        ]);

        const galleryImages = [
          ...allowedGeneratedImages.map(normalizeGeneratedImage),
          ...allowedMediaUploads.map(normalizeUploadImage),
        ];

        const completed = galleryImages.filter((img) => img.status === 'completed');
        const pending = galleryImages.filter((img) => img.status === 'pending' || img.status === 'generating');
        const failed = galleryImages.filter((img) => img.status === 'failed');
        const approvedCount = galleryImages.filter((img) => img.approvedForTraining === true).length;
        const usedInFineTuning = galleryImages.filter((img) => img.usedInFineTuning === true).length;

        const ratedImages = galleryImages.filter(
          (img) => typeof img.feedbackScore === 'number' && (img.feedbackScore ?? 0) > 0,
        );
        const avgRating =
          ratedImages.length > 0
            ? ratedImages.reduce((sum, img) => sum + (img.feedbackScore ?? 0), 0) / ratedImages.length
            : 0;

        const durationSamples = completed
          .map((img) => img.generationTimeMs)
          .filter((value): value is number => typeof value === 'number' && value > 0);
        const avgGenerationTime =
          durationSamples.length > 0 ? durationSamples.reduce((sum, value) => sum + value, 0) / durationSamples.length : 0;

        return res.json({
          totalGenerated: generatedImages.length,
          approved: approvedCount,
          pending: pending.length,
          inTraining: usedInFineTuning,
          avgRating: Number(avgRating.toFixed(1)),
          total: galleryImages.length,
          completed: completed.length,
          failed: failed.length,
          approvedForTraining: approvedCount,
          usedInFineTuning,
          averageGenerationTimeMs: Math.round(avgGenerationTime),
          note: 'Geração via OpenAI (gpt-image-1) e uploads multimodais com Vision',
        });
      } catch (error) {
        logger.error({ error }, 'Erro ao buscar estatísticas de imagens');
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }
    },
  );

  app.get(
    '/api/chat/images',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:generate:read'),
    async (req: Request, res: Response) => {
      const tenantId = req.tenantId;

      if (!tenantId) {
        return res.status(401).json({ error: 'Autenticação necessária' });
      }

      const queryResult = generatedImagesQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/chat/images');
        return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
      }

      const { limit: pageLimit, offset: pageOffset } = queryResult.data;

      try {
        const [generatedImages, mediaUploads] = await Promise.all([
          db.query.generatedImages.findMany({
            where: eq(schema.generatedImages.tenantId, tenantId),
            orderBy: [desc(schema.generatedImages.criadoEm)],
            with: {
              conversation: true,
            },
          }),
          db.query.mediaUploads.findMany({
            where: and(eq(schema.mediaUploads.tenantId, tenantId), eq(schema.mediaUploads.mediaType, 'image')),
            orderBy: [desc(schema.mediaUploads.criadoEm)],
          }),
        ]);

        const [allowedGeneratedImages, allowedMediaUploads] = await Promise.all([
          filterAccessibleResources({
            actor: {
              ...req.user,
              tenantId,
            },
            tenantId,
            resourceType: 'generated_image',
            permission: 'read',
            resources: generatedImages,
            db,
          }),
          filterAccessibleResources({
            actor: {
              ...req.user,
              tenantId,
            },
            tenantId,
            resourceType: 'media_upload',
            permission: 'read',
            resources: mediaUploads,
            db,
          }),
        ]);

        const normalizedGenerated = allowedGeneratedImages.map(normalizeGeneratedImage);
        const normalizedUploads = allowedMediaUploads.map(normalizeUploadImage);

        const filteredImages = applyGalleryFilters([...normalizedGenerated, ...normalizedUploads], queryResult.data);

        const sorted = filteredImages.sort((a, b) => {
          const aTime = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
          const bTime = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
          return bTime - aTime;
        });

        const total = sorted.length;
        const images = sorted.slice(pageOffset, pageOffset + pageLimit);

        return res.json({
          images,
          total,
          offset: pageOffset,
          limit: pageLimit,
        });
      } catch (error) {
        logger.error({ error }, 'Erro ao listar imagens');
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }
    },
  );

  app.get(
    '/api/chat/images/:id',
    requireAuth(),
    requireSameTenant(getTenantIdFromRequest),
    requirePermission('images:generate:read'),
    async (req: Request, res: Response) => {
      const paramsResult = uuidParamSchema.safeParse(req.params);
      if (!paramsResult.success) {
        logger.warn({ errors: paramsResult.error.flatten() }, 'ID inválido em /api/chat/images/:id');
        return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
      }
      const { id } = paramsResult.data;

      const tenantId = req.tenantId;

      if (!tenantId) {
        return res.status(401).json({ error: 'Autenticação necessária' });
      }

      try {
        await assertAuthorizedResourceAccess({
          actor: {
            ...req.user,
            tenantId,
          },
          resourceType: 'generated_image',
          resourceId: id,
          permission: 'read',
          tenantId,
          db,
        });

        const image = await db.query.generatedImages.findFirst({
          where: eq(schema.generatedImages.id, id),
          with: {
            conversation: true,
          },
        });

        if (!image) {
          return res.status(404).json({ error: 'Imagem não encontrada' });
        }

        if (image.tenantId !== tenantId) {
          logger.warn({ imageId: id, requestedBy: tenantId, ownedBy: image.tenantId }, 'Tentativa de acesso a imagem de outro tenant');
          return res.status(404).json({ error: 'Imagem não encontrada' });
        }

        return res.json({ image });
      } catch (error) {
        if (error instanceof ResourceAccessError) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        logger.error({ error, imageId: id }, 'Erro ao buscar imagem');
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }
    },
  );
}

import pLimit from 'p-limit';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
import { mediaJobs } from '@alice/database';
import { eq, and, asc, sql } from '@alice/database';
import { getStorageService } from '../storage.js';
import ytdl from 'ytdl-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffprobePath from 'ffprobe-static';
import { createSaladMediaClient } from '../salad-media-client.js';
import { metrics } from '@alice/shared-utils';

const pipeline = promisify(require('stream').pipeline);
ffmpeg.setFfprobePath(ffprobePath.path);

const logger = createLogger('media-worker');
const storageService = getStorageService();

interface MediaWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
}

const SALAD_TTS_IMAGE = process.env.SALAD_TTS_IMAGE;
const SALAD_TALKING_HEAD_IMAGE = process.env.SALAD_TALKING_HEAD_IMAGE;
const SALAD_LIP_SYNC_IMAGE = process.env.SALAD_LIP_SYNC_IMAGE;
const SALAD_LONG_VIDEO_IMAGE = process.env.SALAD_LONG_VIDEO_IMAGE;
const SALAD_GPU_CLASS = (process.env.SALAD_GPU_CLASS || 'premium-gpu').split(',').map((c) => c.trim()).filter(Boolean);

export function startMediaWorker(db: Database, config: MediaWorkerConfig) {
  const limit = pLimit(config.concurrency);
  const saladClient = createSaladMediaClient(logger, metrics);

  async function fetchNextJob() {
    const [row] = await db
      .select()
      .from(mediaJobs)
      .where(
        and(
          eq(mediaJobs.tenantId, config.tenantId),
          eq(mediaJobs.status, 'pending'),
          sql`(${mediaJobs.agendadoPara} IS NULL OR ${mediaJobs.agendadoPara} <= NOW())`
        )
      )
      .orderBy(
        asc(mediaJobs.prioridade),
        sql`${mediaJobs.agendadoPara} NULLS FIRST`,
        asc(mediaJobs.criadoEm)
      )
      .limit(1)
      .for('update', { skipLocked: true });

    return row || null;
  }

  async function markStatus(id: string, status: 'processing' | 'completed' | 'failed', erro?: string | null, attemptsOverride?: number) {
    const setData: Record<string, unknown> = {
      status,
      erro: erro ?? null,
    };

    if (status === 'processing') {
      setData.tentativas = sql`${mediaJobs.tentativas} + 1`;
      setData.iniciadoEm = sql`NOW()`;
    } else if (status === 'completed' || status === 'failed') {
      if (attemptsOverride !== undefined) {
        setData.tentativas = attemptsOverride;
      }
      setData.finalizadoEm = sql`NOW()`;
    } else {
      // pending ou outros: preserva tentativas/iniciadoEm/finalizadoEm
      if (attemptsOverride !== undefined) {
        setData.tentativas = attemptsOverride;
      }
    }

    await db
      .update(mediaJobs)
      .set(setData)
      .where(eq(mediaJobs.id, id));
  }

  async function processLoop() {
    try {
      const job = await fetchNextJob();
      if (!job) return;

      await limit(async () => {
        await markStatus(job.id, 'processing');
        try {
          const deps = { db, saladClient, storageService, markStatus, config };
          await handleJob(deps, job);
        } catch (error) {
          // Recupera tentativas atualizadas após o incremento em 'processing'
          const fresh = await db
            .select({ tentativas: mediaJobs.tentativas, maxTentativas: mediaJobs.maxTentativas })
            .from(mediaJobs)
            .where(eq(mediaJobs.id, job.id))
            .limit(1);
          const attempts = fresh[0]?.tentativas ?? job.tentativas ?? 0;
          const maxAttempts = fresh[0]?.maxTentativas ?? config.maxAttempts;
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await markStatus(job.id, status, (error as Error).message, attempts);
        }
      });
    } catch (error) {
      logger.error({ error }, 'Erro no loop do media-worker');
    }
  }

  setInterval(processLoop, config.pollIntervalMs).unref();
  logger.info({ tenantId: config.tenantId, pollIntervalMs: config.pollIntervalMs }, 'Media worker iniciado');
}

function isYoutubeUrl(url: string) {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

type WorkerDeps = {
  db: Database;
  saladClient: ReturnType<typeof createSaladMediaClient>;
  storageService: ReturnType<typeof getStorageService>;
  markStatus: (id: string, status: 'processing' | 'completed' | 'failed', erro?: string | null, attemptsOverride?: number) => Promise<void>;
  config: MediaWorkerConfig;
};

async function handleJob(deps: WorkerDeps, job: any) {
  switch (job.jobType) {
    case 'tts':
      await dispatchSalad(deps, job, SALAD_TTS_IMAGE, { text: job.parametros?.text, voice: job.parametros?.voice });
      return;
    case 'talking_head':
      await dispatchSalad(deps, job, SALAD_TALKING_HEAD_IMAGE, { inputUrl: job.inputUrl, parametros: job.parametros });
      return;
    case 'lip_sync':
      await dispatchSalad(deps, job, SALAD_LIP_SYNC_IMAGE, { inputUrl: job.inputUrl, parametros: job.parametros });
      return;
    case 'long_video':
      await handleLongVideo(deps, job);
      return;
    default:
      throw new Error(`Tipo de job não suportado: ${job.jobType}`);
  }
}

async function dispatchSalad(deps: WorkerDeps, job: any, image?: string, payload?: Record<string, unknown>) {
  if (!image) {
    throw new Error('Imagem Salad não configurada para o tipo de job');
  }
  const containerName = `media-${job.jobType}-${job.id}`;
  const envVars: Record<string, string> = {
    JOB_ID: job.id,
    TENANT_ID: job.tenantId,
    MEDIA_PARAMS: JSON.stringify(payload ?? {}),
  };

  const result = await deps.saladClient.createAndWait({
    name: containerName,
    image,
    cpu: 2,
    memory: 4096,
    gpuClasses: SALAD_GPU_CLASS,
    environmentVariables: envVars,
  });

  await deps.markStatus(job.id, result.status === 'succeeded' ? 'completed' : 'failed', result.description ?? null);
  await deps.db
    .update(mediaJobs)
    .set({
      resultado: { saladResult: result },
    })
    .where(eq(mediaJobs.id, job.id));
}

async function downloadAndStoreYoutube(deps: WorkerDeps, url: string, tenantId: string) {
  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title || 'youtube-video';
  const safeTitle = title.replace(/[^\w\d-_]+/g, '_').slice(0, 80);
  const filename = `${safeTitle}.mp4`;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alice-yt-'));
  const tmpFile = path.join(tmpDir, filename);

  const videoStream = ytdl.downloadFromInfo(info, { quality: 'highestvideo' });
  await pipeline(videoStream, fs.createWriteStream(tmpFile));

  const metadata = await probeVideo(tmpFile);
  const buffer = await fs.promises.readFile(tmpFile);
  const stored = await deps.storageService.saveFile(buffer, {
    tenantId,
    mediaType: 'video',
    originalFilename: filename,
    mimeType: metadata.mimeType,
  });

  await fs.promises.rm(tmpDir, { recursive: true, force: true });

  return {
    storagePath: stored.filePath,
    storageUrl: stored.fileUrl,
    sizeBytes: stored.fileSize,
    sourceUrl: url,
    durationSeconds: metadata.durationSeconds,
    format: metadata.format,
    videoCodec: metadata.videoCodec,
    audioCodec: metadata.audioCodec,
    width: metadata.width,
    height: metadata.height,
  };
}

async function probeVideo(filePath: string) {
  return new Promise<{
    durationSeconds: number | null;
    formatName: string | undefined;
    mimeType: string;
    videoCodec: string | undefined;
    audioCodec: string | undefined;
    width: number | undefined;
    height: number | undefined;
  }>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const formatName = data.format.format_name;
      const mimeType = guessMime(formatName);
      const durationSeconds = data.format.duration ? Number(data.format.duration) : null;
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      const audioStream = data.streams.find((s) => s.codec_type === 'audio');
      resolve({
        durationSeconds,
        formatName,
        mimeType,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        width: videoStream?.width,
        height: videoStream?.height,
      });
    });
  });
}

function guessMime(formatName?: string): string {
  if (!formatName) return 'application/octet-stream';
  const f = formatName.toLowerCase();
  if (f.includes('mp4')) return 'video/mp4';
  if (f.includes('matroska') || f.includes('mkv')) return 'video/x-matroska';
  if (f.includes('webm')) return 'video/webm';
  if (f.includes('mov')) return 'video/quicktime';
  if (f.includes('mpegts') || f.includes('ts')) return 'video/MP2T';
  return 'application/octet-stream';
}

async function handleLongVideo(deps: WorkerDeps, job: any) {
  if (job.inputUrl && isYoutubeUrl(job.inputUrl)) {
    const download = await downloadAndStoreYoutube(deps, job.inputUrl, job.tenantId);
    // Envia para Salad (long_video) se configurado, passando caminho armazenado
    if (SALAD_LONG_VIDEO_IMAGE) {
      const result = await deps.saladClient.createAndWait({
        name: `media-long-video-${job.id}`,
        image: SALAD_LONG_VIDEO_IMAGE,
        cpu: 4,
        memory: 8192,
        gpuClasses: SALAD_GPU_CLASS,
        environmentVariables: {
          INPUT_URL: download.storageUrl,
          INPUT_PATH: download.storagePath,
          JOB_ID: job.id,
          TENANT_ID: job.tenantId,
          MEDIA_PARAMS: JSON.stringify(job.parametros ?? {}),
        },
      });
      await deps.markStatus(job.id, result.status === 'succeeded' ? 'completed' : 'failed', result.description ?? null);
      await deps.db
        .update(mediaJobs)
        .set({
          resultado: { download, saladResult: result },
        })
        .where(eq(mediaJobs.id, job.id));
      return;
    }
    // Sem Salad configurado, mas download feito: marcar como failed para evitar pendência silenciosa
    await deps.markStatus(job.id, 'failed', 'SALAD_LONG_VIDEO_IMAGE não configurada');
    await deps.db
      .update(mediaJobs)
      .set({
        resultado: { download, error: 'SALAD_LONG_VIDEO_IMAGE não configurada' },
      })
      .where(eq(mediaJobs.id, job.id));
    return;
  }

  throw new Error('Job long_video requer inputUrl YouTube válido');
}

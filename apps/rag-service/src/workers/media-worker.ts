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
  const storageService = getStorageService();

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
    await db
      .update(mediaJobs)
      .set({
        status,
        erro: erro ?? null,
        tentativas: status === 'processing' ? sql`${mediaJobs.tentativas} + 1` : attemptsOverride ?? mediaJobs.tentativas,
        iniciadoEm: status === 'processing' ? sql`NOW()` : mediaJobs.iniciadoEm,
        finalizadoEm: status === 'completed' || status === 'failed' ? sql`NOW()` : mediaJobs.finalizadoEm,
      })
      .where(eq(mediaJobs.id, id));
  }

  async function processLoop() {
    try {
      const job = await fetchNextJob();
      if (!job) return;

      await limit(async () => {
        await markStatus(job.id, 'processing');
        try {
          await handleJob(job);
        } catch (error) {
          const attempts = job.tentativas ?? 0; // já incrementado no status processing
          const status = attempts >= (job.maxTentativas ?? config.maxAttempts) ? 'failed' : 'pending';
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

async function handleJob(job: any) {
  switch (job.jobType) {
    case 'tts':
      await dispatchSalad(job, SALAD_TTS_IMAGE, { text: job.parametros?.text, voice: job.parametros?.voice });
      return;
    case 'talking_head':
      await dispatchSalad(job, SALAD_TALKING_HEAD_IMAGE, { inputUrl: job.inputUrl, parametros: job.parametros });
      return;
    case 'lip_sync':
      await dispatchSalad(job, SALAD_LIP_SYNC_IMAGE, { inputUrl: job.inputUrl, parametros: job.parametros });
      return;
    case 'long_video':
      await handleLongVideo(job);
      return;
    default:
      throw new Error(`Tipo de job não suportado: ${job.jobType}`);
  }
}

async function dispatchSalad(job: any, image?: string, payload?: Record<string, unknown>) {
  if (!image) {
    throw new Error('Imagem Salad não configurada para o tipo de job');
  }
  const containerName = `media-${job.jobType}-${job.id}`;
  const envVars: Record<string, string> = {
    JOB_ID: job.id,
    TENANT_ID: job.tenantId,
    MEDIA_PARAMS: JSON.stringify(payload ?? {}),
  };

  const result = await createSaladMediaClient(logger, metrics).createAndWait({
    name: containerName,
    image,
    cpu: 2,
    memory: 4096,
    gpuClasses: SALAD_GPU_CLASS,
    environmentVariables: envVars,
  });

  await markStatus(job.id, result.status === 'succeeded' ? 'completed' : 'failed', result.description ?? null, job.tentativas);
  await db
    .update(mediaJobs)
    .set({
      resultado: { saladResult: result },
    })
    .where(eq(mediaJobs.id, job.id));
}

async function downloadAndStoreYoutube(url: string, tenantId: string) {
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
  const storageService = getStorageService();
  const stored = await storageService.saveFile(buffer, {
    tenantId,
    mediaType: 'video',
    originalFilename: filename,
    mimeType: metadata.format,
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
    format: string | undefined;
    videoCodec: string | undefined;
    audioCodec: string | undefined;
    width: number | undefined;
    height: number | undefined;
  }>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const format = data.format.format_name;
      const durationSeconds = data.format.duration ? Number(data.format.duration) : null;
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      const audioStream = data.streams.find((s) => s.codec_type === 'audio');
      resolve({
        durationSeconds,
        format,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        width: videoStream?.width,
        height: videoStream?.height,
      });
    });
  });
}

async function handleLongVideo(job: any) {
  if (job.inputUrl && isYoutubeUrl(job.inputUrl)) {
    const download = await downloadAndStoreYoutube(job.inputUrl, job.tenantId);
    // Envia para Salad (long_video) se configurado, passando caminho armazenado
    if (SALAD_LONG_VIDEO_IMAGE) {
      const result = await createSaladMediaClient(logger, metrics).createAndWait({
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
      await markStatus(job.id, result.status === 'succeeded' ? 'completed' : 'failed', result.description ?? null, job.tentativas);
      await db
        .update(mediaJobs)
        .set({
          resultado: { download, saladResult: result },
        })
        .where(eq(mediaJobs.id, job.id));
      return;
    }
    // Sem Salad configurado, mas download feito: marcar como failed para evitar pendência silenciosa
    await markStatus(job.id, 'failed', 'SALAD_LONG_VIDEO_IMAGE não configurada', job.tentativas);
    await db
      .update(mediaJobs)
      .set({
        resultado: { download, error: 'SALAD_LONG_VIDEO_IMAGE não configurada' },
      })
      .where(eq(mediaJobs.id, job.id));
    return;
  }

  throw new Error('Job long_video requer inputUrl YouTube válido');
}습니다. Continue com as proximas etapas. Vou aproveitar que voce nao quis criar staging e pode recriar o banco para te ajudar agora que sei onde esta no Hetzner hehe. A SEguir: Vou rodar e criar staging em produçao e alterar os secrets do github e habilitar pino de debug nos containers. Aceita?** No/Yes?.`|`

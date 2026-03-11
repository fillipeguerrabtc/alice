import type { Server } from 'http';
import type { Logger } from 'pino';
import {
  initializeRedisCache,
  isRedisAvailable,
  closeRedisCacheClient,
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';
import type { GpuServiceType } from './gpu-contracts.js';

export async function startGpuManagerBootstrap(params: {
  logger: Logger;
  server: Server;
  port: number;
  totalVramGb: number;
  vramSafetyMarginGb: number;
  vramRequirements: Record<GpuServiceType, number>;
  admissionThresholds: Record<GpuServiceType, number>;
  getNvidiaSmiStatus: () => 'unknown' | 'available' | 'unavailable';
  resolveOrchestratorAvailability: () => Promise<boolean>;
  orchestrationMode: string;
  setOrchestratorAvailable: (value: boolean) => void;
  startQueueWorker: () => Promise<void>;
  stopQueueWorker: () => void;
  shutdownOrchestrator: () => void;
}): Promise<void> {
  const {
    logger,
    server,
    port,
    totalVramGb,
    vramSafetyMarginGb,
    vramRequirements,
    admissionThresholds,
    getNvidiaSmiStatus,
    resolveOrchestratorAvailability,
    orchestrationMode,
    setOrchestratorAvailable,
    startQueueWorker,
    stopQueueWorker,
    shutdownOrchestrator,
  } = params;

  try {
    logger.info('Inicializando conexão Redis...');
    await initializeRedisCache();

    if (!isRedisAvailable()) {
      throw new Error('Redis não disponível após inicialização');
    }
    logger.info('Redis inicializado com sucesso');

    const alwaysOnBudgetGB = Object.entries(vramRequirements)
      .filter(([key]) => key !== 'training')
      .reduce((sum, [, vram]) => sum + vram, 0);
    logger.info(
      { totalVramGB: totalVramGb, alwaysOnBudgetGB },
      'Arquitetura GPU (Gate 2) - serviços always-on com budgets estimados'
    );

    const orchestratorAvailable = await resolveOrchestratorAvailability();
    setOrchestratorAvailable(orchestratorAvailable);
    if (orchestratorAvailable) {
      logger.info(
        { orchestrationMode },
        'Orquestrador GPU disponivel para ciclo de treino sob demanda'
      );
    } else {
      logger.warn(
        { orchestrationMode },
        'Orquestrador GPU indisponivel; treino requer gpu-trainer ja ativo ou correcao de acesso ao docker.sock'
      );
    }

    await startQueueWorker();

    server.listen(port, () => {
      logger.info({
        port,
        totalVramGB: totalVramGb,
        safetyMarginGB: vramSafetyMarginGb,
        budgets: vramRequirements,
        admissionThresholds,
        nvidiaSmiStatus: getNvidiaSmiStatus(),
      }, 'GPU Manager Service iniciado - coexistência habilitada (LLM+Embeddings+Training)');
    });

    server.timeout = 30000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    registerShutdownCallback('gpu-manager-server', async () => {
      logger.info('Encerrando GPU Manager Service...');
      shutdownOrchestrator();
      stopQueueWorker();
      server.close();
      await closeRedisCacheClient();
      logger.info('Conexão Redis encerrada');
    }, { priority: ShutdownPriority.HTTP_SERVER });
  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar GPU Manager Service');
    process.exit(1);
  }
}

import type { Express, RequestHandler, Router } from 'express';

interface BackupRoutesLogger {
  info: (obj: object | string, msg?: string) => void;
}

interface RegisterObservabilityBackupRoutesParams {
  app: Express;
  logger: BackupRoutesLogger;
  requireObservabilityAdmin: RequestHandler;
  router: Router;
}

export function registerObservabilityBackupRoutes(params: RegisterObservabilityBackupRoutesParams): void {
  const { app, logger, requireObservabilityAdmin, router } = params;
  app.use('/api/backup', requireObservabilityAdmin, router);
  logger.info('Backup Orchestrator registrado em /api/backup');
}

import type { Express } from 'express';
import { registerTrainingPlatformRoutes } from './routes/training-platform-routes.js';
import { registerTrainingAuditRoutes } from './routes/training-audit-routes.js';
import { registerTrainingLoraOrchestratorRoutes } from './routes/training-lora-orchestrator-routes.js';
import { registerTrainingRuntimeRoutes } from './routes/training-runtime-routes.js';
import { registerTrainingRunManagementRoutes } from './routes/training-run-management-routes.js';
import { registerTrainingScheduleRoutes } from './routes/training-schedule-routes.js';
import { registerTrainingDataRoutes } from './routes/training-data-routes.js';
import { registerTrainingJobQueryRoutes } from './routes/training-job-query-routes.js';
import { registerTrainingJobCancelRoutes } from './routes/training-job-cancel-routes.js';
import { registerTrainingJobCreateRoutes } from './routes/training-job-create-routes.js';
import { registerTrainingJobPromotionApprovalRoutes } from './routes/training-job-promotion-approval-routes.js';
import { registerTrainingJobRollbackRoutes } from './routes/training-job-rollback-routes.js';
import { registerTrainingJobPromoteRoutes } from './routes/training-job-promote-routes.js';
import { registerTrainingRunStartRoutes } from './routes/training-run-start-routes.js';
import { registerTrainingDataReviewRoutes } from './routes/training-data-review-routes.js';
import { registerTrainingBulkImportRoutes } from './routes/training-bulk-import-routes.js';
import { registerTrainingWebhookRoutes } from './routes/training-webhook-routes.js';

interface RegisterTrainingRoutesParams {
  platform: Parameters<typeof registerTrainingPlatformRoutes>[1];
  audit: Parameters<typeof registerTrainingAuditRoutes>[1];
  loraOrchestrator: Parameters<typeof registerTrainingLoraOrchestratorRoutes>[1];
  runtime: Parameters<typeof registerTrainingRuntimeRoutes>[1];
  runManagement: Parameters<typeof registerTrainingRunManagementRoutes>[1];
  schedule: Parameters<typeof registerTrainingScheduleRoutes>[1];
  data: Parameters<typeof registerTrainingDataRoutes>[1];
  dataReview: Parameters<typeof registerTrainingDataReviewRoutes>[1];
  bulkImport: Parameters<typeof registerTrainingBulkImportRoutes>[1];
  webhook: Parameters<typeof registerTrainingWebhookRoutes>[1];
  jobQuery: Parameters<typeof registerTrainingJobQueryRoutes>[1];
  jobCreate: Parameters<typeof registerTrainingJobCreateRoutes>[1];
  jobCancel: Parameters<typeof registerTrainingJobCancelRoutes>[1];
  jobPromotionApproval: Parameters<typeof registerTrainingJobPromotionApprovalRoutes>[1];
  jobRollback: Parameters<typeof registerTrainingJobRollbackRoutes>[1];
  jobPromote: Parameters<typeof registerTrainingJobPromoteRoutes>[1];
  runStart: Parameters<typeof registerTrainingRunStartRoutes>[1];
}

export function registerTrainingRoutes(
  app: Express,
  params: RegisterTrainingRoutesParams,
): void {
  registerTrainingPlatformRoutes(app, params.platform);
  registerTrainingAuditRoutes(app, params.audit);
  registerTrainingLoraOrchestratorRoutes(app, params.loraOrchestrator);
  registerTrainingRuntimeRoutes(app, params.runtime);
  registerTrainingRunManagementRoutes(app, params.runManagement);
  registerTrainingScheduleRoutes(app, params.schedule);
  registerTrainingDataRoutes(app, params.data);
  registerTrainingDataReviewRoutes(app, params.dataReview);
  registerTrainingBulkImportRoutes(app, params.bulkImport);
  registerTrainingWebhookRoutes(app, params.webhook);
  registerTrainingJobQueryRoutes(app, params.jobQuery);
  registerTrainingJobCreateRoutes(app, params.jobCreate);
  registerTrainingJobCancelRoutes(app, params.jobCancel);
  registerTrainingJobPromotionApprovalRoutes(app, params.jobPromotionApproval);
  registerTrainingJobRollbackRoutes(app, params.jobRollback);
  registerTrainingJobPromoteRoutes(app, params.jobPromote);
  registerTrainingRunStartRoutes(app, params.runStart);
}

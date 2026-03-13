import { describe, expect, it } from 'vitest';
import {
  getPromotionReasonHuman,
  resolveDemoEligibility,
  resolveDerivedLifecycleStage,
  resolveRealEligibility,
} from '../../../apps/integrations-service/src/trading-signal-promotion-service';

describe('trading signal promotion service helpers', () => {
  it('marca demo eligibility como blocked quando validation não está validated', () => {
    const eligibility = resolveDemoEligibility({
      signalType: 'entry_long',
      validationState: 'pending',
      datasetCandidateId: 'candidate-1',
      datasetCandidateStatus: 'approved',
      datasetVersionId: 'version-1',
      calibrationId: 'calibration-1',
    });

    expect(eligibility.status).toBe('blocked');
    expect(eligibility.reasonCode).toBe('VALIDATION_NOT_VALIDATED');
  });

  it('marca demo eligibility como eligible quando requisitos mínimos estão completos', () => {
    const eligibility = resolveDemoEligibility({
      signalType: 'entry_short',
      validationState: 'validated',
      datasetCandidateId: 'candidate-1',
      datasetCandidateStatus: 'approved',
      datasetVersionId: 'version-1',
      calibrationId: 'calibration-1',
    });

    expect(eligibility.status).toBe('eligible');
    expect(eligibility.reasonCode).toBeNull();
  });

  it('mantém real eligibility pendente até promoção explícita', () => {
    const eligibility = resolveRealEligibility({
      signalType: 'entry_long',
      validationState: 'validated',
      datasetVersionId: 'version-1',
      calibrationId: 'calibration-1',
      realPromotedAt: null,
    });

    expect(eligibility.status).toBe('pending');
    expect(eligibility.reasonCode).toBe('REAL_PROMOTION_REQUIRED');
  });

  it('promove lifecycle para demo_eligible e real_eligible quando timestamps existem', () => {
    const demoStage = resolveDerivedLifecycleStage({
      baseStage: 'candidate_evidence_captured',
      datasetCandidateId: 'candidate-1',
      datasetVersionId: 'version-1',
      calibrationId: 'calibration-1',
      demoPromotedAt: new Date('2026-03-13T00:00:00.000Z'),
      realPromotedAt: null,
    });
    expect(demoStage).toBe('demo_eligible');

    const realStage = resolveDerivedLifecycleStage({
      baseStage: 'candidate_evidence_captured',
      datasetCandidateId: 'candidate-1',
      datasetVersionId: 'version-1',
      calibrationId: 'calibration-1',
      demoPromotedAt: new Date('2026-03-13T00:00:00.000Z'),
      realPromotedAt: new Date('2026-03-13T01:00:00.000Z'),
    });
    expect(realStage).toBe('real_eligible');
  });

  it('expõe reason human legível para auditoria de lineage', () => {
    expect(getPromotionReasonHuman('DATASET_CANDIDATE_NOT_APPROVED').toLowerCase()).toContain('dataset candidate');
  });
});

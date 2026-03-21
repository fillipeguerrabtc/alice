/**
 * Helpers canônicos para consentimento de treinamento.
 *
 * Mantêm o contrato de opt-in explícito em um único lugar para backend e frontend.
 */

export type NormalizedTrainingPreferences = {
  allowTrainingUsage: boolean;
  allowAutoCollect: boolean;
};

type TrainingPreferencesCarrier = {
  training?: {
    allowTrainingUsage?: boolean;
    allowAutoCollect?: boolean;
  };
};

export function normalizeTrainingPreferences(
  preferences: TrainingPreferencesCarrier | null | undefined,
): NormalizedTrainingPreferences {
  const training = preferences?.training;

  return {
    allowTrainingUsage: training?.allowTrainingUsage === true,
    allowAutoCollect: training?.allowAutoCollect === true,
  };
}

export function hasExplicitTrainingConsent(
  preferences: TrainingPreferencesCarrier | null | undefined,
): boolean {
  const normalized = normalizeTrainingPreferences(preferences);

  return normalized.allowTrainingUsage && normalized.allowAutoCollect;
}

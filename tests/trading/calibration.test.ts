import { describe, it, expect } from 'vitest';
import { applyPlatt, calibratePlatt } from '../../apps/training-service/src/trading/validation/calibration';

describe('calibration', () => {
  it('builds platt model and applies calibrated probability', () => {
    const model = calibratePlatt([
      { raw: 0.2, outcome: 0 },
      { raw: 0.8, outcome: 1 },
      { raw: 0.6, outcome: 1 },
      { raw: 0.3, outcome: 0 },
    ]);
    const calibrated = applyPlatt(0.7, model);
    expect(calibrated).toBeGreaterThan(0);
    expect(calibrated).toBeLessThan(1);
  });
});

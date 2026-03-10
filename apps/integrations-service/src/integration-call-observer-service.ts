type IntegrationConfiguredGaugeLike = {
  set: (labels: { integration: string }, value: number) => void;
};

type IntegrationMetricsLike = {
  callDuration: {
    observe: (labels: { integration: string; operation: string }, durationSeconds: number) => void;
  };
  callsTotal: {
    inc: (labels: { integration: string; operation: string; status: 'success' | 'error' }, value: number) => void;
  };
  errorsTotal: {
    inc: (labels: { integration: string; operation: string; error_type: string }, value: number) => void;
  };
};

export function createIntegrationCallObserverService(deps: {
  integrationsConfiguredGauge: IntegrationConfiguredGaugeLike;
  integrationsOperationalGauge: IntegrationConfiguredGaugeLike;
  integrationsMetrics: IntegrationMetricsLike;
}) {
  function classifyIntegrationError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('timeout')) return 'timeout';
      if (message.includes('breaker')) return 'breaker_open';
      if (message.includes('429')) return 'rate_limit';
      if (message.includes('unauthorized') || message.includes('forbidden')) return 'auth';
      if (message.includes('not found')) return 'not_found';
      if (message.includes('http')) return 'http_error';
    }
    return 'error';
  }

  function updateIntegrationMetrics(integration: string, configured: boolean, operational: boolean): void {
    deps.integrationsConfiguredGauge.set({ integration }, configured ? 1 : 0);
    deps.integrationsOperationalGauge.set({ integration }, operational ? 1 : 0);
  }

  async function observeIntegrationCall<T>(params: {
    integration: string;
    operation: string;
    fn: () => Promise<T>;
  }): Promise<T> {
    const start = process.hrtime.bigint();
    try {
      const result = await params.fn();
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      deps.integrationsMetrics.callDuration.observe(
        { integration: params.integration, operation: params.operation },
        durationSeconds,
      );
      deps.integrationsMetrics.callsTotal.inc(
        { integration: params.integration, operation: params.operation, status: 'success' },
        1,
      );
      return result;
    } catch (error) {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      deps.integrationsMetrics.callDuration.observe(
        { integration: params.integration, operation: params.operation },
        durationSeconds,
      );
      deps.integrationsMetrics.callsTotal.inc(
        { integration: params.integration, operation: params.operation, status: 'error' },
        1,
      );
      deps.integrationsMetrics.errorsTotal.inc(
        { integration: params.integration, operation: params.operation, error_type: classifyIntegrationError(error) },
        1,
      );
      throw error;
    }
  }

  return {
    updateIntegrationMetrics,
    observeIntegrationCall,
  };
}

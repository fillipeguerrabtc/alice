type IntegrationHealthStatus = {
  configured: boolean;
  operational: boolean;
  error?: string;
  details?: Record<string, unknown>;
};

type WithTimeoutFn = <T>(promise: Promise<T>, timeoutMs: number, label: string) => Promise<T>;

type CreateIntegrationHealthRefresherOptions = {
  stripe: {
    accounts: {
      retrieve: () => Promise<unknown>;
    };
  } | null;
  wiseServiceGetProfiles: () => Promise<unknown>;
  isWiseConfigured: () => boolean;
  getSandboxStatus: () => boolean;
  getProfileIdSafe: () => string | null;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappNumber?: string;
  emailTransporter: {
    verify: () => Promise<unknown>;
  } | null;
  openAiApiKey?: string;
  externalApiTimeoutMs: number;
  withTimeout: WithTimeoutFn;
  getKucoinConfigStatus: () => { isConfigured: boolean; missingKeys?: string[] };
  getKucoinCircuitBreakerStatus: () => unknown;
  updateIntegrationMetrics: (integration: string, configured: boolean, operational: boolean) => void;
};

function normalizeIntegrationError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Erro desconhecido';
}

export function createIntegrationHealthRefresher({
  stripe,
  wiseServiceGetProfiles,
  isWiseConfigured,
  getSandboxStatus,
  getProfileIdSafe,
  twilioAccountSid,
  twilioAuthToken,
  twilioWhatsappNumber,
  emailTransporter,
  openAiApiKey,
  externalApiTimeoutMs,
  withTimeout,
  getKucoinConfigStatus,
  getKucoinCircuitBreakerStatus,
  updateIntegrationMetrics,
}: CreateIntegrationHealthRefresherOptions) {
  async function checkStripeHealth(): Promise<IntegrationHealthStatus> {
    if (!stripe) {
      return { configured: false, operational: false };
    }
    try {
      await withTimeout(stripe.accounts.retrieve(), externalApiTimeoutMs, 'Stripe');
      return { configured: true, operational: true };
    } catch (error) {
      return { configured: true, operational: false, error: normalizeIntegrationError(error) };
    }
  }

  async function checkWiseHealth(): Promise<IntegrationHealthStatus> {
    if (!isWiseConfigured()) {
      return { configured: false, operational: false, details: { sandbox: getSandboxStatus() } };
    }
    try {
      await withTimeout(wiseServiceGetProfiles(), externalApiTimeoutMs, 'Wise');
      return {
        configured: true,
        operational: true,
        details: {
          sandbox: getSandboxStatus(),
          profileId: getProfileIdSafe(),
        },
      };
    } catch (error) {
      return {
        configured: true,
        operational: false,
        error: normalizeIntegrationError(error),
        details: {
          sandbox: getSandboxStatus(),
          profileId: getProfileIdSafe(),
        },
      };
    }
  }

  async function checkTwilioHealth(): Promise<IntegrationHealthStatus> {
    if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsappNumber) {
      return { configured: false, operational: false };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), externalApiTimeoutMs);
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}.json`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Twilio HTTP ${response.status}`);
      }
      return { configured: true, operational: true };
    } catch (error) {
      return { configured: true, operational: false, error: normalizeIntegrationError(error) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function checkEmailHealth(): Promise<IntegrationHealthStatus> {
    if (!emailTransporter) {
      return { configured: false, operational: false };
    }
    try {
      await withTimeout(emailTransporter.verify(), externalApiTimeoutMs, 'Gmail SMTP');
      return { configured: true, operational: true };
    } catch (error) {
      return { configured: true, operational: false, error: normalizeIntegrationError(error) };
    }
  }

  async function checkOpenAiVisionHealth(): Promise<IntegrationHealthStatus> {
    if (!openAiApiKey) {
      return { configured: false, operational: false };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), externalApiTimeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OpenAI HTTP ${response.status}`);
      }
      return { configured: true, operational: true };
    } catch (error) {
      return { configured: true, operational: false, error: normalizeIntegrationError(error) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function checkTradingHealth(): IntegrationHealthStatus {
    const configStatus = getKucoinConfigStatus();
    const circuitBreaker = getKucoinCircuitBreakerStatus();
    if (!configStatus.isConfigured) {
      return {
        configured: false,
        operational: false,
        details: { missingKeys: configStatus.missingKeys },
      };
    }
    const operational = (circuitBreaker as { state?: string })?.state !== 'open';
    return {
      configured: true,
      operational,
      details: {
        missingKeys: configStatus.missingKeys,
        circuitBreaker,
      },
    };
  }

  async function collectIntegrationHealthStatuses(): Promise<Record<string, IntegrationHealthStatus>> {
    const [stripeHealth, wiseHealth, twilioHealth, emailHealth, openAiVisionHealth] = await Promise.all([
      checkStripeHealth(),
      checkWiseHealth(),
      checkTwilioHealth(),
      checkEmailHealth(),
      checkOpenAiVisionHealth(),
    ]);
    const tradingHealth = checkTradingHealth();

    return {
      stripe: stripeHealth,
      wise: wiseHealth,
      twilio: twilioHealth,
      email: emailHealth,
      openai_vision: openAiVisionHealth,
      trading: tradingHealth,
    };
  }

  async function refreshIntegrationHealthMetrics(): Promise<Record<string, IntegrationHealthStatus>> {
    const services = await collectIntegrationHealthStatuses();
    Object.entries(services).forEach(([integration, status]) => {
      updateIntegrationMetrics(integration, status.configured, status.operational);
    });
    return services;
  }

  return {
    refreshIntegrationHealthMetrics,
  };
}

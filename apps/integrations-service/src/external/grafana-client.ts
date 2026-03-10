export type GrafanaRequestMethod = 'GET' | 'POST';

export type GrafanaConfig = {
  GRAFANA_URL?: string;
  GRAFANA_API_KEY?: string;
  GRAFANA_ADMIN_USER?: string;
  GRAFANA_ADMIN_PASSWORD?: string;
};

export type TimeoutRunner = <T>(promise: Promise<T>, timeoutMs: number, label: string) => Promise<T>;

export function createGrafanaClient(params: {
  config: GrafanaConfig;
  withTimeout: TimeoutRunner;
  timeoutMs: number;
}) {
  const { config, withTimeout, timeoutMs } = params;
  const grafanaBaseUrl = config.GRAFANA_URL ? config.GRAFANA_URL.replace(/\/+$/, '') : '';

  function ensureConfigured(): void {
    if (!grafanaBaseUrl) {
      throw new Error('Grafana não configurado (GRAFANA_URL ausente).');
    }
    if (!config.GRAFANA_API_KEY && !(config.GRAFANA_ADMIN_USER && config.GRAFANA_ADMIN_PASSWORD)) {
      throw new Error('Credenciais Grafana ausentes (GRAFANA_API_KEY ou GRAFANA_ADMIN_USER/PASSWORD).');
    }
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.GRAFANA_API_KEY) {
      headers.Authorization = `Bearer ${config.GRAFANA_API_KEY}`;
      return headers;
    }

    const raw = `${config.GRAFANA_ADMIN_USER}:${config.GRAFANA_ADMIN_PASSWORD}`;
    headers.Authorization = `Basic ${Buffer.from(raw).toString('base64')}`;
    return headers;
  }

  async function request<T>(
    method: GrafanaRequestMethod,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    ensureConfigured();

    const response = await withTimeout(
      fetch(`${grafanaBaseUrl}${path}`, {
        method,
        headers: buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      }),
      timeoutMs,
      'Grafana'
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grafana HTTP ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    request,
    isConfigured: (): boolean => Boolean(grafanaBaseUrl),
  };
}

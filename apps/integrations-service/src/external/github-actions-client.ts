import type { TimeoutRunner } from './grafana-client.js';

export type GitHubActionsConfig = {
  GH_API_URL?: string;
  GH_REPO?: string;
  GH_PAT?: string;
};

type DeployStackPayload = {
  ref: string;
  inputs: {
    stack: string;
    version: string;
    rollback: string;
    rollback_version: string;
    dry_run: string;
    smart_deploy: string;
  };
};

export function createGitHubActionsClient(params: {
  config: GitHubActionsConfig;
  withTimeout: TimeoutRunner;
  timeoutMs: number;
}) {
  const { config, withTimeout, timeoutMs } = params;

  const apiUrl = config.GH_API_URL?.trim() || 'https://api.github.com';
  const repository = config.GH_REPO?.trim();
  const token = config.GH_PAT?.trim();

  async function dispatchDeployStack(payload: DeployStackPayload): Promise<void> {
    if (!repository || !token) {
      throw new Error('GitHub Actions not configured');
    }

    const response = await withTimeout(
      fetch(`${apiUrl}/repos/${repository}/actions/workflows/deploy-stack-modular.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      timeoutMs,
      'GitHub Actions'
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GitHub Actions dispatch failed: ${response.status} - ${errText}`);
    }
  }

  return {
    isConfigured: (): boolean => Boolean(repository && token),
    dispatchDeployStack,
  };
}

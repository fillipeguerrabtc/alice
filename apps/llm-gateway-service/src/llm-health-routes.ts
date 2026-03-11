import type express from 'express';

export function registerLlmHealthRoutes(app: express.Express): void {
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.json({ status: 'ok' }));
}

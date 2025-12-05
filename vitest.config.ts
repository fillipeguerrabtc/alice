/**
 * Configuração do Vitest - Alice Enterprise Platform
 * 
 * Configuração de testes automatizados seguindo melhores práticas 2025.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/**/src/**/*.ts',
        'packages/**/src/**/*.ts',
        'shared/**/*.ts',
      ],
      exclude: [
        'node_modules',
        'tests',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },
    pool: 'forks',
    isolate: true,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@alice/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@alice/logger': path.resolve(__dirname, 'packages/logger/src'),
      '@alice/config': path.resolve(__dirname, 'packages/config/src'),
      '@alice/database': path.resolve(__dirname, 'packages/database/src'),
      '@alice/shared-utils': path.resolve(__dirname, 'packages/shared-utils/src'),
      '@alice/shared-utils/config': path.resolve(__dirname, 'packages/shared-utils/src/config.ts'),
      '@alice/shared-utils/logger': path.resolve(__dirname, 'packages/shared-utils/src/logger.ts'),
      '@alice/shared-utils/health': path.resolve(__dirname, 'packages/shared-utils/src/health.ts'),
      '@alice/shared-utils/circuit-breaker': path.resolve(__dirname, 'packages/shared-utils/src/circuit-breaker.ts'),
      '@tests': path.resolve(__dirname, 'tests'),
    },
  },
});

/**
 * ESLint Configuration - Alice Enterprise Platform
 * 
 * Configuração ESLint 9 (flat config) seguindo melhores práticas 2025.
 * 
 * Estratégia:
 * - Regras de SEGURANÇA: error (bloqueante)
 * - Regras de QUALIDADE: warn (transição gradual)
 * - Regras de ESTILO: off ou warn
 * 
 * Autor: Fillipe Guerra
 * Data: 04 de Dezembro de 2025
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Configuração base ESLint recomendada
  eslint.configs.recommended,
  
  // Configuração TypeScript recomendada
  ...tseslint.configs.recommended,
  
  // Configuração global
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  
  // Regras para arquivos TypeScript
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // === SEGURANÇA (error - bloqueante) ===
      'no-eval': 'error',
      'no-implied-eval': 'error',
      
      // === QUALIDADE (warn - transição) ===
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'warn',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      
      // === PERMITIDOS (código legado) ===
      '@typescript-eslint/no-require-imports': 'off', // tailwind.config usa require
      '@typescript-eslint/no-namespace': 'off', // usado em types.ts
      '@typescript-eslint/no-empty-object-type': 'off', // interfaces vazias permitidas
      'no-case-declarations': 'off', // permitir let/const em case
      'no-control-regex': 'off', // regex com control chars permitido
    },
  },
  
  // Relaxar regras para arquivos de teste
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  
  // Relaxar regras para arquivos de configuração
  {
    files: ['*.config.ts', '*.config.mjs', 'tailwind.config.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  
  // Relaxar regras para server/ (dev mode)
  {
    files: ['server/**/*.ts'],
    rules: {
      'no-console': 'off', // dev server pode usar console
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  
  // Ignorar arquivos que não devem ser lintados
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.d.ts',
      '**/coverage/**',
      '**/.git/**',
      '**/attached_assets/**',
      '**/drizzle/**',
      '**/infra/**',
    ],
  },
);

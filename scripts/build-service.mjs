#!/usr/bin/env node
/**
 * Alice Enterprise Platform - Script de Build para Microsserviços
 * 
 * Usa esbuild para criar bundles que incluem pacotes @alice/* inline,
 * mantendo dependências externas (express, pg, etc.) separadas.
 * 
 * Uso: node scripts/build-service.mjs <service-name>
 * Exemplo: node scripts/build-service.mjs auth-service
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import * as esbuild from 'esbuild';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const serviceName = process.argv[2];

if (!serviceName) {
  console.error('Erro: Nome do serviço é obrigatório');
  console.error('Uso: node scripts/build-service.mjs <service-name>');
  process.exit(1);
}

const serviceDir = join(rootDir, 'apps', serviceName);

if (!existsSync(serviceDir)) {
  console.error(`Erro: Serviço não encontrado: ${serviceDir}`);
  process.exit(1);
}

const pkgPath = join(serviceDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const allDependencies = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
};

const externalPackages = Object.keys(allDependencies).filter(
  (dep) => !dep.startsWith('@alice/')
);

console.log(`\n🔨 Building ${serviceName}...`);
console.log(`📦 Pacotes @alice/* serão incluídos no bundle`);
console.log(`📤 Dependências externas: ${externalPackages.length} pacotes`);

try {
  await esbuild.build({
    entryPoints: [join(serviceDir, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(serviceDir, 'dist', 'bundle.js'),
    external: externalPackages,
    sourcemap: true,
    minify: false,
    keepNames: true,
    treeShaking: true,
    metafile: true,
    logLevel: 'info',
    banner: {
      js: `// Alice Enterprise Platform - ${serviceName}\n// Build: ${new Date().toISOString()}\n`,
    },
  });

  console.log(`✅ Build concluído: ${serviceDir}/dist/bundle.js\n`);
} catch (error) {
  console.error(`❌ Erro no build: ${error.message}`);
  process.exit(1);
}

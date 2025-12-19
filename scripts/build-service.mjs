#!/usr/bin/env node
/**
 * Alice Enterprise Platform - Script de Build para Microsserviços
 * 
 * Usa esbuild para criar bundles que incluem pacotes @alice/* inline,
 * mantendo dependências externas (express, pg, etc.) separadas.
 * 
 * CORREÇÃO 19/12/2025: Externaliza Node.js builtins para evitar erro
 * "Dynamic require of node:crypto is not supported" do pacote redis v5+
 * 
 * Uso: node scripts/build-service.mjs <service-name>
 * Exemplo: node scripts/build-service.mjs auth-service
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * Autor: Fillipe Guerra
 * Data: 19 de Dezembro de 2025
 */

import * as esbuild from 'esbuild';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

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

// Dependências externas (não começam com @alice/)
const externalDependencies = Object.keys(allDependencies).filter(
  (dep) => !dep.startsWith('@alice/')
);

// CORREÇÃO 19/12/2025: Node.js builtins devem ser externalizados
// O pacote redis v5+ usa require('node:crypto') dinamicamente
// esbuild não consegue bundlar isso em ESM, então externalizamos todos os builtins
// Inclui tanto 'crypto' quanto 'node:crypto' (Node.js 16+ prefix)
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
];

// Lista completa de externals
const externalPackages = [
  ...externalDependencies,
  ...nodeBuiltins,
];

console.log(`\n🔨 Building ${serviceName}...`);
console.log(`📦 Pacotes @alice/* serão incluídos no bundle`);
console.log(`📤 Dependências externas: ${externalDependencies.length} pacotes`);
console.log(`📤 Node.js builtins: ${builtinModules.length} módulos (com e sem prefixo node:)`);

try {
  await esbuild.build({
    entryPoints: [join(serviceDir, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',  // Atualizado para Node.js 22 LTS (Best Practices 2025)
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

#!/usr/bin/env node
/**
 * Alice Enterprise Platform - Script de Build para Microsserviços
 * 
 * Usa esbuild para criar bundles que incluem pacotes @alice/* inline,
 * mantendo dependências externas (express, pg, redis, prom-client, etc.) separadas.
 * 
 * CORREÇÃO ENTERPRISE 20/12/2025:
 * - Coleta dependências de TODOS os pacotes @alice/* (shared-utils, database, etc.)
 * - Externaliza TODAS as dependências externas encontradas
 * - Resolve o problema de "Dynamic require" de forma DEFINITIVA
 * - Pacotes como redis, prom-client, pgvector são externalizados automaticamente
 * 
 * PROBLEMA ANTERIOR:
 * - Script só externalizava dependências do package.json do serviço
 * - Pacotes @alice/* eram bundlados inline COM suas dependências
 * - Dependências como redis, prom-client usam require() dinâmico
 * - esbuild não suporta require() dinâmico em ESM bundle
 * 
 * SOLUÇÃO:
 * - Ler package.json de todos os pacotes em packages/
 * - Coletar TODAS as dependências externas
 * - Externalizar TODAS (não só as do serviço)
 * 
 * Uso: node scripts/build-service.mjs <service-name>
 * Exemplo: node scripts/build-service.mjs auth-service
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * Autor: Fillipe Guerra
 * Data: 20 de Dezembro de 2025
 */

import * as esbuild from 'esbuild';
import { readFileSync, existsSync, readdirSync } from 'fs';
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

/**
 * Coleta TODAS as dependências externas de um package.json
 * @param {string} pkgPath - Caminho para o package.json
 * @returns {string[]} - Lista de dependências externas (não @alice/*)
 */
function collectExternalDeps(pkgPath) {
  if (!existsSync(pkgPath)) return [];
  
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.peerDependencies, // Incluir peerDependencies também
    };
    
    return Object.keys(allDeps).filter(dep => !dep.startsWith('@alice/'));
  } catch {
    return [];
  }
}

// ============================================================================
// PASSO 1: Coletar dependências do serviço
// ============================================================================
const servicePkgPath = join(serviceDir, 'package.json');
const servicePkg = JSON.parse(readFileSync(servicePkgPath, 'utf-8'));
const serviceDeps = collectExternalDeps(servicePkgPath);

// ============================================================================
// PASSO 2: Coletar dependências de TODOS os pacotes @alice/* em packages/
// ============================================================================
const packagesDir = join(rootDir, 'packages');
const packagesDeps = new Set();
const internalPackages = new Set();
const internalSubpaths = new Set();

if (existsSync(packagesDir)) {
  const packageFolders = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const folder of packageFolders) {
    const pkgPath = join(packagesDir, folder, 'package.json');
    if (!existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg?.name?.startsWith('@alice/')) {
        internalPackages.add(pkg.name);

        const exportsField = pkg.exports;
        if (exportsField && typeof exportsField === 'object') {
          Object.keys(exportsField)
            .filter((key) => key.startsWith('./') && key !== './')
            .forEach((key) => {
              const subpath = key.slice(2);
              if (subpath.length > 0) {
                internalSubpaths.add(`${pkg.name}/${subpath}`);
              }
            });
        }
      }
    } catch {
      // Ignorar pacotes com JSON inválido
    }

    const deps = collectExternalDeps(pkgPath);
    deps.forEach(dep => packagesDeps.add(dep));
  }
}

// ============================================================================
// PASSO 3: Combinar todas as dependências externas
// ============================================================================
const allExternalDeps = new Set([
  ...serviceDeps,
  ...packagesDeps,
]);

// ============================================================================
// PASSO 4: Adicionar Node.js builtins (com e sem prefixo node:)
// ============================================================================
// Pacotes como redis v5+, prom-client usam require('node:crypto'), require('util')
// esbuild não consegue bundlar require() dinâmico em ESM
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
];

// ============================================================================
// PASSO 5: Lista completa de externals
// ============================================================================
const externalPackages = [
  ...allExternalDeps,
  ...internalPackages,
  ...internalSubpaths,
  ...nodeBuiltins,
];

console.log(`\n🔨 Building ${serviceName}...`);
console.log(`📦 Pacotes @alice/* e subpaths serão externalizados`);
console.log(`📤 Dependências do serviço: ${serviceDeps.length} pacotes`);
console.log(`📤 Dependências dos packages/: ${packagesDeps.size} pacotes`);
console.log(`📤 Pacotes internos @alice/*: ${internalPackages.size} pacotes`);
console.log(`📤 Subpaths internos exportados: ${internalSubpaths.size} itens`);
console.log(`📤 Total de externals: ${allExternalDeps.size + internalPackages.size + internalSubpaths.size} pacotes únicos`);
console.log(`📤 Node.js builtins: ${builtinModules.length} módulos (com e sem prefixo node:)`);

// Log detalhado das dependências externalizadas (debug)
if (process.env.DEBUG_BUILD) {
  console.log('\n📋 Dependências externalizadas:');
  [...allExternalDeps].sort().forEach(dep => console.log(`   - ${dep}`));
}

try {
  const result = await esbuild.build({
    entryPoints: [join(serviceDir, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',  // Node.js 22 LTS (Best Practices 2025)
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
      js: `// Alice Enterprise Platform - ${serviceName}\n// Build: ${new Date().toISOString()}\n// Externalized: ${allExternalDeps.size} packages + ${builtinModules.length} builtins\n`,
    },
  });

  console.log(`✅ Build concluído: ${serviceDir}/dist/bundle.js\n`);
  
  // Log de warnings se houver
  if (result.warnings.length > 0) {
    console.log(`⚠️ ${result.warnings.length} warnings durante o build`);
  }
} catch (error) {
  console.error(`❌ Erro no build: ${error.message}`);
  process.exit(1);
}

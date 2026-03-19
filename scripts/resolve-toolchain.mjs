import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const packageJsonPath = path.join(ROOT_DIR, 'package.json');
const nvmrcPath = path.join(ROOT_DIR, '.nvmrc');

function readRequiredFile(filePath, errorMessage) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    console.error(errorMessage);
    process.exit(1);
  }
}

const nodeVersion = readRequiredFile(
  nvmrcPath,
  'ERRO: arquivo .nvmrc nao encontrado para resolver a versao oficial do Node.js.',
).trim();

if (!nodeVersion) {
  console.error('ERRO: .nvmrc vazio ou invalido.');
  process.exit(1);
}

const packageJson = JSON.parse(
  readRequiredFile(packageJsonPath, 'ERRO: package.json nao encontrado para resolver o pnpm.'),
);
const packageManager = typeof packageJson.packageManager === 'string' ? packageJson.packageManager : '';
const packageManagerMatch = /^pnpm@(.+)$/.exec(packageManager);

if (!packageManagerMatch) {
  console.error('ERRO: campo packageManager nao encontrado ou invalido em package.json.');
  process.exit(1);
}

const pnpmVersion = packageManagerMatch[1];

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `node-version=${nodeVersion}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `pnpm-version=${pnpmVersion}\n`);
}

console.log(`✅ Node.js (.nvmrc): ${nodeVersion}`);
console.log(`✅ pnpm (packageManager): ${pnpmVersion}`);

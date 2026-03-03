/**
 * Script de Seed OIDC - Alice Enterprise Platform
 * 
 * Popula:
 * - Módulos do sistema (Dashboard, Chat, Grafana)
 * - Clientes OAuth (Grafana)
 * - Chave JWKS RS256 para assinatura JWT
 * 
 * Seguindo Regra 6 CLAUDE.md: PROIBIDO dados hardcoded em produção
 * Este seed é apenas para inicialização do sistema
 * 
 * Execução: npx tsx scripts/seed-oidc.ts
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { randomBytes, generateKeyPairSync } from "crypto";
import * as jose from "jose";
import {
  systemModules,
  roleModules,
  oauthClients,
  oidcJwks,
} from "../packages/shared/src/schema";
import { eq, and } from "drizzle-orm";

// Logger Pino (Regra 8 - Qualidade Obrigatória)
import pino from "pino";
const logger = pino({
  level: "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  logger.error("DATABASE_URL não definida");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql);

// Módulos do Sistema Alice
const SYSTEM_MODULES = [
  {
    codigo: "dashboard",
    nome: "Dashboard",
    descricao: "Painel principal com métricas e visão geral do sistema",
    icone: "LayoutDashboard",
    categoria: "core",
    urlExterna: null,
    ordem: 1,
    ativo: true,
  },
  {
    codigo: "chat",
    nome: "Chat IA",
    descricao: "Interface de conversação com Alice (Qwen2.5 7B - texto)",
    icone: "MessageSquare",
    categoria: "core",
    urlExterna: null,
    ordem: 2,
    ativo: true,
  },
  {
    codigo: "rag",
    nome: "Base de Conhecimento",
    descricao: "Upload e gestão de documentos para RAG",
    icone: "BookOpen",
    categoria: "core",
    urlExterna: null,
    ordem: 3,
    ativo: true,
  },
  {
    codigo: "training",
    nome: "Treinamento",
    descricao: "Fine-tuning e auto-aprendizado da IA",
    icone: "GraduationCap",
    categoria: "advanced",
    urlExterna: null,
    ordem: 4,
    ativo: true,
  },
  {
    codigo: "image_analysis",
    nome: "Análise de Imagens",
    descricao: "Análise de imagens via OpenAI Vision (gpt-4.1)",
    icone: "Image",
    categoria: "core",
    urlExterna: null,
    ordem: 5,
    ativo: true,
  },
  {
    codigo: "grafana",
    nome: "Grafana",
    descricao: "Observabilidade - Dashboards de métricas e logs",
    icone: "Activity",
    categoria: "observability",
    urlExterna: process.env.GRAFANA_URL || null,
    ordem: 10,
    ativo: true,
  },
  {
    codigo: "takeover",
    nome: "Takeover/Handover",
    descricao: "Painel de intervenção humana em conversas",
    icone: "UserCog",
    categoria: "operations",
    urlExterna: null,
    ordem: 6,
    ativo: true,
  },
  {
    codigo: "users",
    nome: "Gestão de Usuários",
    descricao: "Administração de usuários e permissões",
    icone: "Users",
    categoria: "admin",
    urlExterna: null,
    ordem: 20,
    ativo: true,
  },
  {
    codigo: "modules",
    nome: "Gestão de Módulos",
    descricao: "Configuração de acesso a módulos por usuário/role",
    icone: "Blocks",
    categoria: "admin",
    urlExterna: null,
    ordem: 21,
    ativo: true,
  },
  {
    codigo: "settings",
    nome: "Configurações",
    descricao: "Configurações gerais do sistema",
    icone: "Settings",
    categoria: "admin",
    urlExterna: null,
    ordem: 99,
    ativo: true,
  },
];

// Mapeamento Role → Módulos (RBAC 6 níveis)
const ROLE_MODULE_ACCESS: Record<string, { read: string[]; write: string[]; admin: string[] }> = {
  super_admin: {
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover", "users", "modules", "settings"],
    write: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover", "users", "modules", "settings"],
    admin: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover", "users", "modules", "settings"],
  },
  admin: {
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover", "users"],
    write: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover", "users"],
    admin: ["dashboard", "chat", "rag", "training", "image_gen", "takeover", "users"],
  },
  manager: {
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "takeover"],
    write: ["dashboard", "chat", "rag", "image_gen", "takeover"],
    admin: [],
  },
  operator: {
    read: ["dashboard", "chat", "rag", "image_gen", "takeover"],
    write: ["chat", "rag", "image_gen", "takeover"],
    admin: [],
  },
  viewer: {
    read: ["dashboard", "chat"],
    write: [],
    admin: [],
  },
  guest: {
    read: ["chat"],
    write: [],
    admin: [],
  },
};

// Validar variáveis de ambiente obrigatórias para OAuth clients
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error({ variable: name }, 'Variável de ambiente obrigatória não definida');
    throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  }
  return value;
}

// =============================================================================
// CLIENTES OAUTH SSO - ARQUITETURA 100% AUTOMATIZADA (31/12/2025)
// =============================================================================
// SECRETS PRÉ-DEFINIDOS: Em vez de gerar client_secret dinamicamente,
// usamos secrets pré-definidos no GitHub. Isso permite:
// 1. Deploy 100% automatizado sem passos manuais pós-deploy
// 2. Grafana já tem os secrets configurados antes do primeiro acesso
// 3. Seed é idempotente - pode rodar múltiplas vezes sem problemas
//
// SECRETS NECESSÁRIOS NO GITHUB:
// - GRAFANA_OAUTH_CLIENT_SECRET: Secret pré-gerado para grafana-sso
//
// COMO GERAR: openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
// =============================================================================

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string; // Agora vem do ambiente, não é gerado
  nome: string;
  descricao: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
  tokenEndpointAuthMethod: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  autoConsent: boolean;
  ativo: boolean;
}

function getOAuthClients(): OAuthClientConfig[] {
  const grafanaUrl = getRequiredEnvVar('GRAFANA_URL');
  
  // SECRETS PRÉ-DEFINIDOS: Obrigatórios para deploy automatizado
  const grafanaClientSecret = getRequiredEnvVar('GRAFANA_OAUTH_CLIENT_SECRET');
  
  return [
    {
      clientId: "grafana-sso",
      clientSecret: grafanaClientSecret,
      nome: "Grafana OSS",
      descricao: "Dashboard de observabilidade - SSO via Alice IdP",
      redirectUris: [`${grafanaUrl}/login/generic_oauth`],
      grantTypes: ["authorization_code", "refresh_token"],
      scopes: ["openid", "profile", "email", "groups", "roles"],
      tokenEndpointAuthMethod: "client_secret_basic",
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
      autoConsent: true,
      ativo: true,
    },
  ];
}

// REMOVIDO: generateClientSecret() - agora usamos secrets pré-definidos
// Secrets são gerados uma vez e configurados no GitHub
// Comando para gerar: openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'

// Função para gerar par de chaves RS256 (JWKS)
async function generateJwksPair(): Promise<{
  kid: string;
  privateKey: jose.JWK;
  publicKey: jose.JWK;
}> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const kid = randomBytes(16).toString("hex");
  
  const privateJwk = await jose.exportJWK(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);

  privateJwk.kid = kid;
  privateJwk.alg = "RS256";
  privateJwk.use = "sig";

  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  return { kid, privateKey: privateJwk, publicKey: publicJwk };
}

async function seedModules() {
  logger.info("Iniciando seed de módulos do sistema...");

  for (const modulo of SYSTEM_MODULES) {
    const existing = await db
      .select()
      .from(systemModules)
      .where(eq(systemModules.codigo, modulo.codigo))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(systemModules).values(modulo);
      logger.info({ codigo: modulo.codigo }, "Módulo criado");
    } else {
      logger.info({ codigo: modulo.codigo }, "Módulo já existe, pulando");
    }
  }

  logger.info("Seed de módulos concluído");
}

async function seedRoleModules() {
  logger.info("Iniciando seed de permissões role→módulo...");

  // Buscar todos os módulos
  const modules = await db.select().from(systemModules);
  const moduleMap = new Map(modules.map((m) => [m.codigo, m.id]));

  for (const [role, access] of Object.entries(ROLE_MODULE_ACCESS)) {
    const allModules = new Set([...access.read, ...access.write, ...access.admin]);

    for (const moduloCodigo of allModules) {
      const moduleId = moduleMap.get(moduloCodigo);
      if (!moduleId) {
        logger.warn({ role, moduloCodigo }, "Módulo não encontrado");
        continue;
      }

      // Verificar se já existe (by role AND moduleId)
      const existing = await db
        .select()
        .from(roleModules)
        .where(
          and(
            eq(roleModules.moduleId, moduleId),
            eq(roleModules.role, role as "super_admin" | "admin" | "manager" | "operator" | "viewer" | "guest")
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(roleModules).values({
          role: role as "super_admin" | "admin" | "manager" | "operator" | "viewer" | "guest",
          moduleId,
          acessoLeitura: access.read.includes(moduloCodigo),
          acessoEscrita: access.write.includes(moduloCodigo),
          acessoAdmin: access.admin.includes(moduloCodigo),
        });
        logger.info({ role, moduloCodigo }, "Permissão role→módulo criada");
      }
    }
  }

  logger.info("Seed de permissões role→módulo concluído");
}

// =============================================================================
// SEED OAUTH CLIENTS - IDEMPOTENTE COM SECRETS PRÉ-DEFINIDOS (31/12/2025)
// =============================================================================
// Comportamento:
// - Se cliente NÃO existe: Cria com secret do ambiente
// - Se cliente JÁ existe: Atualiza secret e configurações (idempotente)
//
// Isso garante que:
// 1. Primeiro deploy: Cria clientes com secrets corretos
// 2. Deploys subsequentes: Mantém secrets atualizados se mudarem
// 3. SSO funciona automaticamente sem passos manuais
// =============================================================================

async function seedOAuthClients() {
  logger.info("Iniciando seed de clientes OAuth (secrets pré-definidos)...");
  
  const clients = getOAuthClients();

  for (const client of clients) {
    const existing = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, client.clientId))
      .limit(1);

    if (existing.length === 0) {
      // CRIAR: Cliente não existe, criar com secret do ambiente
      await db.insert(oauthClients).values({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        nome: client.nome,
        descricao: client.descricao,
        redirectUris: client.redirectUris,
        grantTypes: client.grantTypes,
        scopes: client.scopes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        accessTokenTtl: client.accessTokenTtl,
        refreshTokenTtl: client.refreshTokenTtl,
        autoConsent: client.autoConsent,
        ativo: client.ativo,
      });

      // SEGURANÇA: Logar apenas prefixo do secret (Regra 6)
      logger.info(
        { clientId: client.clientId, secretPrefix: client.clientSecret.substring(0, 8) + "..." },
        "Cliente OAuth criado com secret pré-definido"
      );
    } else {
      // ATUALIZAR: Cliente existe, atualizar secret e configurações (idempotente)
      await db.update(oauthClients)
        .set({
          clientSecret: client.clientSecret,
          nome: client.nome,
          descricao: client.descricao,
          redirectUris: client.redirectUris,
          grantTypes: client.grantTypes,
          scopes: client.scopes,
          tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
          accessTokenTtl: client.accessTokenTtl,
          refreshTokenTtl: client.refreshTokenTtl,
          autoConsent: client.autoConsent,
          ativo: client.ativo,
          atualizadoEm: new Date(),
        })
        .where(eq(oauthClients.clientId, client.clientId));

      logger.info(
        { clientId: client.clientId, secretPrefix: client.clientSecret.substring(0, 8) + "..." },
        "Cliente OAuth atualizado com secret pré-definido"
      );
    }
  }

  logger.info("Seed de clientes OAuth concluído (100% automatizado)");
}

async function seedJwks() {
  logger.info("Iniciando seed de JWKS (RS256)...");

  // Verificar se já existe chave ativa
  const existing = await db
    .select()
    .from(oidcJwks)
    .where(eq(oidcJwks.ativo, true))
    .limit(1);

  if (existing.length === 0) {
    const { kid, privateKey, publicKey } = await generateJwksPair();

    await db.insert(oidcJwks).values({
      kid,
      alg: "RS256",
      use: "sig",
      privateKey,
      publicKey,
      ativo: true,
    });

    // SEGURANÇA: Logar apenas o KID (público), não a chave privada
    logger.info({ kid }, "Chave JWKS RS256 criada. KID disponível para configuração.");
  } else {
    logger.info({ kid: existing[0].kid }, "JWKS já existe, pulando");
  }

  logger.info("Seed de JWKS concluído");
}

async function main() {
  try {
    logger.info("=== Iniciando Seed OIDC/OAuth Alice ===");

    await seedModules();
    await seedRoleModules();
    await seedOAuthClients();
    await seedJwks();

    logger.info("=== Seed OIDC/OAuth concluído com sucesso! ===");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Erro durante seed");
    process.exit(1);
  }
}

main();

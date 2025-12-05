/**
 * Script de Seed OIDC - Alice Enterprise Platform
 * 
 * Popula:
 * - Módulos do sistema (Dashboard, Chat, ERPNext, Grafana)
 * - Clientes OAuth (Grafana, ERPNext)
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
    descricao: "Interface de conversação com Alice (Llama 4 Maverick)",
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
    codigo: "image_gen",
    nome: "Geração de Imagens",
    descricao: "Criação de imagens com FLUX.1 Schnell",
    icone: "Image",
    categoria: "creative",
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
    codigo: "erpnext",
    nome: "ERPNext",
    descricao: "CRM/ERP - Gestão de clientes, vendas e finanças",
    icone: "Building2",
    categoria: "business",
    urlExterna: process.env.ERPNEXT_URL || null,
    ordem: 11,
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
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover", "users", "modules", "settings"],
    write: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover", "users", "modules", "settings"],
    admin: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover", "users", "modules", "settings"],
  },
  admin: {
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover", "users"],
    write: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover", "users"],
    admin: ["dashboard", "chat", "rag", "training", "image_gen", "takeover", "users"],
  },
  manager: {
    read: ["dashboard", "chat", "rag", "training", "image_gen", "grafana", "erpnext", "takeover"],
    write: ["dashboard", "chat", "rag", "image_gen", "erpnext", "takeover"],
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

// Clientes OAuth para SSO (campos alinhados com schema)
// SEGURANÇA: URLs devem vir de variáveis de ambiente (Regra 6 - proibido hardcoded)
function getOAuthClients() {
  const grafanaUrl = getRequiredEnvVar('GRAFANA_URL');
  const erpnextUrl = getRequiredEnvVar('ERPNEXT_URL');
  
  return [
    {
      clientId: "grafana-sso",
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
    {
      clientId: "erpnext-sso",
      nome: "ERPNext CRM/ERP",
      descricao: "Sistema de gestão empresarial - SSO via Alice IdP",
      redirectUris: [`${erpnextUrl}/api/method/frappe.integrations.oauth2.login_via_oauth2`],
      grantTypes: ["authorization_code", "refresh_token"],
      scopes: ["openid", "profile", "email", "groups", "roles"],
      tokenEndpointAuthMethod: "client_secret_post",
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
      autoConsent: true,
      ativo: true,
    },
  ];
}

// Função para gerar client_secret seguro
function generateClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

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

// SEGURANÇA: Salvar secrets em arquivo seguro em vez de imprimir em stdout (Regra 6)
async function saveSecretsToFile(secrets: { clientId: string; clientSecret: string }[]): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  
  const secretsDir = path.join(os.tmpdir(), 'alice-secrets');
  await fs.mkdir(secretsDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const secretsFile = path.join(secretsDir, `oauth-secrets-${timestamp}.txt`);
  
  const content = secrets.map(s => `CLIENT_ID=${s.clientId}\nCLIENT_SECRET=${s.clientSecret}\n`).join('\n');
  
  await fs.writeFile(secretsFile, content, { mode: 0o600 });
  
  return secretsFile;
}

async function seedOAuthClients() {
  logger.info("Iniciando seed de clientes OAuth...");
  
  const clients = getOAuthClients();
  const createdSecrets: { clientId: string; clientSecret: string }[] = [];

  for (const client of clients) {
    const existing = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, client.clientId))
      .limit(1);

    if (existing.length === 0) {
      const clientSecret = generateClientSecret();
      
      await db.insert(oauthClients).values({
        clientId: client.clientId,
        clientSecret,
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

      createdSecrets.push({ clientId: client.clientId, clientSecret });
      
      // SEGURANÇA: Logar apenas prefixo do secret (Regra 6)
      logger.info(
        { clientId: client.clientId, secretPrefix: clientSecret.substring(0, 8) + "..." },
        "Cliente OAuth criado"
      );
    } else {
      logger.info({ clientId: client.clientId }, "Cliente OAuth já existe, pulando");
    }
  }

  // SEGURANÇA: Salvar secrets em arquivo seguro em vez de stdout
  if (createdSecrets.length > 0) {
    const secretsFile = await saveSecretsToFile(createdSecrets);
    logger.info({ secretsFile, count: createdSecrets.length }, 
      "Secrets OAuth salvos em arquivo seguro (chmod 600). Copie e delete o arquivo após uso.");
  }

  logger.info("Seed de clientes OAuth concluído");
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

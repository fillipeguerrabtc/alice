/**
 * Script para criar webhooks Stripe via API
 * Documentação oficial: https://docs.stripe.com/api/webhook_endpoints/create
 * Regra #11: Seguir documentação oficial Stripe 2025
 * Regra #6: PROIBIDO URLs hardcoded
 */

import Stripe from 'stripe';
import pino from 'pino';

// Logger Pino (Regra 8 - Qualidade Obrigatória)
const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// SEGURANÇA: Função para obter variável de ambiente obrigatória (Regra 6)
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error({ variable: name }, 'Variável de ambiente obrigatória não definida');
    throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  }
  return value;
}

// SEGURANÇA: Salvar secrets em arquivo seguro (Regra 6)
async function saveWebhookSecretsToFile(secrets: { id: string; url: string; secret: string; type: string }[]): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  
  const secretsDir = path.join(os.tmpdir(), 'alice-secrets');
  await fs.mkdir(secretsDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const secretsFile = path.join(secretsDir, `stripe-webhook-secrets-${timestamp}.txt`);
  
  const content = secrets.map(s => 
    `# ${s.type}\nWEBHOOK_ID=${s.id}\nWEBHOOK_URL=${s.url}\nWEBHOOK_SECRET=${s.secret}\n`
  ).join('\n');
  
  await fs.writeFile(secretsFile, content, { mode: 0o600 });
  
  return secretsFile;
}

async function createWebhooks() {
  const secretKey = getRequiredEnvVar('STRIPE_SECRET_KEY');
  
  // REGRA 6: URL base OBRIGATÓRIA via variável de ambiente (proibido hardcoded)
  const baseUrl = getRequiredEnvVar('STRIPE_WEBHOOK_BASE_URL');

  const stripe = new Stripe(secretKey, {
    apiVersion: '2025-04-30.basil' as Stripe.LatestApiVersion,
  });

  logger.info('='.repeat(60));
  logger.info('CRIANDO WEBHOOKS STRIPE VIA API');
  logger.info('='.repeat(60));
  logger.info({ baseUrl }, 'URL Base configurada');

  const createdSecrets: { id: string; url: string; secret: string; type: string }[] = [];

  try {
    // Primeiro, listar e deletar webhooks existentes para evitar duplicatas
    logger.info('Verificando webhooks existentes...');
    const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
    
    for (const webhook of existingWebhooks.data) {
      if (webhook.url.includes(baseUrl)) {
        logger.info({ webhookId: webhook.id, url: webhook.url }, 'Deletando webhook existente');
        await stripe.webhookEndpoints.del(webhook.id);
      }
    }

    // Webhook 1: Account (Sua conta) - Todos os eventos da plataforma
    logger.info('Criando Webhook 1: Account (Sua conta)...');
    const accountWebhook = await stripe.webhookEndpoints.create({
      url: `${baseUrl}/api/stripe/webhook`,
      enabled_events: ['*'],
      description: 'Alice - Account Webhook (Plataforma)',
      api_version: '2025-04-30.basil',
    });

    createdSecrets.push({
      id: accountWebhook.id,
      url: accountWebhook.url,
      secret: accountWebhook.secret || '',
      type: 'STRIPE_WEBHOOK_SECRET (Account)',
    });

    // SEGURANÇA: Logar apenas ID e URL (não o secret)
    logger.info({ webhookId: accountWebhook.id, url: accountWebhook.url }, 'Webhook Account criado com sucesso');

    // Webhook 2: Connect (Contas conectadas) - Todos os eventos das contas conectadas
    logger.info('Criando Webhook 2: Connect (Contas conectadas)...');
    const connectWebhook = await stripe.webhookEndpoints.create({
      url: `${baseUrl}/api/stripe/connect/webhook`,
      enabled_events: ['*'],
      connect: true,
      description: 'Alice - Connect Webhook (Contas Conectadas)',
      api_version: '2025-04-30.basil',
    });

    createdSecrets.push({
      id: connectWebhook.id,
      url: connectWebhook.url,
      secret: connectWebhook.secret || '',
      type: 'STRIPE_CONNECT_WEBHOOK_SECRET (Connect)',
    });

    // SEGURANÇA: Logar apenas ID e URL (não o secret)
    logger.info({ webhookId: connectWebhook.id, url: connectWebhook.url }, 'Webhook Connect criado com sucesso');

    // SEGURANÇA: Salvar secrets em arquivo seguro (chmod 600)
    if (createdSecrets.length > 0) {
      const secretsFile = await saveWebhookSecretsToFile(createdSecrets);
      logger.info('='.repeat(60));
      logger.info('WEBHOOKS CRIADOS COM SUCESSO!');
      logger.info('='.repeat(60));
      logger.info({ secretsFile, count: createdSecrets.length },
        'Secrets dos webhooks salvos em arquivo seguro (chmod 600). Copie e delete o arquivo após uso.');
      logger.info('Configure as variáveis de ambiente STRIPE_WEBHOOK_SECRET e STRIPE_CONNECT_WEBHOOK_SECRET.');
    }

    // Verificar webhooks criados (sem expor secrets)
    logger.info('Webhooks atualmente configurados:');
    const allWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const wh of allWebhooks.data) {
      const webhookData = wh as Record<string, unknown>;
      logger.info({ id: wh.id, url: wh.url, connect: webhookData.connect || false }, 'Webhook ativo');
    }

  } catch (error) {
    logger.error({ error }, 'ERRO ao criar webhooks');
    process.exit(1);
  }
}

createWebhooks();

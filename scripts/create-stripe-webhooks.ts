// Script para criar webhooks Stripe via API
// Documentação oficial: https://docs.stripe.com/api/webhook_endpoints/create
// Regra #11: Seguir documentação oficial Stripe 2025

import Stripe from 'stripe';

async function createWebhooks() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  
  if (!secretKey) {
    console.error('ERRO: STRIPE_SECRET_KEY não configurada');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2025-04-30.basil' as Stripe.LatestApiVersion,
  });

  // URL base do ambiente atual (Replit DEV)
  const baseUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : 'https://4cf47ad7-6fef-478f-a697-c2116cce81b9-00-2p4pght3fawuu.spock.replit.dev';

  console.log('='.repeat(60));
  console.log('CRIANDO WEBHOOKS STRIPE VIA API');
  console.log('='.repeat(60));
  console.log(`URL Base: ${baseUrl}`);
  console.log('');

  try {
    // Primeiro, listar e deletar webhooks existentes para evitar duplicatas
    console.log('Verificando webhooks existentes...');
    const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
    
    for (const webhook of existingWebhooks.data) {
      if (webhook.url.includes(baseUrl) || webhook.url.includes('replit.dev')) {
        console.log(`Deletando webhook existente: ${webhook.id} (${webhook.url})`);
        await stripe.webhookEndpoints.del(webhook.id);
      }
    }
    console.log('');

    // Webhook 1: Account (Sua conta) - Todos os eventos da plataforma
    console.log('Criando Webhook 1: Account (Sua conta)...');
    const accountWebhook = await stripe.webhookEndpoints.create({
      url: `${baseUrl}/api/stripe/webhook`,
      enabled_events: ['*'], // Todos os eventos
      description: 'Alice DEV - Account Webhook (Plataforma)',
      api_version: '2025-04-30.basil',
    });

    console.log('✅ Webhook Account criado com sucesso!');
    console.log(`   ID: ${accountWebhook.id}`);
    console.log(`   URL: ${accountWebhook.url}`);
    console.log(`   SECRET: ${accountWebhook.secret}`);
    console.log('');

    // Webhook 2: Connect (Contas conectadas) - Todos os eventos das contas conectadas
    console.log('Criando Webhook 2: Connect (Contas conectadas)...');
    const connectWebhook = await stripe.webhookEndpoints.create({
      url: `${baseUrl}/api/stripe/connect/webhook`,
      enabled_events: ['*'], // Todos os eventos
      connect: true, // IMPORTANTE: Receber eventos de contas conectadas
      description: 'Alice DEV - Connect Webhook (Contas Conectadas)',
      api_version: '2025-04-30.basil',
    });

    console.log('✅ Webhook Connect criado com sucesso!');
    console.log(`   ID: ${connectWebhook.id}`);
    console.log(`   URL: ${connectWebhook.url}`);
    console.log(`   SECRET: ${connectWebhook.secret}`);
    console.log('');

    // Resumo final
    console.log('='.repeat(60));
    console.log('WEBHOOKS CRIADOS COM SUCESSO!');
    console.log('='.repeat(60));
    console.log('');
    console.log('⚠️  IMPORTANTE: Adicione os seguintes secrets no Replit:');
    console.log('');
    console.log(`STRIPE_WEBHOOK_SECRET=${accountWebhook.secret}`);
    console.log('');
    console.log(`STRIPE_CONNECT_WEBHOOK_SECRET=${connectWebhook.secret}`);
    console.log('');
    console.log('='.repeat(60));

    // Verificar webhooks criados
    console.log('');
    console.log('Webhooks atualmente configurados:');
    const allWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const wh of allWebhooks.data) {
      const webhookData = wh as Record<string, unknown>;
      console.log(`- ${wh.id}: ${wh.url} (connect=${webhookData.connect || false})`);
    }

  } catch (error) {
    console.error('ERRO ao criar webhooks:', error);
    process.exit(1);
  }
}

createWebhooks();

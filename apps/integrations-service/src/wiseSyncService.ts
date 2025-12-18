/**
 * Wise-ERPNext Sync Service - Alice Enterprise Platform
 * 
 * Sincronização evento-driven entre Wise e ERPNext.
 * Implementa reconciliação com detecção de divergências.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { eq, and, lt, desc } from '@alice/database';
import { schema, type Database } from '@alice/database';
import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

// Logger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('wise-sync');

const ERPNEXT_URL = process.env.ERPNEXT_URL;
const ERPNEXT_API_KEY = process.env.ERPNEXT_API_KEY;
const ERPNEXT_API_SECRET = process.env.ERPNEXT_API_SECRET;

type DbClient = Database;
type WiseSyncLogRow = typeof schema.wiseSyncLog.$inferSelect;
let db: DbClient;

export function initWiseSyncService(dbClient: DbClient): void {
  db = dbClient;
  logger.info('Wise sync service inicializado com conexão compartilhada');
}

// ============================================================================
// TYPES
// ============================================================================

interface WiseTransfer {
  id: string;
  reference: string;
  status: string;
  sourceCurrency: string;
  sourceAmount: number;
  targetCurrency: string;
  targetAmount: number;
  rate: number;
  created: string;
  customerTransactionId?: string;
  details?: {
    reference?: string;
  };
}

interface ERPNextPayment {
  name: string;
  doctype: string;
  paid_amount: number;
  paid_from_account_currency: string;
  received_amount?: number;
  paid_to_account_currency?: string;
  reference_no?: string;
  status: string;
}

interface SyncResult {
  success: boolean;
  wiseTransferId: string;
  erpnextPaymentId?: string;
  status: 'synced' | 'failed' | 'manual_review';
  divergence?: number;
  error?: string;
}

// ============================================================================
// CIRCUIT BREAKERS (Regra 16 - Best Practices 2025)
// ============================================================================

// Usa CIRCUIT_BREAKER_PRESETS.erpnext centralizado (Regra 2 - Não Duplicar)

const _wiseBreakerOptions = {
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 3,
};

// Timeout padrão para chamadas ERPNext (10 segundos - Best Practices 2025)
const ERPNEXT_FETCH_TIMEOUT = 10000;

async function fetchERPNextPaymentInternal(reference: string): Promise<ERPNextPayment | null> {
  if (!ERPNEXT_URL || !ERPNEXT_API_KEY || !ERPNEXT_API_SECRET) {
    throw new Error('ERPNext não configurado (ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET)');
  }

  // SEGURANÇA: AbortController com timeout para prevenir requisições penduradas (Regra 16)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ERPNEXT_FETCH_TIMEOUT);

  try {
    const response = await fetch(
      `${ERPNEXT_URL}/api/resource/Payment Entry?filters=[["reference_no","=","${reference}"]]`,
      {
        headers: {
          'Authorization': `token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Erro ao buscar pagamento no ERPNext: ${response.statusText}`);
    }

    const data = await response.json() as { data: ERPNextPayment[] };
    return data.data[0] || null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createERPNextPaymentInternal(transfer: WiseTransfer): Promise<string> {
  if (!ERPNEXT_URL || !ERPNEXT_API_KEY || !ERPNEXT_API_SECRET) {
    throw new Error('ERPNext não configurado (ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET)');
  }

  // SEGURANÇA: AbortController com timeout para prevenir requisições penduradas (Regra 16)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ERPNEXT_FETCH_TIMEOUT);

  try {
    const response = await fetch(`${ERPNEXT_URL}/api/resource/Payment Entry`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        doctype: 'Payment Entry',
        payment_type: 'Pay',
        mode_of_payment: 'Wire Transfer',
        paid_amount: transfer.sourceAmount,
        paid_from_account_currency: transfer.sourceCurrency,
        received_amount: transfer.targetAmount,
        paid_to_account_currency: transfer.targetCurrency,
        reference_no: transfer.id,
        reference_date: transfer.created.split('T')[0],
        remarks: `Wise Transfer: ${transfer.reference || transfer.id}`,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Erro ao criar pagamento no ERPNext: ${error}`);
    }

    const data = await response.json() as { data: { name: string } };
    return data.data.name;
  } finally {
    clearTimeout(timeoutId);
  }
}

const erpnextFetchBreaker = createCircuitBreaker(fetchERPNextPaymentInternal, {
  name: 'erpnext-fetch-payment',
  ...CIRCUIT_BREAKER_PRESETS.erpnextAPI,
});
const erpnextCreateBreaker = createCircuitBreaker(createERPNextPaymentInternal, {
  name: 'erpnext-create-payment',
  ...CIRCUIT_BREAKER_PRESETS.erpnextAPI,
});

// ============================================================================
// SYNC LOGIC
// ============================================================================

/**
 * Sincroniza uma transferência Wise com ERPNext
 */
export async function syncWiseTransfer(transfer: WiseTransfer, tenantId?: string): Promise<SyncResult> {
  const reference = transfer.customerTransactionId || transfer.id;
  
  try {
    let syncLog = await db.query.wiseSyncLog.findFirst({
      where: eq(schema.wiseSyncLog.wiseTransferId, transfer.id),
    });

    if (!syncLog) {
      [syncLog] = await db.insert(schema.wiseSyncLog).values({
        tenantId,
        wiseTransferId: transfer.id,
        status: 'pending',
        wiseAmount: transfer.sourceAmount,
        wiseCurrency: transfer.sourceCurrency,
        syncAttempts: 0,
        metadata: {
          reference: transfer.reference,
          targetAmount: transfer.targetAmount,
          targetCurrency: transfer.targetCurrency,
          rate: transfer.rate,
          created: transfer.created,
        },
      }).returning();
    }

    await db.update(schema.wiseSyncLog)
      .set({
        syncAttempts: (syncLog.syncAttempts || 0) + 1,
        lastSyncAttempt: new Date(),
      })
      .where(eq(schema.wiseSyncLog.id, syncLog.id));

    let existingPayment: ERPNextPayment | null = null;
    try {
      existingPayment = await erpnextFetchBreaker.fire(reference) as ERPNextPayment | null;
    } catch (error) {
      logger.warn({ error, reference }, 'Erro ao buscar pagamento existente');
    }

    if (existingPayment) {
      const divergence = Math.abs(existingPayment.paid_amount - transfer.sourceAmount);
      const divergencePercent = (divergence / transfer.sourceAmount) * 100;

      if (divergencePercent > 0.01) {
        await db.update(schema.wiseSyncLog)
          .set({
            status: 'manual_review',
            erpnextPaymentId: existingPayment.name,
            erpnextAmount: existingPayment.paid_amount,
            erpnextCurrency: existingPayment.paid_from_account_currency,
            amountDivergence: divergence,
            lastError: `Divergência de ${divergencePercent.toFixed(2)}%`,
          })
          .where(eq(schema.wiseSyncLog.id, syncLog.id));

        logger.warn({
          wiseTransferId: transfer.id,
          divergence,
          divergencePercent,
        }, 'Divergência detectada - requer revisão manual');

        return {
          success: false,
          wiseTransferId: transfer.id,
          erpnextPaymentId: existingPayment.name,
          status: 'manual_review',
          divergence,
        };
      }

      await db.update(schema.wiseSyncLog)
        .set({
          status: 'synced',
          erpnextPaymentId: existingPayment.name,
          erpnextAmount: existingPayment.paid_amount,
          erpnextCurrency: existingPayment.paid_from_account_currency,
          sincronizadoEm: new Date(),
        })
        .where(eq(schema.wiseSyncLog.id, syncLog.id));

      return {
        success: true,
        wiseTransferId: transfer.id,
        erpnextPaymentId: existingPayment.name,
        status: 'synced',
      };
    }

    const erpnextPaymentId = await erpnextCreateBreaker.fire(transfer) as string;

    await db.update(schema.wiseSyncLog)
      .set({
        status: 'synced',
        erpnextPaymentId,
        erpnextAmount: transfer.sourceAmount,
        erpnextCurrency: transfer.sourceCurrency,
        sincronizadoEm: new Date(),
      })
      .where(eq(schema.wiseSyncLog.id, syncLog.id));

    logger.info({
      wiseTransferId: transfer.id,
      erpnextPaymentId,
    }, 'Transferência sincronizada com sucesso');

    return {
      success: true,
      wiseTransferId: transfer.id,
      erpnextPaymentId,
      status: 'synced',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    
    await db.update(schema.wiseSyncLog)
      .set({
        status: 'failed',
        lastError: errorMessage,
      })
      .where(eq(schema.wiseSyncLog.wiseTransferId, transfer.id));

    logger.error({ error, wiseTransferId: transfer.id }, 'Erro ao sincronizar transferência');

    return {
      success: false,
      wiseTransferId: transfer.id,
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Reprocessa transferências com falha
 */
export async function retryFailedSyncs(maxRetries = 3): Promise<number> {
  const failedSyncs = await db.query.wiseSyncLog.findMany({
    where: and(
      eq(schema.wiseSyncLog.status, 'failed'),
      lt(schema.wiseSyncLog.syncAttempts, maxRetries)
    ),
  });

  let successCount = 0;

  for (const syncLog of failedSyncs) {
    const metadata = syncLog.metadata as Record<string, unknown>;
    
    const transfer: WiseTransfer = {
      id: syncLog.wiseTransferId,
      reference: metadata.reference as string,
      status: 'completed',
      sourceCurrency: syncLog.wiseCurrency || 'EUR',
      sourceAmount: syncLog.wiseAmount || 0,
      targetCurrency: metadata.targetCurrency as string || 'EUR',
      targetAmount: metadata.targetAmount as number || 0,
      rate: metadata.rate as number || 1,
      created: metadata.created as string || new Date().toISOString(),
    };

    const result = await syncWiseTransfer(transfer, syncLog.tenantId || undefined);
    
    if (result.success) {
      successCount++;
    }
  }

  logger.info({
    total: failedSyncs.length,
    success: successCount,
  }, 'Retry de sincronizações concluído');

  return successCount;
}

/**
 * Lista transferências pendentes de revisão manual
 */
export async function getPendingReviews() {
  return db.query.wiseSyncLog.findMany({
    where: eq(schema.wiseSyncLog.status, 'manual_review'),
    orderBy: [desc(schema.wiseSyncLog.criadoEm)],
  });
}

/**
 * Aprova uma sincronização com divergência (revisão manual)
 */
export async function approveWithDivergence(
  syncLogId: string,
  approvedBy: string,
  notes?: string
): Promise<void> {
  await db.update(schema.wiseSyncLog)
    .set({
      status: 'synced',
      sincronizadoEm: new Date(),
      metadata: {
        approvedBy,
        approvedAt: new Date().toISOString(),
        notes,
      },
    })
    .where(eq(schema.wiseSyncLog.id, syncLogId));

  logger.info({ syncLogId, approvedBy, notes }, 'Sincronização aprovada manualmente');
}

/**
 * Retorna estatísticas de sincronização
 */
export async function getSyncStats() {
  const logs = await db.query.wiseSyncLog.findMany();

  return {
    total: logs.length,
    synced: logs.filter((l: WiseSyncLogRow) => l.status === 'synced').length,
    failed: logs.filter((l: WiseSyncLogRow) => l.status === 'failed').length,
    pending: logs.filter((l: WiseSyncLogRow) => l.status === 'pending').length,
    manualReview: logs.filter((l: WiseSyncLogRow) => l.status === 'manual_review').length,
    retrying: logs.filter((l: WiseSyncLogRow) => l.status === 'retrying').length,
  };
}

/**
 * Webhook handler para eventos Wise
 */
export async function handleWiseWebhook(
  event: {
    event_type: string;
    data: WiseTransfer;
  },
  tenantId?: string
): Promise<SyncResult | null> {
  if (event.event_type !== 'transfers#state-change') {
    logger.debug({ eventType: event.event_type }, 'Evento Wise ignorado');
    return null;
  }

  if (event.data.status !== 'outgoing_payment_sent') {
    logger.debug({ status: event.data.status }, 'Status de transferência não requer sync');
    return null;
  }

  logger.info({
    transferId: event.data.id,
    status: event.data.status,
  }, 'Processando webhook Wise');

  return syncWiseTransfer(event.data, tenantId);
}

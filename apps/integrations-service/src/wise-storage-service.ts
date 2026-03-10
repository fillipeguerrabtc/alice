import { getDatabase, schema } from '@alice/database';

export async function upsertWiseProfiles(
  tenantId: string,
  profiles: Array<{ id: number; type?: string; details?: unknown }>
): Promise<void> {
  if (!profiles.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const profile of profiles) {
    await db.insert(schema.wiseProfiles).values({
      tenantId,
      wiseProfileId: profile.id,
      type: profile.type ?? null,
      details: (profile.details ?? {}) as Record<string, unknown>,
      data: profile as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseProfiles.tenantId, schema.wiseProfiles.wiseProfileId],
      set: {
        type: profile.type ?? null,
        details: (profile.details ?? {}) as Record<string, unknown>,
        data: profile as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseUsers(
  tenantId: string,
  users: Array<{ id: number; email?: string; name?: string; active?: boolean }>
): Promise<void> {
  if (!users.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const user of users) {
    await db.insert(schema.wiseUsers).values({
      tenantId,
      wiseUserId: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      active: user.active ?? true,
      data: user as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseUsers.tenantId, schema.wiseUsers.wiseUserId],
      set: {
        email: user.email ?? null,
        name: user.name ?? null,
        active: user.active ?? true,
        data: user as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseBalances(
  tenantId: string,
  balances: Array<{
    id: number;
    currency: string;
    type?: string;
    name?: string | null;
    amount?: unknown;
    reservedAmount?: unknown;
    totalWorth?: unknown;
  }>
): Promise<void> {
  if (!balances.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const balance of balances) {
    await db.insert(schema.wiseBalances).values({
      tenantId,
      wiseBalanceId: balance.id,
      currency: balance.currency,
      type: balance.type ?? null,
      name: balance.name ?? null,
      amount: balance.amount as Record<string, unknown> | undefined,
      reservedAmount: balance.reservedAmount as Record<string, unknown> | undefined,
      totalWorth: balance.totalWorth as Record<string, unknown> | undefined,
      data: balance as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseBalances.tenantId, schema.wiseBalances.wiseBalanceId],
      set: {
        currency: balance.currency,
        type: balance.type ?? null,
        name: balance.name ?? null,
        amount: balance.amount as Record<string, unknown> | undefined,
        reservedAmount: balance.reservedAmount as Record<string, unknown> | undefined,
        totalWorth: balance.totalWorth as Record<string, unknown> | undefined,
        data: balance as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseRecipients(
  tenantId: string,
  recipients: Array<{
    id: number;
    currency?: string;
    type?: string;
    accountHolderName?: string;
    active?: boolean;
  }>
): Promise<void> {
  if (!recipients.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const recipient of recipients) {
    await db.insert(schema.wiseRecipients).values({
      tenantId,
      wiseRecipientId: recipient.id,
      currency: recipient.currency ?? null,
      type: recipient.type ?? null,
      accountHolderName: recipient.accountHolderName ?? null,
      active: recipient.active ?? true,
      data: recipient as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseRecipients.tenantId, schema.wiseRecipients.wiseRecipientId],
      set: {
        currency: recipient.currency ?? null,
        type: recipient.type ?? null,
        accountHolderName: recipient.accountHolderName ?? null,
        active: recipient.active ?? true,
        data: recipient as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseQuotes(
  tenantId: string,
  quote: {
    id: string;
    sourceCurrency?: string;
    targetCurrency?: string;
    sourceAmount?: number;
    targetAmount?: number;
    rate?: number;
    fee?: number;
  }
): Promise<void> {
  const db = getDatabase();
  await db.insert(schema.wiseQuotes).values({
    tenantId,
    wiseQuoteId: quote.id,
    sourceCurrency: quote.sourceCurrency ?? null,
    targetCurrency: quote.targetCurrency ?? null,
    sourceAmount: quote.sourceAmount ?? null,
    targetAmount: quote.targetAmount ?? null,
    rate: quote.rate ?? null,
    fee: quote.fee ?? null,
    data: quote as Record<string, unknown>,
  }).onConflictDoUpdate({
    target: [schema.wiseQuotes.tenantId, schema.wiseQuotes.wiseQuoteId],
    set: {
      sourceCurrency: quote.sourceCurrency ?? null,
      targetCurrency: quote.targetCurrency ?? null,
      sourceAmount: quote.sourceAmount ?? null,
      targetAmount: quote.targetAmount ?? null,
      rate: quote.rate ?? null,
      fee: quote.fee ?? null,
      data: quote as Record<string, unknown>,
    },
  });
}

export async function upsertWiseTransfers(
  tenantId: string,
  transfers: Array<{
    id: number;
    status?: string;
    sourceCurrency?: string;
    targetCurrency?: string;
    sourceAmount?: number;
    targetAmount?: number;
    customerTransactionId?: string;
  }>
): Promise<void> {
  if (!transfers.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const transfer of transfers) {
    await db.insert(schema.wiseTransfers).values({
      tenantId,
      wiseTransferId: transfer.id,
      status: transfer.status ?? null,
      sourceCurrency: transfer.sourceCurrency ?? null,
      targetCurrency: transfer.targetCurrency ?? null,
      sourceValue: transfer.sourceAmount ?? null,
      targetValue: transfer.targetAmount ?? null,
      customerTransactionId: transfer.customerTransactionId ?? null,
      data: transfer as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseTransfers.tenantId, schema.wiseTransfers.wiseTransferId],
      set: {
        status: transfer.status ?? null,
        sourceCurrency: transfer.sourceCurrency ?? null,
        targetCurrency: transfer.targetCurrency ?? null,
        sourceValue: transfer.sourceAmount ?? null,
        targetValue: transfer.targetAmount ?? null,
        customerTransactionId: transfer.customerTransactionId ?? null,
        data: transfer as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseCards(
  tenantId: string,
  cards: Array<{ token?: string; cardToken?: string; status?: string; type?: string }>
): Promise<void> {
  if (!cards.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const card of cards) {
    const cardToken = card.token ?? card.cardToken;
    if (!cardToken) continue;
    await db.insert(schema.wiseCards).values({
      tenantId,
      wiseCardToken: cardToken,
      status: card.status ?? null,
      type: card.type ?? null,
      data: card as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseCards.tenantId, schema.wiseCards.wiseCardToken],
      set: {
        status: card.status ?? null,
        type: card.type ?? null,
        data: card as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseCardOrders(
  tenantId: string,
  cardOrders: Array<{ id?: string; orderId?: string; status?: string; type?: string }>
): Promise<void> {
  if (!cardOrders.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const order of cardOrders) {
    const cardOrderId = order.id ?? order.orderId;
    if (!cardOrderId) continue;
    await db.insert(schema.wiseCardOrders).values({
      tenantId,
      wiseCardOrderId: cardOrderId,
      status: order.status ?? null,
      type: order.type ?? null,
      data: order as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseCardOrders.tenantId, schema.wiseCardOrders.wiseCardOrderId],
      set: {
        status: order.status ?? null,
        type: order.type ?? null,
        data: order as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseCardTransactions(
  tenantId: string,
  transactions: Array<{
    id?: string;
    transactionId?: string;
    cardToken?: string;
    status?: string;
    amount?: unknown;
    occurredAt?: string;
  }>
): Promise<void> {
  if (!transactions.length) return;
  const db = getDatabase();
  for (const transaction of transactions) {
    const transactionId = transaction.id ?? transaction.transactionId;
    if (!transactionId) continue;
    await db.insert(schema.wiseCardTransactions).values({
      tenantId,
      wiseTransactionId: transactionId,
      wiseCardToken: transaction.cardToken ?? null,
      status: transaction.status ?? null,
      amount: transaction.amount as Record<string, unknown> | undefined,
      occurredAt: transaction.occurredAt ? new Date(transaction.occurredAt) : null,
      data: transaction as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseCardTransactions.tenantId, schema.wiseCardTransactions.wiseTransactionId],
      set: {
        wiseCardToken: transaction.cardToken ?? null,
        status: transaction.status ?? null,
        amount: transaction.amount as Record<string, unknown> | undefined,
        occurredAt: transaction.occurredAt ? new Date(transaction.occurredAt) : null,
        data: transaction as Record<string, unknown>,
      },
    });
  }
}

export async function upsertWiseSpendControls(
  tenantId: string,
  rules: Array<{
    id?: number;
    ruleId?: number;
    type?: string;
    operation?: string;
    description?: string;
    values?: unknown;
  }>
): Promise<void> {
  if (!rules.length) return;
  const db = getDatabase();
  for (const rule of rules) {
    const ruleId = rule.id ?? rule.ruleId;
    if (!ruleId) continue;
    await db.insert(schema.wiseSpendControls).values({
      tenantId,
      wiseRuleId: ruleId,
      type: rule.type ?? null,
      operation: rule.operation ?? null,
      description: rule.description ?? null,
      values: rule.values as Record<string, unknown> | undefined,
      data: rule as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseSpendControls.tenantId, schema.wiseSpendControls.wiseRuleId],
      set: {
        type: rule.type ?? null,
        operation: rule.operation ?? null,
        description: rule.description ?? null,
        values: rule.values as Record<string, unknown> | undefined,
        data: rule as Record<string, unknown>,
      },
    });
  }
}

export async function upsertWiseDisputes(
  tenantId: string,
  disputes: Array<{ id?: string; disputeId?: string; status?: string }>
): Promise<void> {
  if (!disputes.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const dispute of disputes) {
    const disputeId = dispute.id ?? dispute.disputeId;
    if (!disputeId) continue;
    await db.insert(schema.wiseDisputes).values({
      tenantId,
      wiseDisputeId: disputeId,
      status: dispute.status ?? null,
      data: dispute as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseDisputes.tenantId, schema.wiseDisputes.wiseDisputeId],
      set: {
        status: dispute.status ?? null,
        data: dispute as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseActivities(
  tenantId: string,
  activities: Array<{ id?: string; resourceType?: string; status?: string; occurredAt?: string }>
): Promise<void> {
  if (!activities.length) return;
  const db = getDatabase();
  for (const activity of activities) {
    await db.insert(schema.wiseActivities).values({
      tenantId,
      wiseActivityId: activity.id ?? null,
      resourceType: activity.resourceType ?? null,
      status: activity.status ?? null,
      occurredAt: activity.occurredAt ? new Date(activity.occurredAt) : null,
      data: activity as Record<string, unknown>,
    }).onConflictDoNothing();
  }
}

export async function upsertWiseKycReviews(
  tenantId: string,
  reviews: Array<{ id?: string; kycReviewId?: string; status?: string; link?: string; requiredBy?: string }>
): Promise<void> {
  if (!reviews.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const review of reviews) {
    const reviewId = review.id ?? review.kycReviewId;
    if (!reviewId) continue;
    await db.insert(schema.wiseKycReviews).values({
      tenantId,
      wiseKycReviewId: reviewId,
      status: review.status ?? null,
      linkUrl: review.link ?? null,
      requiredBy: review.requiredBy ? new Date(review.requiredBy) : null,
      data: review as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseKycReviews.tenantId, schema.wiseKycReviews.wiseKycReviewId],
      set: {
        status: review.status ?? null,
        linkUrl: review.link ?? null,
        requiredBy: review.requiredBy ? new Date(review.requiredBy) : null,
        data: review as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

export async function upsertWiseWebhookSubscriptions(
  tenantId: string,
  subscriptions: Array<{
    id?: string;
    subscriptionId?: string;
    scopeDomain?: string;
    scopeId?: string;
    triggerOn?: string;
    delivery?: { url?: string; version?: string };
  }>
): Promise<void> {
  if (!subscriptions.length) return;
  const db = getDatabase();
  for (const sub of subscriptions) {
    const subscriptionId = sub.id ?? sub.subscriptionId;
    if (!subscriptionId) continue;
    await db.insert(schema.wiseWebhookSubscriptions).values({
      tenantId,
      wiseSubscriptionId: subscriptionId,
      scopeDomain: sub.scopeDomain ?? null,
      scopeId: sub.scopeId ?? null,
      triggerOn: sub.triggerOn ?? null,
      deliveryUrl: sub.delivery?.url ?? null,
      deliveryVersion: sub.delivery?.version ?? null,
      data: sub as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseWebhookSubscriptions.tenantId, schema.wiseWebhookSubscriptions.wiseSubscriptionId],
      set: {
        scopeDomain: sub.scopeDomain ?? null,
        scopeId: sub.scopeId ?? null,
        triggerOn: sub.triggerOn ?? null,
        deliveryUrl: sub.delivery?.url ?? null,
        deliveryVersion: sub.delivery?.version ?? null,
        data: sub as Record<string, unknown>,
      },
    });
  }
}

export async function insertWiseWebhookEvent(params: {
  tenantId?: string | null;
  deliveryId?: string;
  subscriptionId?: string;
  eventType?: string;
  schemaVersion?: string;
  sentAt?: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}): Promise<void> {
  const db = getDatabase();
  await db.insert(schema.wiseWebhookEvents).values({
    tenantId: params.tenantId ?? null,
    deliveryId: params.deliveryId ?? null,
    subscriptionId: params.subscriptionId ?? null,
    eventType: params.eventType ?? null,
    schemaVersion: params.schemaVersion ?? null,
    sentAt: params.sentAt ? new Date(params.sentAt) : null,
    signatureValid: params.signatureValid,
    payload: params.payload,
  });
}

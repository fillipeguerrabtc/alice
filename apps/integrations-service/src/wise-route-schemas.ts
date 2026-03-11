import { z } from 'zod';

// Schema para ID numérico positivo (Wise recipient/transfer IDs)
export const numericIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID deve ser numérico').transform(Number).refine((n) => n > 0, 'ID deve ser positivo'),
});

export const balanceIdParamSchema = z.object({
  balanceId: z.string().regex(/^\d+$/, 'balanceId deve ser numérico').transform(Number).refine((n) => n > 0, 'balanceId deve ser positivo'),
});

// Schema para query params de paginação
export const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine((n) => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine((n) => n >= 0, 'offset deve ser >= 0').optional(),
});

// OWASP API3: Schemas para validação de query params Wise
// Previne injection e garante tipos corretos

// Schema para taxas de câmbio (source/target currencies)
export const wiseRatesQuerySchema = z.object({
  source: z.string()
    .min(3, 'source deve ter 3 caracteres')
    .max(3, 'source deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'source deve ser código de moeda válido (ex: USD, EUR, BRL)'),
  target: z.string()
    .min(3, 'target deve ter 3 caracteres')
    .max(3, 'target deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'target deve ser código de moeda válido (ex: USD, EUR, BRL)'),
});

// Schema para filtro de destinatários por moeda (opcional)
export const wiseRecipientsQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido')
    .optional(),
});

export const wiseBalancesQuerySchema = z.object({
  types: z.string()
    .regex(/^[A-Z,]+$/, 'types deve conter apenas letras e vírgulas')
    .optional(),
});

export const wiseBalanceCreateSchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
  type: z.enum(['STANDARD', 'SAVINGS']),
  name: z.string().min(1).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'SAVINGS' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name é obrigatório para saldo SAVINGS', path: ['name'] });
  }
});

export const wiseBalanceStatementQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
  intervalStart: z.string().min(10, 'intervalStart inválido'),
  intervalEnd: z.string().min(10, 'intervalEnd inválido'),
  type: z.enum(['COMPACT', 'FLAT']).optional(),
});

export const wiseBalanceMovementSchema = z.object({
  quoteId: z.string().uuid().optional(),
  sourceBalanceId: z.coerce.number().int().positive().optional(),
  targetBalanceId: z.coerce.number().int().positive().optional(),
  amount: z.object({
    value: z.coerce.number().positive(),
    currency: z.string().min(3).max(3).regex(/^[A-Z]{3}$/),
  }).optional(),
}).superRefine((data, ctx) => {
  const hasQuote = Boolean(data.quoteId);
  const hasAmount = Boolean(data.amount);
  const hasBalances = Boolean(data.sourceBalanceId && data.targetBalanceId);
  if (!hasQuote && !hasAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'quoteId ou amount é obrigatório', path: ['quoteId'] });
  }
  if (hasAmount && !hasBalances) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sourceBalanceId e targetBalanceId são obrigatórios com amount', path: ['sourceBalanceId'] });
  }
});

export const wiseCurrencyQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
});

export const wiseQuoteCreateSchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.coerce.number().positive().optional(),
  targetAmount: z.coerce.number().positive().optional(),
  payOut: z.enum(['BANK_TRANSFER', 'BALANCE', 'SWIFT', 'SWIFT_OUR', 'INTERAC']).optional(),
  preferredPayIn: z.enum(['BANK_TRANSFER', 'BALANCE']).optional(),
  targetAccount: z.coerce.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (!data.sourceAmount && !data.targetAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sourceAmount ou targetAmount é obrigatório', path: ['sourceAmount'] });
  }
  if (data.sourceAmount && data.targetAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe apenas sourceAmount ou targetAmount', path: ['targetAmount'] });
  }
});

// Schema para requisitos de destinatário
export const wiseRecipientRequirementsQuerySchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'sourceAmount deve ser número válido')
    .transform(Number)
    .refine((n) => n > 0, 'sourceAmount deve ser positivo'),
});

export const wiseProfileIdParamSchema = z.object({
  profileId: z.string().regex(/^\d+$/, 'profileId deve ser numérico').transform(Number).refine((n) => n > 0, 'profileId deve ser positivo'),
});

export const wiseCardTokenParamSchema = z.object({
  cardToken: z.string().min(16, 'cardToken inválido').max(128, 'cardToken inválido'),
});

export const wiseDisputeIdParamSchema = z.object({
  disputeId: z.string().min(1).max(128),
});

export const wiseKycReviewIdParamSchema = z.object({
  kycReviewId: z.string().min(1).max(128),
});

export const wiseCardOrderIdParamSchema = z.object({
  cardOrderId: z.string().min(1).max(128),
});

export const wiseTransactionIdParamSchema = z.object({
  transactionId: z.string().min(1).max(128),
});

export const wiseWebhookIdParamSchema = z.object({
  subscriptionId: z.string().min(1).max(128),
});

export const batchGroupIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

export const wiseGenericPayloadSchema = z.object({}).passthrough();

export const wiseJosePayloadSchema = z.object({
  josePayload: z.string().min(20, 'josePayload inválido'),
});

export const wiseFileUploadSchema = z.object({
  fileBase64: z.string().min(100, 'fileBase64 inválido'),
  fileName: z.string().min(1, 'fileName inválido').max(255),
  contentType: z.string().min(3, 'contentType inválido').max(100),
});

export const wiseActivityQuerySchema = z.object({
  profileId: z.string().regex(/^\d+$/).transform(Number).optional(),
  monetaryResourceType: z.string().optional(),
  status: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  size: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export const wiseCardOrdersQuerySchema = z.object({
  pageNumber: z.string().regex(/^\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export const wiseSimulationActionSchema = z.object({
  action: z.string().min(1).max(100),
});

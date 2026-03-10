import { and, desc, eq, isNull, ne } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { z } from 'zod';

const governanceHintsSchema = z.object({
  promptTemplateId: z.string().uuid().optional(),
  promptVersion: z.number().int().positive().optional(),
  toolPolicyKey: z.string().min(1).max(120).optional(),
  toolPolicyVersion: z.number().int().positive().optional(),
  modelVersionId: z.string().uuid().optional(),
});

const namespaceProfileGovernanceSchema = z.object({
  llmGovernance: z.object({
    promptTemplateId: z.string().uuid().optional(),
    promptVersion: z.number().int().positive().optional(),
    toolPolicyKey: z.string().min(1).max(120).optional(),
    toolPolicyVersion: z.number().int().positive().optional(),
    modelVersionId: z.string().uuid().optional(),
  }).optional(),
}).passthrough();

export type GovernanceHints = z.infer<typeof governanceHintsSchema>;

const promptTemplateCreateSchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  promptKey: z.string().min(1).max(128),
  template: z.string().min(1),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().uuid().optional(),
  minApprovals: z.number().int().min(1).max(10).default(1),
  requireDualControl: z.boolean().default(true),
});

const promptTemplateActivateSchema = z.object({
  tenantId: z.string().uuid(),
  approvedBy: z.string().uuid().optional(),
});

const promptTemplateEvaluateSchema = z.object({
  tenantId: z.string().uuid(),
  evaluationStatus: z.enum(['pending', 'passed', 'failed', 'skipped']),
  evaluationScore: z.number().min(0).max(1).optional(),
  evaluationReport: z.record(z.unknown()).optional(),
  evaluatedBy: z.string().uuid().optional(),
});

const promptTemplateApprovalSchema = z.object({
  tenantId: z.string().uuid(),
  approverUserId: z.string().uuid().optional(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

const toolPolicyCreateSchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  policyKey: z.string().min(1).max(120),
  allowTools: z.array(z.string().min(1).max(120)).max(300).default([]),
  denyTools: z.array(z.string().min(1).max(120)).max(300).default([]),
  minApprovals: z.number().int().min(1).max(10).default(1),
  requireDualControl: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().uuid().optional(),
});

const toolPolicyActivateSchema = z.object({
  tenantId: z.string().uuid(),
  approvedBy: z.string().uuid().optional(),
});

const toolPolicyApprovalSchema = z.object({
  tenantId: z.string().uuid(),
  approverUserId: z.string().uuid().optional(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

function coercePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function parseExtraBodyRecord(extraBody: Record<string, unknown> | undefined): GovernanceHints {
  if (!extraBody) {
    return {};
  }

  return governanceHintsSchema.parse({
    promptTemplateId: typeof extraBody.alice_prompt_template_id === 'string' ? extraBody.alice_prompt_template_id : undefined,
    promptVersion: coercePositiveInt(extraBody.alice_prompt_version),
    toolPolicyKey: typeof extraBody.alice_tool_policy_key === 'string' ? extraBody.alice_tool_policy_key : undefined,
    toolPolicyVersion: coercePositiveInt(extraBody.alice_tool_policy_version),
    modelVersionId: typeof extraBody.alice_model_version_id === 'string' ? extraBody.alice_model_version_id : undefined,
  });
}

export function parseGovernanceHints(extraBody: Record<string, unknown> | undefined): GovernanceHints {
  return parseExtraBodyRecord(extraBody);
}

export function mergeGovernanceHints(base: GovernanceHints, overrides: GovernanceHints): GovernanceHints {
  return {
    promptTemplateId: overrides.promptTemplateId ?? base.promptTemplateId,
    promptVersion: overrides.promptVersion ?? base.promptVersion,
    toolPolicyKey: overrides.toolPolicyKey ?? base.toolPolicyKey,
    toolPolicyVersion: overrides.toolPolicyVersion ?? base.toolPolicyVersion,
    modelVersionId: overrides.modelVersionId ?? base.modelVersionId,
  };
}

export async function resolveNamespaceProfileGovernanceDefaults(params: {
  tenantId: string;
  namespaceId?: string | null;
}): Promise<GovernanceHints> {
  if (!params.namespaceId) {
    return {};
  }

  const db = getDatabase();
  const profile = await db.query.namespaceProfiles.findFirst({
    where: and(
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId),
      eq(schema.namespaceProfiles.isActive, true)
    ),
    columns: {
      config: true,
    },
  });

  if (!profile?.config || typeof profile.config !== 'object' || Array.isArray(profile.config)) {
    return {};
  }

  const parsed = namespaceProfileGovernanceSchema.safeParse(profile.config);
  if (!parsed.success) {
    return {};
  }

  return governanceHintsSchema.parse(parsed.data.llmGovernance ?? {});
}

export type ResolvedPromptGovernance = {
  promptTemplateId: string | null;
  promptVersion: number | null;
  toolPolicyKey: string | null;
};

export async function resolvePromptGovernance(params: {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  hints: GovernanceHints;
}): Promise<ResolvedPromptGovernance> {
  if (!params.hints.promptTemplateId) {
    return {
      promptTemplateId: null,
      promptVersion: null,
      toolPolicyKey: params.hints.toolPolicyKey ?? null,
    };
  }

  const db = getDatabase();
  const template = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.id, params.hints.promptTemplateId),
      eq(schema.promptTemplates.tenantId, params.tenantId)
    ),
    columns: {
      id: true,
      tenantId: true,
      namespaceId: true,
      agentId: true,
      version: true,
      status: true,
      metadata: true,
    },
  });

  if (!template) {
    throw new Error('PROMPT_TEMPLATE_NOT_FOUND');
  }

  if (template.status !== 'active') {
    throw new Error('PROMPT_TEMPLATE_NOT_ACTIVE');
  }

  if (params.hints.promptVersion && template.version !== params.hints.promptVersion) {
    throw new Error('PROMPT_TEMPLATE_VERSION_MISMATCH');
  }

  if (template.namespaceId && template.namespaceId !== (params.namespaceId ?? null)) {
    throw new Error('PROMPT_TEMPLATE_SCOPE_NAMESPACE_MISMATCH');
  }

  if (template.agentId && template.agentId !== (params.agentId ?? null)) {
    throw new Error('PROMPT_TEMPLATE_SCOPE_AGENT_MISMATCH');
  }

  const metadata = (template.metadata ?? {}) as Record<string, unknown>;
  const metadataToolPolicyKey = typeof metadata.toolPolicyKey === 'string' ? metadata.toolPolicyKey : null;

  return {
    promptTemplateId: template.id,
    promptVersion: template.version,
    toolPolicyKey: params.hints.toolPolicyKey ?? metadataToolPolicyKey,
  };
}

export type ResolvedToolPolicyGovernance = {
  toolPolicyId: string | null;
  toolPolicyKey: string | null;
  toolPolicyVersion: number | null;
  allowTools: string[];
  denyTools: string[];
};

export type ToolPolicyCandidate = {
  id: string;
  policyKey: string;
  namespaceId: string | null;
  agentId: string | null;
  version: number;
  allowTools: string[];
  denyTools: string[];
  atualizadoEm: Date | null;
};

function sanitizeToolList(input: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of input) {
    const value = raw.trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
  }
  return cleaned;
}

export function selectBestToolPolicyMatch(params: {
  candidates: ToolPolicyCandidate[];
  namespaceId?: string | null;
  agentId?: string | null;
}): ToolPolicyCandidate | null {
  const scored = params.candidates
    .map((candidate) => {
      if (candidate.namespaceId && candidate.namespaceId !== (params.namespaceId ?? null)) {
        return null;
      }
      if (candidate.agentId && candidate.agentId !== (params.agentId ?? null)) {
        return null;
      }
      const specificity = (candidate.namespaceId ? 1 : 0) + (candidate.agentId ? 2 : 0);
      return { candidate, specificity };
    })
    .filter((entry): entry is { candidate: ToolPolicyCandidate; specificity: number } => Boolean(entry))
    .sort((left, right) => {
      if (right.specificity !== left.specificity) {
        return right.specificity - left.specificity;
      }
      if (right.candidate.version !== left.candidate.version) {
        return right.candidate.version - left.candidate.version;
      }
      const rightTime = right.candidate.atualizadoEm?.getTime() ?? 0;
      const leftTime = left.candidate.atualizadoEm?.getTime() ?? 0;
      return rightTime - leftTime;
    });

  return scored[0]?.candidate ?? null;
}

export async function resolveToolPolicyGovernance(params: {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  toolPolicyKey?: string | null;
  toolPolicyVersion?: number | null;
}): Promise<ResolvedToolPolicyGovernance> {
  if (!params.toolPolicyKey) {
    return {
      toolPolicyId: null,
      toolPolicyKey: null,
      toolPolicyVersion: null,
      allowTools: [],
      denyTools: [],
    };
  }

  const db = getDatabase();
  const candidates = await db.query.toolPolicies.findMany({
    where: and(
      eq(schema.toolPolicies.tenantId, params.tenantId),
      eq(schema.toolPolicies.policyKey, params.toolPolicyKey),
      eq(schema.toolPolicies.status, 'active')
    ),
    orderBy: [desc(schema.toolPolicies.version), desc(schema.toolPolicies.atualizadoEm)],
    columns: {
      id: true,
      policyKey: true,
      namespaceId: true,
      agentId: true,
      version: true,
      allowTools: true,
      denyTools: true,
      atualizadoEm: true,
    },
  });

  if (candidates.length === 0) {
    throw new Error('TOOL_POLICY_NOT_FOUND');
  }

  const selected = selectBestToolPolicyMatch({
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      policyKey: candidate.policyKey,
      namespaceId: candidate.namespaceId,
      agentId: candidate.agentId,
      version: candidate.version,
      allowTools: sanitizeToolList(Array.isArray(candidate.allowTools) ? candidate.allowTools : []),
      denyTools: sanitizeToolList(Array.isArray(candidate.denyTools) ? candidate.denyTools : []),
      atualizadoEm: candidate.atualizadoEm,
    })),
    namespaceId: params.namespaceId,
    agentId: params.agentId,
  });

  if (!selected) {
    throw new Error('TOOL_POLICY_SCOPE_MISMATCH');
  }

  if (params.toolPolicyVersion && selected.version !== params.toolPolicyVersion) {
    throw new Error('TOOL_POLICY_VERSION_MISMATCH');
  }

  return {
    toolPolicyId: selected.id,
    toolPolicyKey: selected.policyKey,
    toolPolicyVersion: selected.version,
    allowTools: selected.allowTools,
    denyTools: selected.denyTools,
  };
}

type ModelVersionCandidate = {
  id: string;
  namespaceId: string | null;
  agentId: string | null;
  baseModel: string;
  name: string;
  version: number;
  ativadoEm: Date | null;
};

export type ResolvedModelGovernance = {
  modelVersionId: string | null;
  baseModel: string;
  modelName: string | null;
};

type PromptTemplateApprovalSummary = {
  approvedDistinctUsersCount: number;
  requesterHasApproved: boolean;
  approvals: Array<{
    approverUserId: string;
    decision: 'approved' | 'rejected';
    reason: string | null;
    updatedAt: Date;
  }>;
};

type PromptTemplateActivationGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | 'PROMPT_TEMPLATE_EVAL_NOT_PASSED'
      | 'PROMPT_TEMPLATE_APPROVER_REQUIRED'
      | 'PROMPT_TEMPLATE_DUAL_CONTROL_REQUIRED'
      | 'PROMPT_TEMPLATE_APPROVAL_THRESHOLD_NOT_MET';
  };

type PromptTemplateApprovalExecutor = {
  query: ReturnType<typeof getDatabase>['query'];
};

type ToolPolicyApprovalSummary = {
  approvedDistinctUsersCount: number;
  requesterHasApproved: boolean;
  approvals: Array<{
    approverUserId: string;
    decision: 'approved' | 'rejected';
    reason: string | null;
    updatedAt: Date;
  }>;
};

type ToolPolicyActivationGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | 'TOOL_POLICY_APPROVER_REQUIRED'
      | 'TOOL_POLICY_DUAL_CONTROL_REQUIRED'
      | 'TOOL_POLICY_APPROVAL_THRESHOLD_NOT_MET';
  };

function selectBestModelVersionMatch(params: {
  candidates: ModelVersionCandidate[];
  namespaceId?: string | null;
  agentId?: string | null;
}): ModelVersionCandidate | null {
  const scored = params.candidates
    .map((candidate) => {
      if (candidate.namespaceId && candidate.namespaceId !== (params.namespaceId ?? null)) {
        return null;
      }
      if (candidate.agentId && candidate.agentId !== (params.agentId ?? null)) {
        return null;
      }
      const specificity = (candidate.namespaceId ? 1 : 0) + (candidate.agentId ? 2 : 0);
      return { candidate, specificity };
    })
    .filter((entry): entry is { candidate: ModelVersionCandidate; specificity: number } => Boolean(entry))
    .sort((left, right) => {
      if (right.specificity !== left.specificity) {
        return right.specificity - left.specificity;
      }
      if (right.candidate.version !== left.candidate.version) {
        return right.candidate.version - left.candidate.version;
      }
      const rightTime = right.candidate.ativadoEm?.getTime() ?? 0;
      const leftTime = left.candidate.ativadoEm?.getTime() ?? 0;
      return rightTime - leftTime;
    });
  return scored[0]?.candidate ?? null;
}

export async function resolveModelGovernance(params: {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  hints: GovernanceHints;
  fallbackModel: string;
}): Promise<ResolvedModelGovernance> {
  const db = getDatabase();

  if (params.hints.modelVersionId) {
    const target = await db.query.modelVersions.findFirst({
      where: and(
        eq(schema.modelVersions.id, params.hints.modelVersionId),
        eq(schema.modelVersions.tenantId, params.tenantId)
      ),
      columns: {
        id: true,
        namespaceId: true,
        agentId: true,
        baseModel: true,
        name: true,
        status: true,
        isActive: true,
      },
    });

    if (!target) {
      throw new Error('MODEL_VERSION_NOT_FOUND');
    }
    if (target.status !== 'active' || !target.isActive) {
      throw new Error('MODEL_VERSION_NOT_ACTIVE');
    }
    if (target.namespaceId && target.namespaceId !== (params.namespaceId ?? null)) {
      throw new Error('MODEL_VERSION_SCOPE_NAMESPACE_MISMATCH');
    }
    if (target.agentId && target.agentId !== (params.agentId ?? null)) {
      throw new Error('MODEL_VERSION_SCOPE_AGENT_MISMATCH');
    }

    return {
      modelVersionId: target.id,
      baseModel: target.baseModel || params.fallbackModel,
      modelName: target.name,
    };
  }

  const candidatesRaw = await db.query.modelVersions.findMany({
    where: and(
      eq(schema.modelVersions.tenantId, params.tenantId),
      eq(schema.modelVersions.status, 'active'),
      eq(schema.modelVersions.isActive, true)
    ),
    orderBy: [desc(schema.modelVersions.version), desc(schema.modelVersions.ativadoEm)],
    columns: {
      id: true,
      namespaceId: true,
      agentId: true,
      baseModel: true,
      name: true,
      version: true,
      ativadoEm: true,
    },
  });

  const selected = selectBestModelVersionMatch({
    candidates: candidatesRaw.map((candidate) => ({
      id: candidate.id,
      namespaceId: candidate.namespaceId,
      agentId: candidate.agentId,
      baseModel: candidate.baseModel,
      name: candidate.name,
      version: candidate.version,
      ativadoEm: candidate.ativadoEm,
    })),
    namespaceId: params.namespaceId,
    agentId: params.agentId,
  });

  if (!selected) {
    return {
      modelVersionId: null,
      baseModel: params.fallbackModel,
      modelName: null,
    };
  }

  return {
    modelVersionId: selected.id,
    baseModel: selected.baseModel || params.fallbackModel,
    modelName: selected.name,
  };
}

async function getPromptTemplateApprovalSummary(params: {
  tx: PromptTemplateApprovalExecutor;
  tenantId: string;
  promptTemplateId: string;
  requesterUserId: string;
}): Promise<PromptTemplateApprovalSummary> {
  const approvals = await params.tx.query.promptTemplateApprovals.findMany({
    where: and(
      eq(schema.promptTemplateApprovals.tenantId, params.tenantId),
      eq(schema.promptTemplateApprovals.promptTemplateId, params.promptTemplateId)
    ),
    orderBy: [desc(schema.promptTemplateApprovals.updatedAt)],
    columns: {
      approverUserId: true,
      decision: true,
      reason: true,
      updatedAt: true,
    },
  });

  return {
    approvedDistinctUsersCount: approvals.filter((approval) => approval.decision === 'approved').length,
    requesterHasApproved: approvals.some(
      (approval) => approval.approverUserId === params.requesterUserId && approval.decision === 'approved'
    ),
    approvals,
  };
}

export function evaluatePromptTemplateActivationGate(params: {
  evaluationStatus: 'pending' | 'passed' | 'failed' | 'skipped';
  minApprovals: number;
  approvedDistinctUsersCount: number;
  requireDualControl: boolean;
  createdBy: string | null;
  approverUserId: string | null;
}): PromptTemplateActivationGateResult {
  if (params.evaluationStatus !== 'passed') {
    return { allowed: false, reason: 'PROMPT_TEMPLATE_EVAL_NOT_PASSED' };
  }
  if (!params.approverUserId) {
    return { allowed: false, reason: 'PROMPT_TEMPLATE_APPROVER_REQUIRED' };
  }
  if (params.requireDualControl && params.createdBy && params.createdBy === params.approverUserId) {
    return { allowed: false, reason: 'PROMPT_TEMPLATE_DUAL_CONTROL_REQUIRED' };
  }
  if (params.approvedDistinctUsersCount < params.minApprovals) {
    return { allowed: false, reason: 'PROMPT_TEMPLATE_APPROVAL_THRESHOLD_NOT_MET' };
  }
  return { allowed: true };
}

async function getToolPolicyApprovalSummary(params: {
  tx: PromptTemplateApprovalExecutor;
  tenantId: string;
  toolPolicyId: string;
  requesterUserId: string;
}): Promise<ToolPolicyApprovalSummary> {
  const approvals = await params.tx.query.toolPolicyApprovals.findMany({
    where: and(
      eq(schema.toolPolicyApprovals.tenantId, params.tenantId),
      eq(schema.toolPolicyApprovals.toolPolicyId, params.toolPolicyId)
    ),
    orderBy: [desc(schema.toolPolicyApprovals.updatedAt)],
    columns: {
      approverUserId: true,
      decision: true,
      reason: true,
      updatedAt: true,
    },
  });

  return {
    approvedDistinctUsersCount: approvals.filter((approval) => approval.decision === 'approved').length,
    requesterHasApproved: approvals.some(
      (approval) => approval.approverUserId === params.requesterUserId && approval.decision === 'approved'
    ),
    approvals,
  };
}

export function evaluateToolPolicyActivationGate(params: {
  minApprovals: number;
  approvedDistinctUsersCount: number;
  requireDualControl: boolean;
  createdBy: string | null;
  approverUserId: string | null;
}): ToolPolicyActivationGateResult {
  if (!params.approverUserId) {
    return { allowed: false, reason: 'TOOL_POLICY_APPROVER_REQUIRED' };
  }
  if (params.requireDualControl && params.createdBy && params.createdBy === params.approverUserId) {
    return { allowed: false, reason: 'TOOL_POLICY_DUAL_CONTROL_REQUIRED' };
  }
  if (params.approvedDistinctUsersCount < params.minApprovals) {
    return { allowed: false, reason: 'TOOL_POLICY_APPROVAL_THRESHOLD_NOT_MET' };
  }
  return { allowed: true };
}

export function getPromptTemplateCreateSchema(): typeof promptTemplateCreateSchema {
  return promptTemplateCreateSchema;
}

export function getPromptTemplateActivateSchema(): typeof promptTemplateActivateSchema {
  return promptTemplateActivateSchema;
}

export function getPromptTemplateEvaluateSchema(): typeof promptTemplateEvaluateSchema {
  return promptTemplateEvaluateSchema;
}

export function getPromptTemplateApprovalSchema(): typeof promptTemplateApprovalSchema {
  return promptTemplateApprovalSchema;
}

export function getToolPolicyCreateSchema(): typeof toolPolicyCreateSchema {
  return toolPolicyCreateSchema;
}

export function getToolPolicyActivateSchema(): typeof toolPolicyActivateSchema {
  return toolPolicyActivateSchema;
}

export function getToolPolicyApprovalSchema(): typeof toolPolicyApprovalSchema {
  return toolPolicyApprovalSchema;
}

export async function createPromptTemplate(input: z.infer<typeof promptTemplateCreateSchema>): Promise<{
  id: string;
  version: number;
  status: string;
}> {
  const db = getDatabase();

  const latest = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.tenantId, input.tenantId),
      eq(schema.promptTemplates.promptKey, input.promptKey),
      input.namespaceId ? eq(schema.promptTemplates.namespaceId, input.namespaceId) : isNull(schema.promptTemplates.namespaceId),
      input.agentId ? eq(schema.promptTemplates.agentId, input.agentId) : isNull(schema.promptTemplates.agentId)
    ),
    orderBy: [desc(schema.promptTemplates.version)],
    columns: { version: true },
  });

  const nextVersion = (latest?.version ?? 0) + 1;

  const [created] = await db
    .insert(schema.promptTemplates)
    .values({
      tenantId: input.tenantId,
      namespaceId: input.namespaceId ?? null,
      agentId: input.agentId ?? null,
      promptKey: input.promptKey,
      version: nextVersion,
      status: 'draft',
      evaluationStatus: 'pending',
      minApprovals: input.minApprovals,
      requireDualControl: input.requireDualControl,
      template: input.template,
      inputSchema: input.inputSchema ?? {},
      outputSchema: input.outputSchema ?? {},
      metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    })
    .returning({ id: schema.promptTemplates.id, version: schema.promptTemplates.version, status: schema.promptTemplates.status });

  return {
    id: created.id,
    version: created.version,
    status: created.status,
  };
}

export async function createToolPolicy(input: z.infer<typeof toolPolicyCreateSchema>): Promise<{
  id: string;
  version: number;
  status: string;
}> {
  const db = getDatabase();

  const latest = await db.query.toolPolicies.findFirst({
    where: and(
      eq(schema.toolPolicies.tenantId, input.tenantId),
      eq(schema.toolPolicies.policyKey, input.policyKey),
      input.namespaceId ? eq(schema.toolPolicies.namespaceId, input.namespaceId) : isNull(schema.toolPolicies.namespaceId),
      input.agentId ? eq(schema.toolPolicies.agentId, input.agentId) : isNull(schema.toolPolicies.agentId)
    ),
    orderBy: [desc(schema.toolPolicies.version)],
    columns: { version: true },
  });

  const nextVersion = (latest?.version ?? 0) + 1;

  const [created] = await db
    .insert(schema.toolPolicies)
    .values({
      tenantId: input.tenantId,
      namespaceId: input.namespaceId ?? null,
      agentId: input.agentId ?? null,
      policyKey: input.policyKey,
      version: nextVersion,
      status: 'draft',
      allowTools: sanitizeToolList(input.allowTools),
      denyTools: sanitizeToolList(input.denyTools),
      minApprovals: input.minApprovals,
      requireDualControl: input.requireDualControl,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    })
    .returning({ id: schema.toolPolicies.id, version: schema.toolPolicies.version, status: schema.toolPolicies.status });

  return {
    id: created.id,
    version: created.version,
    status: created.status,
  };
}

export async function recordPromptTemplateEvaluation(input: z.infer<typeof promptTemplateEvaluateSchema> & {
  templateId: string;
}): Promise<{
  id: string;
  evaluationStatus: 'pending' | 'passed' | 'failed' | 'skipped';
  evaluationScore: number | null;
  evaluatedAt: string | null;
}> {
  const db = getDatabase();
  const target = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.id, input.templateId),
      eq(schema.promptTemplates.tenantId, input.tenantId)
    ),
    columns: {
      id: true,
    },
  });
  if (!target) {
    throw new Error('PROMPT_TEMPLATE_NOT_FOUND');
  }

  const now = new Date();
  await db
    .update(schema.promptTemplates)
    .set({
      evaluationStatus: input.evaluationStatus,
      evaluationScore: input.evaluationScore ?? null,
      evaluationReport: input.evaluationReport ?? {},
      evaluatedBy: input.evaluatedBy ?? null,
      evaluatedAt: now,
      atualizadoEm: now,
    })
    .where(eq(schema.promptTemplates.id, target.id));

  const updated = await db.query.promptTemplates.findFirst({
    where: eq(schema.promptTemplates.id, target.id),
    columns: {
      id: true,
      evaluationStatus: true,
      evaluationScore: true,
      evaluatedAt: true,
    },
  });

  if (!updated) {
    throw new Error('PROMPT_TEMPLATE_EVALUATION_UPDATE_FAILED');
  }

  return {
    id: updated.id,
    evaluationStatus: updated.evaluationStatus,
    evaluationScore: updated.evaluationScore ?? null,
    evaluatedAt: updated.evaluatedAt ? updated.evaluatedAt.toISOString() : null,
  };
}

export async function recordPromptTemplateApproval(input: Omit<z.infer<typeof promptTemplateApprovalSchema>, 'approverUserId'> & {
  templateId: string;
  approverUserId: string;
}): Promise<PromptTemplateApprovalSummary> {
  const db = getDatabase();
  const target = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.id, input.templateId),
      eq(schema.promptTemplates.tenantId, input.tenantId)
    ),
    columns: {
      id: true,
    },
  });
  if (!target) {
    throw new Error('PROMPT_TEMPLATE_NOT_FOUND');
  }

  const now = new Date();
  await db
    .insert(schema.promptTemplateApprovals)
    .values({
      tenantId: input.tenantId,
      promptTemplateId: target.id,
      approverUserId: input.approverUserId,
      decision: input.decision,
      reason: input.reason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.promptTemplateApprovals.promptTemplateId,
        schema.promptTemplateApprovals.approverUserId,
      ],
      set: {
        decision: input.decision,
        reason: input.reason ?? null,
        updatedAt: now,
      },
    });

  return getPromptTemplateApprovalSummary({
    tx: db,
    tenantId: input.tenantId,
    promptTemplateId: target.id,
    requesterUserId: input.approverUserId,
  });
}

export async function recordToolPolicyApproval(input: Omit<z.infer<typeof toolPolicyApprovalSchema>, 'approverUserId'> & {
  policyId: string;
  approverUserId: string;
}): Promise<ToolPolicyApprovalSummary> {
  const db = getDatabase();
  const target = await db.query.toolPolicies.findFirst({
    where: and(
      eq(schema.toolPolicies.id, input.policyId),
      eq(schema.toolPolicies.tenantId, input.tenantId)
    ),
    columns: {
      id: true,
    },
  });
  if (!target) {
    throw new Error('TOOL_POLICY_NOT_FOUND');
  }

  const now = new Date();
  await db
    .insert(schema.toolPolicyApprovals)
    .values({
      tenantId: input.tenantId,
      toolPolicyId: target.id,
      approverUserId: input.approverUserId,
      decision: input.decision,
      reason: input.reason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.toolPolicyApprovals.toolPolicyId,
        schema.toolPolicyApprovals.approverUserId,
      ],
      set: {
        decision: input.decision,
        reason: input.reason ?? null,
        updatedAt: now,
      },
    });

  return getToolPolicyApprovalSummary({
    tx: db,
    tenantId: input.tenantId,
    toolPolicyId: target.id,
    requesterUserId: input.approverUserId,
  });
}

export async function activatePromptTemplate(params: {
  templateId: string;
  tenantId: string;
  approvedBy?: string;
}): Promise<{ id: string; status: string; approvedAt: string | null }> {
  const db = getDatabase();

  const target = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.id, params.templateId),
      eq(schema.promptTemplates.tenantId, params.tenantId)
    ),
    columns: {
      id: true,
      tenantId: true,
      namespaceId: true,
      agentId: true,
      promptKey: true,
      createdBy: true,
      evaluationStatus: true,
      minApprovals: true,
      requireDualControl: true,
    },
  });

  if (!target) {
    throw new Error('PROMPT_TEMPLATE_NOT_FOUND');
  }

  await db.transaction(async (tx) => {
    if (params.approvedBy) {
      const now = new Date();
      await tx
        .insert(schema.promptTemplateApprovals)
        .values({
          tenantId: target.tenantId,
          promptTemplateId: target.id,
          approverUserId: params.approvedBy,
          decision: 'approved',
          reason: 'Recorded during activation request',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.promptTemplateApprovals.promptTemplateId,
            schema.promptTemplateApprovals.approverUserId,
          ],
          set: {
            decision: 'approved',
            reason: 'Recorded during activation request',
            updatedAt: now,
          },
        });
    }

    const approvalSummary = await getPromptTemplateApprovalSummary({
      tx,
      tenantId: target.tenantId,
      promptTemplateId: target.id,
      requesterUserId: params.approvedBy ?? '',
    });

    const gateResult = evaluatePromptTemplateActivationGate({
      evaluationStatus: target.evaluationStatus,
      minApprovals: target.minApprovals ?? 1,
      approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
      requireDualControl: target.requireDualControl ?? true,
      createdBy: target.createdBy ?? null,
      approverUserId: params.approvedBy ?? null,
    });

    if (!gateResult.allowed) {
      throw new Error(gateResult.reason);
    }

    await tx
      .update(schema.promptTemplates)
      .set({
        status: 'deprecated',
        atualizadoEm: new Date(),
      })
      .where(and(
        eq(schema.promptTemplates.tenantId, target.tenantId),
        eq(schema.promptTemplates.promptKey, target.promptKey),
        target.namespaceId ? eq(schema.promptTemplates.namespaceId, target.namespaceId) : isNull(schema.promptTemplates.namespaceId),
        target.agentId ? eq(schema.promptTemplates.agentId, target.agentId) : isNull(schema.promptTemplates.agentId),
        eq(schema.promptTemplates.status, 'active'),
        ne(schema.promptTemplates.id, target.id)
      ));

    await tx
      .update(schema.promptTemplates)
      .set({
        status: 'active',
        approvedBy: params.approvedBy ?? null,
        approvedAt: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.promptTemplates.id, target.id));
  });

  const updated = await db.query.promptTemplates.findFirst({
    where: eq(schema.promptTemplates.id, target.id),
    columns: { id: true, status: true, approvedAt: true },
  });

  if (!updated) {
    throw new Error('PROMPT_TEMPLATE_ACTIVATE_FAILED');
  }

  return {
    id: updated.id,
    status: updated.status,
    approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
  };
}

export async function activateToolPolicy(params: {
  policyId: string;
  tenantId: string;
  approvedBy?: string;
}): Promise<{ id: string; status: string; approvedAt: string | null }> {
  const db = getDatabase();

  const target = await db.query.toolPolicies.findFirst({
    where: and(
      eq(schema.toolPolicies.id, params.policyId),
      eq(schema.toolPolicies.tenantId, params.tenantId)
    ),
    columns: {
      id: true,
      tenantId: true,
      namespaceId: true,
      agentId: true,
      policyKey: true,
      createdBy: true,
      minApprovals: true,
      requireDualControl: true,
    },
  });

  if (!target) {
    throw new Error('TOOL_POLICY_NOT_FOUND');
  }

  await db.transaction(async (tx) => {
    if (params.approvedBy) {
      const now = new Date();
      await tx
        .insert(schema.toolPolicyApprovals)
        .values({
          tenantId: target.tenantId,
          toolPolicyId: target.id,
          approverUserId: params.approvedBy,
          decision: 'approved',
          reason: 'Recorded during activation request',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.toolPolicyApprovals.toolPolicyId,
            schema.toolPolicyApprovals.approverUserId,
          ],
          set: {
            decision: 'approved',
            reason: 'Recorded during activation request',
            updatedAt: now,
          },
        });
    }

    const approvalSummary = await getToolPolicyApprovalSummary({
      tx,
      tenantId: target.tenantId,
      toolPolicyId: target.id,
      requesterUserId: params.approvedBy ?? '',
    });

    const gateResult = evaluateToolPolicyActivationGate({
      minApprovals: target.minApprovals ?? 1,
      approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
      requireDualControl: target.requireDualControl ?? true,
      createdBy: target.createdBy ?? null,
      approverUserId: params.approvedBy ?? null,
    });

    if (!gateResult.allowed) {
      throw new Error(gateResult.reason);
    }

    await tx
      .update(schema.toolPolicies)
      .set({
        status: 'deprecated',
        atualizadoEm: new Date(),
      })
      .where(and(
        eq(schema.toolPolicies.tenantId, target.tenantId),
        eq(schema.toolPolicies.policyKey, target.policyKey),
        target.namespaceId ? eq(schema.toolPolicies.namespaceId, target.namespaceId) : isNull(schema.toolPolicies.namespaceId),
        target.agentId ? eq(schema.toolPolicies.agentId, target.agentId) : isNull(schema.toolPolicies.agentId),
        eq(schema.toolPolicies.status, 'active'),
        ne(schema.toolPolicies.id, target.id)
      ));

    await tx
      .update(schema.toolPolicies)
      .set({
        status: 'active',
        approvedBy: params.approvedBy ?? null,
        approvedAt: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.toolPolicies.id, target.id));
  });

  const updated = await db.query.toolPolicies.findFirst({
    where: eq(schema.toolPolicies.id, target.id),
    columns: { id: true, status: true, approvedAt: true },
  });

  if (!updated) {
    throw new Error('TOOL_POLICY_ACTIVATE_FAILED');
  }

  return {
    id: updated.id,
    status: updated.status,
    approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
  };
}

export async function listPromptTemplates(params: {
  tenantId: string;
  namespaceId?: string;
  agentId?: string;
  promptKey?: string;
  status?: 'draft' | 'active' | 'deprecated' | 'archived';
  limit: number;
}): Promise<Array<{
  id: string;
  tenantId: string;
  namespaceId: string | null;
  agentId: string | null;
  promptKey: string;
  version: number;
  status: 'draft' | 'active' | 'deprecated' | 'archived';
  evaluationStatus: 'pending' | 'passed' | 'failed' | 'skipped';
  minApprovals: number;
  requireDualControl: boolean;
  createdAt: string;
  updatedAt: string;
}>> {
  const db = getDatabase();

  const rows = await db.query.promptTemplates.findMany({
    where: and(
      eq(schema.promptTemplates.tenantId, params.tenantId),
      params.namespaceId ? eq(schema.promptTemplates.namespaceId, params.namespaceId) : undefined,
      params.agentId ? eq(schema.promptTemplates.agentId, params.agentId) : undefined,
      params.promptKey ? eq(schema.promptTemplates.promptKey, params.promptKey) : undefined,
      params.status ? eq(schema.promptTemplates.status, params.status) : undefined
    ),
    orderBy: [desc(schema.promptTemplates.criadoEm), desc(schema.promptTemplates.version)],
    limit: params.limit,
    columns: {
      id: true,
      tenantId: true,
      namespaceId: true,
      agentId: true,
      promptKey: true,
      version: true,
      status: true,
      evaluationStatus: true,
      minApprovals: true,
      requireDualControl: true,
      criadoEm: true,
      atualizadoEm: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    namespaceId: row.namespaceId,
    agentId: row.agentId,
    promptKey: row.promptKey,
    version: row.version,
    status: row.status,
    evaluationStatus: row.evaluationStatus,
    minApprovals: row.minApprovals,
    requireDualControl: row.requireDualControl,
    createdAt: row.criadoEm?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.atualizadoEm?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function listPromptTemplateApprovals(params: {
  tenantId: string;
  templateId: string;
}): Promise<PromptTemplateApprovalSummary> {
  const db = getDatabase();
  const target = await db.query.promptTemplates.findFirst({
    where: and(
      eq(schema.promptTemplates.id, params.templateId),
      eq(schema.promptTemplates.tenantId, params.tenantId)
    ),
    columns: { id: true },
  });

  if (!target) {
    throw new Error('PROMPT_TEMPLATE_NOT_FOUND');
  }

  return getPromptTemplateApprovalSummary({
    tx: db,
    tenantId: params.tenantId,
    promptTemplateId: target.id,
    requesterUserId: '',
  });
}

export async function listToolPolicyApprovals(params: {
  tenantId: string;
  policyId: string;
}): Promise<ToolPolicyApprovalSummary> {
  const db = getDatabase();
  const target = await db.query.toolPolicies.findFirst({
    where: and(
      eq(schema.toolPolicies.id, params.policyId),
      eq(schema.toolPolicies.tenantId, params.tenantId)
    ),
    columns: { id: true },
  });

  if (!target) {
    throw new Error('TOOL_POLICY_NOT_FOUND');
  }

  return getToolPolicyApprovalSummary({
    tx: db,
    tenantId: params.tenantId,
    toolPolicyId: target.id,
    requesterUserId: '',
  });
}

export async function listToolPolicies(params: {
  tenantId: string;
  namespaceId?: string;
  agentId?: string;
  policyKey?: string;
  status?: 'draft' | 'active' | 'deprecated' | 'archived';
  limit: number;
}): Promise<Array<{
  id: string;
  tenantId: string;
  namespaceId: string | null;
  agentId: string | null;
  policyKey: string;
  version: number;
  status: 'draft' | 'active' | 'deprecated' | 'archived';
  allowTools: string[];
  denyTools: string[];
  minApprovals: number;
  requireDualControl: boolean;
  createdAt: string;
  updatedAt: string;
}>> {
  const db = getDatabase();

  const rows = await db.query.toolPolicies.findMany({
    where: and(
      eq(schema.toolPolicies.tenantId, params.tenantId),
      params.namespaceId ? eq(schema.toolPolicies.namespaceId, params.namespaceId) : undefined,
      params.agentId ? eq(schema.toolPolicies.agentId, params.agentId) : undefined,
      params.policyKey ? eq(schema.toolPolicies.policyKey, params.policyKey) : undefined,
      params.status ? eq(schema.toolPolicies.status, params.status) : undefined
    ),
    orderBy: [desc(schema.toolPolicies.criadoEm), desc(schema.toolPolicies.version)],
    limit: params.limit,
    columns: {
      id: true,
      tenantId: true,
      namespaceId: true,
      agentId: true,
      policyKey: true,
      version: true,
      status: true,
      allowTools: true,
      denyTools: true,
      minApprovals: true,
      requireDualControl: true,
      criadoEm: true,
      atualizadoEm: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    namespaceId: row.namespaceId,
    agentId: row.agentId,
    policyKey: row.policyKey,
    version: row.version,
    status: row.status,
    allowTools: sanitizeToolList(Array.isArray(row.allowTools) ? row.allowTools : []),
    denyTools: sanitizeToolList(Array.isArray(row.denyTools) ? row.denyTools : []),
    minApprovals: row.minApprovals,
    requireDualControl: row.requireDualControl,
    createdAt: row.criadoEm?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.atualizadoEm?.toISOString() ?? new Date().toISOString(),
  }));
}

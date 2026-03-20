import type { ResourceType } from './resource-access.js';

export type AgentActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AgentActionHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type AgentActionCatalogEntry = {
  actionKey: string;
  capabilityId: string;
  module: string;
  targetService: string;
  endpoint: string;
  method: AgentActionHttpMethod;
  requiredPermission: string;
  resourceType: ResourceType | 'tenant' | 'service' | 'external' | 'none';
  riskLevel: AgentActionRiskLevel;
  requiresApproval: boolean;
  requiresStepUp: boolean;
  requiresDualControl: boolean;
  toolPolicyKey: string;
  allowedNamespaceIds: string[] | null;
  enabled: boolean;
};

const STATIC_AGENT_ACTION_CATALOG: AgentActionCatalogEntry[] = [
  {
    actionKey: 'payments.wise.recipients.list',
    capabilityId: 'payments.wise.read',
    module: 'payments',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/wise/recipients',
    method: 'GET',
    requiredPermission: 'integrations:wise:read',
    resourceType: 'external',
    riskLevel: 'low',
    requiresApproval: false,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'payments',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'payments.wise.transfer.create',
    capabilityId: 'payments.wise.transfer',
    module: 'payments',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/agentic/payments/wise-transfer',
    method: 'POST',
    requiredPermission: 'integrations:wise:write',
    resourceType: 'external',
    riskLevel: 'critical',
    requiresApproval: true,
    requiresStepUp: true,
    requiresDualControl: true,
    toolPolicyKey: 'payments',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'payments.wise.exchange.create',
    capabilityId: 'payments.wise.exchange',
    module: 'payments',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/agentic/payments/wise-exchange',
    method: 'POST',
    requiredPermission: 'integrations:wise:write',
    resourceType: 'external',
    riskLevel: 'high',
    requiresApproval: true,
    requiresStepUp: true,
    requiresDualControl: false,
    toolPolicyKey: 'payments',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'payments.stripe.payment_intent.create',
    capabilityId: 'payments.stripe.write',
    module: 'payments',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/stripe/create-payment-intent',
    method: 'POST',
    requiredPermission: 'integrations:stripe:write',
    resourceType: 'external',
    riskLevel: 'high',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'payments',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'observability.grafana.dashboard.list',
    capabilityId: 'grafana.read',
    module: 'observability',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/grafana/dashboards',
    method: 'GET',
    requiredPermission: 'integrations:grafana:read',
    resourceType: 'service',
    riskLevel: 'low',
    requiresApproval: false,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'grafana',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'observability.grafana.dashboard.get',
    capabilityId: 'grafana.read',
    module: 'observability',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/grafana/dashboards/:uid',
    method: 'GET',
    requiredPermission: 'integrations:grafana:read',
    resourceType: 'service',
    riskLevel: 'low',
    requiresApproval: false,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'grafana',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'observability.grafana.dashboard.update',
    capabilityId: 'grafana.write',
    module: 'observability',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/grafana/dashboards',
    method: 'POST',
    requiredPermission: 'integrations:grafana:write',
    resourceType: 'service',
    riskLevel: 'high',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: true,
    toolPolicyKey: 'grafana',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'platform.stack.deploy',
    capabilityId: 'platform.stack.write',
    module: 'platform',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/github/deploy-stack',
    method: 'POST',
    requiredPermission: 'admin:alice_core:write',
    resourceType: 'service',
    riskLevel: 'critical',
    requiresApproval: true,
    requiresStepUp: true,
    requiresDualControl: true,
    toolPolicyKey: 'stack_ops',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'platform.stack.rollback',
    capabilityId: 'platform.stack.write',
    module: 'platform',
    targetService: 'integrations-service',
    endpoint: '/api/integrations/github/deploy-stack',
    method: 'POST',
    requiredPermission: 'admin:alice_core:write',
    resourceType: 'service',
    riskLevel: 'critical',
    requiresApproval: true,
    requiresStepUp: true,
    requiresDualControl: true,
    toolPolicyKey: 'stack_ops',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'trading.command.execute',
    capabilityId: 'trading.execute',
    module: 'trading',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'integrations:trading:write',
    resourceType: 'conversation',
    riskLevel: 'critical',
    requiresApproval: true,
    requiresStepUp: true,
    requiresDualControl: true,
    toolPolicyKey: 'trading',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'agentic.task.document.create',
    capabilityId: 'agentic.task.document',
    module: 'agentic_tasks',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'rag:documents:write',
    resourceType: 'document',
    riskLevel: 'medium',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'agentic_tasks',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'agentic.task.document.update',
    capabilityId: 'agentic.task.document',
    module: 'agentic_tasks',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'rag:documents:write',
    resourceType: 'document',
    riskLevel: 'medium',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'agentic_tasks',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'agentic.task.report.create',
    capabilityId: 'agentic.task.report',
    module: 'agentic_tasks',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'chat:messages:write',
    resourceType: 'conversation',
    riskLevel: 'medium',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'agentic_tasks',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'agentic.task.accounting.create',
    capabilityId: 'agentic.task.accounting',
    module: 'agentic_tasks',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'chat:messages:write',
    resourceType: 'conversation',
    riskLevel: 'high',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'agentic_tasks',
    allowedNamespaceIds: null,
    enabled: true,
  },
  {
    actionKey: 'agentic.task.planning.create',
    capabilityId: 'agentic.task.planning',
    module: 'agentic_tasks',
    targetService: 'chat-service',
    endpoint: '/api/chat/stream',
    method: 'POST',
    requiredPermission: 'chat:messages:write',
    resourceType: 'conversation',
    riskLevel: 'medium',
    requiresApproval: true,
    requiresStepUp: false,
    requiresDualControl: false,
    toolPolicyKey: 'agentic_tasks',
    allowedNamespaceIds: null,
    enabled: true,
  },
];

export function listAgentActionCatalog(): AgentActionCatalogEntry[] {
  return STATIC_AGENT_ACTION_CATALOG.map((entry) => ({
    ...entry,
    allowedNamespaceIds: entry.allowedNamespaceIds ? [...entry.allowedNamespaceIds] : null,
  }));
}

export function getAgentActionCatalogEntry(actionKey: string): AgentActionCatalogEntry | undefined {
  return STATIC_AGENT_ACTION_CATALOG.find((entry) => entry.actionKey === actionKey);
}

export function listCapabilityCatalogEntries(capabilityId: string): AgentActionCatalogEntry[] {
  return STATIC_AGENT_ACTION_CATALOG.filter((entry) => entry.capabilityId === capabilityId);
}

export function matchesAgentActionSelector(selector: string, entry: AgentActionCatalogEntry): boolean {
  const normalized = selector.trim();
  if (!normalized) {
    return false;
  }

  if (normalized === entry.actionKey || normalized === entry.capabilityId || normalized === entry.module) {
    return true;
  }

  if (normalized.startsWith('action:')) {
    return normalized.slice('action:'.length) === entry.actionKey;
  }

  if (normalized.startsWith('capability:')) {
    return normalized.slice('capability:'.length) === entry.capabilityId;
  }

  if (normalized.startsWith('module:')) {
    return normalized.slice('module:'.length) === entry.module;
  }

  if (normalized.startsWith('service:')) {
    return normalized.slice('service:'.length) === entry.targetService;
  }

  return false;
}

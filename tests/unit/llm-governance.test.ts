import { describe, expect, it } from 'vitest';
import {
  evaluatePromptTemplateActivationGate,
  evaluateToolPolicyActivationGate,
  mergeGovernanceHints,
  selectBestToolPolicyMatch,
  type ToolPolicyCandidate,
} from '../../apps/llm-gateway-service/src/governance';

describe('mergeGovernanceHints', () => {
  it('prioritizes explicit request hints over namespace defaults', () => {
    const merged = mergeGovernanceHints(
      {
        promptTemplateId: '11111111-1111-1111-1111-111111111111',
        promptVersion: 1,
        toolPolicyKey: 'tenant-default',
        toolPolicyVersion: 2,
        modelVersionId: '33333333-3333-3333-3333-333333333333',
      },
      {
        toolPolicyKey: 'namespace-trading',
        toolPolicyVersion: 5,
        modelVersionId: '22222222-2222-2222-2222-222222222222',
      }
    );

    expect(merged.promptTemplateId).toBe('11111111-1111-1111-1111-111111111111');
    expect(merged.promptVersion).toBe(1);
    expect(merged.toolPolicyKey).toBe('namespace-trading');
    expect(merged.toolPolicyVersion).toBe(5);
    expect(merged.modelVersionId).toBe('22222222-2222-2222-2222-222222222222');
  });
});

describe('selectBestToolPolicyMatch', () => {
  const baseCandidates: ToolPolicyCandidate[] = [
    {
      id: 'tenant-wide',
      policyKey: 'tool-policy',
      namespaceId: null,
      agentId: null,
      version: 1,
      allowTools: ['read'],
      denyTools: [],
      atualizadoEm: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'namespace-specific',
      policyKey: 'tool-policy',
      namespaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agentId: null,
      version: 1,
      allowTools: ['read', 'search'],
      denyTools: [],
      atualizadoEm: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'agent-specific',
      policyKey: 'tool-policy',
      namespaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      version: 2,
      allowTools: ['read', 'trade'],
      denyTools: ['payments:execute'],
      atualizadoEm: new Date('2026-01-02T00:00:00.000Z'),
    },
  ];

  it('selects the most specific policy for namespace and agent', () => {
    const selected = selectBestToolPolicyMatch({
      candidates: baseCandidates,
      namespaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(selected?.id).toBe('agent-specific');
  });

  it('falls back to namespace policy when agent-specific is unavailable', () => {
    const selected = selectBestToolPolicyMatch({
      candidates: baseCandidates,
      namespaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    });

    expect(selected?.id).toBe('namespace-specific');
  });

  it('falls back to tenant-wide policy when scoped candidates do not match', () => {
    const selected = selectBestToolPolicyMatch({
      candidates: baseCandidates,
      namespaceId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      agentId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    });

    expect(selected?.id).toBe('tenant-wide');
  });
});

describe('evaluatePromptTemplateActivationGate', () => {
  it('blocks activation when evaluation is not passed', () => {
    const result = evaluatePromptTemplateActivationGate({
      evaluationStatus: 'failed',
      minApprovals: 1,
      approvedDistinctUsersCount: 1,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('PROMPT_TEMPLATE_EVAL_NOT_PASSED');
    }
  });

  it('blocks activation when dual-control requires a different approver', () => {
    const result = evaluatePromptTemplateActivationGate({
      evaluationStatus: 'passed',
      minApprovals: 1,
      approvedDistinctUsersCount: 1,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('PROMPT_TEMPLATE_DUAL_CONTROL_REQUIRED');
    }
  });

  it('blocks activation when approval threshold is not met', () => {
    const result = evaluatePromptTemplateActivationGate({
      evaluationStatus: 'passed',
      minApprovals: 2,
      approvedDistinctUsersCount: 1,
      requireDualControl: false,
      createdBy: null,
      approverUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('PROMPT_TEMPLATE_APPROVAL_THRESHOLD_NOT_MET');
    }
  });

  it('allows activation when all governance checks pass', () => {
    const result = evaluatePromptTemplateActivationGate({
      evaluationStatus: 'passed',
      minApprovals: 2,
      approvedDistinctUsersCount: 2,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.allowed).toBe(true);
  });
});

describe('evaluateToolPolicyActivationGate', () => {
  it('blocks activation when approver is missing', () => {
    const result = evaluateToolPolicyActivationGate({
      minApprovals: 1,
      approvedDistinctUsersCount: 1,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: null,
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('TOOL_POLICY_APPROVER_REQUIRED');
    }
  });

  it('blocks activation when dual-control requires another approver', () => {
    const result = evaluateToolPolicyActivationGate({
      minApprovals: 1,
      approvedDistinctUsersCount: 1,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('TOOL_POLICY_DUAL_CONTROL_REQUIRED');
    }
  });

  it('blocks activation when approval threshold is not met', () => {
    const result = evaluateToolPolicyActivationGate({
      minApprovals: 2,
      approvedDistinctUsersCount: 1,
      requireDualControl: false,
      createdBy: null,
      approverUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('TOOL_POLICY_APPROVAL_THRESHOLD_NOT_MET');
    }
  });

  it('allows activation when approvals satisfy governance constraints', () => {
    const result = evaluateToolPolicyActivationGate({
      minApprovals: 2,
      approvedDistinctUsersCount: 2,
      requireDualControl: true,
      createdBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      approverUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.allowed).toBe(true);
  });
});

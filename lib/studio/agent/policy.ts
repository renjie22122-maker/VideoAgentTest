import { projectAgents } from '../team-config.ts';
import { autoActions } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import { getAgentAction } from './actions/registry.ts';
import type { CapabilityRequirement } from './actions/types.ts';
import { grantedCapabilities, satisfiesCapabilityRequirement } from './capabilities.ts';
import type { CapabilityId } from './capabilities.ts';
import type { AutoDecision } from './planner.ts';

/**
 * Policy Engine: the single authority for whether a proposed agent decision
 * may execute. Planner prompts and UI hints describe rules; this module is
 * where allow / deny actually happens. The verdict doubles as the structured
 * explanation the observation and future task UI can render.
 *
 * Generic by design: action whitelisting, role membership and reason shape
 * are the only fixed checks; preconditions and capability requirements come
 * from the action's own metadata.
 */
export type PolicyViolation = { code: string; message: string };
export type PolicyVerdict = {
  allowed: boolean;
  actionId: string;
  capabilityRequirement: CapabilityRequirement;
  grantedCapabilities: readonly CapabilityId[];
  requiresVerification: boolean;
  effects: readonly string[];
  violations: PolicyViolation[];
};

function capabilityLabel(requirement: CapabilityRequirement): string {
  return [
    ...(requirement.allOf?.length ? ['全部(' + requirement.allOf.join('+') + ')'] : []),
    ...(requirement.anyOf?.length ? ['任一(' + requirement.anyOf.join('/') + ')'] : []),
  ].join(' 且 ');
}

export function evaluateAutoDecision(
  raw: Record<string, unknown>,
  p: Project,
): { decision: AutoDecision; policy: PolicyVerdict } {
  const roles = projectAgents(p).filter((r) => r.enabled);
  const roleId = typeof raw.roleId === 'string' ? raw.roleId : 'producer';
  const actionId = typeof raw.action === 'string' ? raw.action : '';
  const actionValid = autoActions.includes(actionId as AutoDecision['action']);
  const reasonValid =
    typeof raw.reason === 'string' && !!raw.reason.trim() && raw.reason.length <= 1500;
  const violations: PolicyViolation[] = [];
  if (!actionValid || !reasonValid)
    violations.push({
      code: 'invalid_decision',
      message: '总 Agent 返回了不允许的动作或无效理由。',
    });
  if (actionValid && actionId !== 'stop' && !roles.some((r) => r.id === raw.roleId))
    violations.push({ code: 'role_disabled', message: '总 Agent 选择了未启用岗位。' });
  const action = actionValid ? getAgentAction(actionId as AutoDecision['action']) : undefined;
  if (actionValid && action) {
    for (const precondition of action.preconditions)
      if (!precondition.satisfied(p))
        violations.push({ code: precondition.id, message: precondition.message });
  }
  const granted =
    actionId !== 'stop'
      ? [...grantedCapabilities(roles.find((r) => r.id === roleId))]
      : [];
  if (actionValid && actionId !== 'stop' && action) {
    // Single interpreter shared with the action catalog — no drift possible.
    if (!satisfiesCapabilityRequirement(granted, action.capabilityRequirement))
      violations.push({
        code: 'capability_missing',
        message:
          '总 Agent 选择的岗位未授予执行「' +
          actionId +
          '」所需的能力（' +
          capabilityLabel(action.capabilityRequirement) +
          '）。请在岗位配置中补充能力。',
      });
  }
  const decision: AutoDecision = {
    roleId,
    action: actionId as AutoDecision['action'],
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  };
  return {
    decision,
    policy: {
      allowed: violations.length === 0,
      actionId,
      capabilityRequirement: action?.capabilityRequirement ?? {},
      grantedCapabilities: granted,
      requiresVerification: action?.requiresVerification ?? false,
      effects: action?.effects ?? [],
      violations,
    },
  };
}

/** Throws the first policy violation; used by the planner compatibility path. */
export function assertAutoDecision(raw: Record<string, unknown>, p: Project): AutoDecision {
  const { decision, policy } = evaluateAutoDecision(raw, p);
  if (!policy.allowed) throw new Error(policy.violations[0].message);
  return decision;
}

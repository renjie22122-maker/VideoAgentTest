import { projectAgents } from '../team-config.ts';
import { autoActions } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import { getAgentAction } from './actions/registry.ts';
import type { CapabilityRequirement } from './actions/types.ts';
import { grantedCapabilities, satisfiesCapabilityRequirement, capabilityLabels } from './capabilities.ts';
import type { CapabilityId } from './capabilities.ts';
import { routeCapability } from './router.ts';
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
  const rawRoleId = typeof raw.roleId === 'string' ? raw.roleId : undefined;
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
  // Optional task-first fields: capability / targets / follow-up plan.
  const capabilityValid =
    raw.capability === undefined ||
    (typeof raw.capability === 'string' && raw.capability in capabilityLabels);
  const targetsValid =
    raw.targets === undefined ||
    (Array.isArray(raw.targets) &&
      raw.targets.length <= 20 &&
      raw.targets.every((t) => typeof t === 'string' && t.trim()) &&
      new Set(raw.targets).size === raw.targets.length);
  const planValid =
    raw.plan === undefined ||
    (Array.isArray(raw.plan) &&
      raw.plan.length <= 3 &&
      raw.plan.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          autoActions.includes((entry as Record<string, unknown>).action as AutoDecision['action']) &&
          typeof (entry as Record<string, unknown>).reason === 'string' &&
          !!((entry as Record<string, unknown>).reason as string).trim() &&
          ((entry as Record<string, unknown>).reason as string).length <= 1500 &&
          ((entry as Record<string, unknown>).roleId === undefined ||
            typeof (entry as Record<string, unknown>).roleId === 'string'),
      ));
  if (!capabilityValid || !targetsValid || !planValid)
    violations.push({
      code: 'invalid_task_fields',
      message: '总 Agent 返回了无效的能力标识、镜头目标或后续计划。',
    });
  if (
    actionValid &&
    actionId !== 'stop' &&
    typeof raw.roleId === 'string' &&
    !roles.some((r) => r.id === raw.roleId)
  )
    violations.push({ code: 'role_disabled', message: '总 Agent 选择了未启用岗位。' });
  const action = actionValid ? getAgentAction(actionId as AutoDecision['action']) : undefined;
  if (actionValid && action) {
    for (const precondition of action.preconditions)
      if (!precondition.satisfied(p))
        violations.push({ code: precondition.id, message: precondition.message });
  }
  // Capability-first routing: a decision may omit roleId when it declares a
  // capability — the router then assigns the eligible agent. The declared
  // capability must itself satisfy the action's requirement.
  const declaredCapability =
    capabilityValid && typeof raw.capability === 'string'
      ? (raw.capability as CapabilityId)
      : undefined;
  let resolvedRoleId = rawRoleId;
  if (
    actionValid &&
    actionId !== 'stop' &&
    action &&
    !resolvedRoleId &&
    declaredCapability &&
    satisfiesCapabilityRequirement([declaredCapability], action.capabilityRequirement)
  ) {
    resolvedRoleId = routeCapability(roles, declaredCapability)?.id;
  }
  const granted =
    actionId !== 'stop'
      ? [...grantedCapabilities(roles.find((r) => r.id === resolvedRoleId))]
      : [];
  if (actionValid && actionId !== 'stop' && action) {
    if (!resolvedRoleId && !declaredCapability) {
      // Same historical message for a missing role with no routing capability.
      if (violations.every((v) => v.code !== 'role_disabled'))
        violations.push({ code: 'role_disabled', message: '总 Agent 选择了未启用岗位。' });
    } else if (!resolvedRoleId) {
      violations.push({
        code: 'capability_missing',
        message:
          '没有已启用岗位授予执行「' +
          actionId +
          '」所需的能力（' +
          capabilityLabel(action.capabilityRequirement) +
          '）。请在岗位配置中补充能力。',
      });
    } else if (!satisfiesCapabilityRequirement(granted, action.capabilityRequirement)) {
      // Single interpreter shared with the action catalog — no drift possible.
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
  }
  const decision: AutoDecision = {
    roleId: resolvedRoleId ?? 'producer',
    action: actionId as AutoDecision['action'],
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    ...(capabilityValid && typeof raw.capability === 'string'
      ? { capability: raw.capability }
      : {}),
    ...(targetsValid && Array.isArray(raw.targets) ? { targets: raw.targets as string[] } : {}),
    ...(planValid && Array.isArray(raw.plan)
      ? {
          plan: (raw.plan as Record<string, unknown>[]).map((entry) => ({
            action: entry.action as AutoDecision['action'],
            reason: entry.reason as string,
            ...(typeof entry.roleId === 'string' ? { roleId: entry.roleId } : {}),
          })),
        }
      : {}),
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

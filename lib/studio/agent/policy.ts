import { projectAgents } from '../team-config.ts';
import { autoActions } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import { getAgentAction } from './actions/registry.ts';
import { grantedCapabilities } from './capabilities.ts';
import type { CapabilityId } from './capabilities.ts';
import type { AutoDecision } from './planner.ts';

/**
 * Policy Engine: the single authority for whether a proposed agent decision
 * may execute. Planner prompts and UI hints describe rules; this module is
 * where allow / deny actually happens. The verdict doubles as the structured
 * explanation the observation and future task UI can render.
 */
export type PolicyViolation = { code: string; message: string };
export type PolicyVerdict = {
  allowed: boolean;
  actionId: string;
  requiredCapabilities: readonly CapabilityId[];
  grantedCapabilities: readonly CapabilityId[];
  requiresVerification: boolean;
  effects: readonly string[];
  violations: PolicyViolation[];
};

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
  if (actionValid && actionId === 'revise_shots' && !p.plan)
    violations.push({ code: 'storyboard_missing', message: '没有分镜可修改。' });
  if (actionValid && actionId === 'design_assets' && !p.production?.assets)
    violations.push({
      code: 'assets_missing',
      message: '请先确认剧本并建立美术设定。',
    });
  const action = actionValid ? getAgentAction(actionId as AutoDecision['action']) : undefined;
  const granted = actionId !== 'stop' ? [...grantedCapabilities(roles.find((r) => r.id === roleId))] : [];
  if (actionValid && actionId !== 'stop' && action && action.requiredCapabilities.length) {
    const authorized = action.requiredCapabilities.some((c) => granted.includes(c));
    if (!authorized)
      violations.push({
        code: 'capability_missing',
        message:
          '总 Agent 选择的岗位未授予执行「' +
          actionId +
          '」所需的能力（' +
          action.requiredCapabilities.join('/') +
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
      requiredCapabilities: action?.requiredCapabilities ?? [],
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

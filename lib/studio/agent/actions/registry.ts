import type { AgentDefinition } from '../../team-config.ts';
import type { Project } from '../../types.ts';
import { capabilitiesForRole } from '../capabilities.ts';
import type { CapabilityId } from '../capabilities.ts';
import type { AgentAction } from './types.ts';
import { reviewAction } from './review.ts';
import { reviseStoryboardAction } from './revise-storyboard.ts';
import { writeScriptAction } from './write-script.ts';
import { designAssetsAction } from './design-assets.ts';
import { stopAction } from './stop.ts';

/**
 * ActionRegistry. The whitelisted action space of the supervisor.
 * Adding a new action means adding a validated, bounded executor here —
 * never granting the planner a generic project-mutation tool.
 */
export const agentActions = [
  reviewAction,
  reviseStoryboardAction,
  writeScriptAction,
  designAssetsAction,
  stopAction,
] as const satisfies readonly AgentAction[];

const byId = new Map<string, AgentAction>(agentActions.map((a) => [a.id, a]));

export function getAgentAction(action: string): AgentAction {
  const registered = byId.get(action);
  if (!registered) throw new Error('总 Agent 选择了未注册的动作。');
  return registered;
}

export function registeredAgentActions(): readonly string[] {
  return agentActions.map((a) => a.id);
}

/**
 * Data-driven action catalog for the planner observation: what each action
 * does, which capability authorizes it, whether the current team can perform
 * it and why not. This is the seed for shrinking the supervisor prompt — the
 * runtime facts stop being repeated as prose.
 */
export function describeAvailableActions(
  roles: readonly AgentDefinition[],
  p: Project,
): {
  action: string;
  description: string;
  requiredCapabilities: readonly CapabilityId[];
  requiresVerification: boolean;
  effects: readonly string[];
  allowed: boolean;
  reasons: string[];
}[] {
  return agentActions.map((a) => {
    const reasons: string[] = [];
    if (a.requiredCapabilities.length) {
      const capable = roles.filter((r) =>
        a.requiredCapabilities.some((c) => capabilitiesForRole(r.id, roles).includes(c)),
      );
      if (!capable.length)
        reasons.push('没有已启用岗位授予所需能力（' + a.requiredCapabilities.join('/') + '）。');
    }
    if (a.id === 'revise_shots' && !p.plan) reasons.push('当前没有分镜。');
    if (a.id === 'design_assets' && !p.production?.assets) reasons.push('尚未建立美术设定。');
    return {
      action: a.id,
      description: a.description,
      requiredCapabilities: a.requiredCapabilities,
      requiresVerification: a.requiresVerification,
      effects: a.effects,
      allowed: reasons.length === 0,
      reasons,
    };
  });
}

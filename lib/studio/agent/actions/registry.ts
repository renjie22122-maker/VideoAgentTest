import type { AgentDefinition } from '../../team-config.ts';
import type { Project } from '../../types.ts';
import { capabilitiesForRole, satisfiesCapabilityRequirement } from '../capabilities.ts';
import type { AgentAction, CapabilityRequirement } from './types.ts';
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
 * does, which capability authorizes it, what it needs, whether the current
 * team can perform it and why not. This is the single truth source for the
 * supervisor's allowedActions — the prompt no longer repeats action facts
 * as prose.
 */
export function describeAllowedActions(
  roles: readonly AgentDefinition[],
  p: Project,
): {
  action: string;
  description: string;
  approval: string;
  capabilityRequirement: CapabilityRequirement;
  requiresVerification: boolean;
  effects: readonly string[];
  allowed: boolean;
  reasons: string[];
}[] {
  return agentActions.map((a) => {
    const reasons: string[] = [];
    const requirement = a.capabilityRequirement;
    const needed = [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])];
    if (needed.length) {
      // Same interpreter as the policy engine: absent side = satisfied.
      const capable = roles.filter((r) =>
        satisfiesCapabilityRequirement(capabilitiesForRole(r.id, roles), requirement),
      );
      if (!capable.length)
        reasons.push('没有已启用岗位授予所需能力（' + needed.join('/') + '）。');
    }
    for (const precondition of a.preconditions)
      if (!precondition.satisfied(p)) reasons.push(precondition.message);
    return {
      action: a.id,
      description: a.description,
      approval: a.approval,
      capabilityRequirement: requirement,
      requiresVerification: a.requiresVerification,
      effects: a.effects,
      allowed: reasons.length === 0,
      reasons,
    };
  });
}

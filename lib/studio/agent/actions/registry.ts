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

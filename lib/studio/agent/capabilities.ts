import type { AutoDecision } from './planner.ts';
import type { CapabilityRequirement } from './actions/types.ts';

/**
 * Capability model: separates "who an agent is" (role) from "what it can do"
 * (capability). The supervisor keeps choosing roleId today for compatibility;
 * the runtime derives the capability for routing, task records and future
 * capability-based planning.
 *
 * Authorization is strict: capabilityForDecision above is descriptive
 * metadata only. The policy engine (agent/policy.ts) refuses capability-
 * required actions for roles without an explicit or default grant — custom
 * roles must declare capabilities in the agent config, they never inherit
 * permission by fallback.
 */
export type CapabilityId =
  | 'plan_work'
  | 'clarify_brief'
  | 'write_screenplay'
  | 'review_story'
  | 'design_storyboard'
  | 'revise_storyboard'
  | 'review_camera'
  | 'review_continuity'
  | 'design_art'
  | 'design_character'
  | 'design_environment'
  | 'design_prop'
  | 'design_action'
  | 'design_vfx'
  | 'design_sound'
  | 'compile_edit'
  | 'compile_video_prompt'
  | 'verify_storyboard'
  | 'review_qa'
  | 'execute_media';

export const capabilityLabels: Record<CapabilityId, string> = {
  plan_work: '任务规划与分派',
  clarify_brief: '创意澄清',
  write_screenplay: '编剧',
  review_story: '故事审查',
  design_storyboard: '分镜设计',
  revise_storyboard: '分镜修订',
  review_camera: '摄影语言审查',
  review_continuity: '连续性审查',
  design_art: '美术统合设计',
  design_character: '人物设计',
  design_environment: '场景设计',
  design_prop: '道具设计',
  design_action: '动作表演设计',
  design_vfx: '视觉特效设计',
  design_sound: '声音设计',
  compile_edit: '剪辑组装',
  compile_video_prompt: '提示词编译',
  verify_storyboard: '独立分镜复核',
  review_qa: '质量审查',
  execute_media: '媒体执行',
};

/** Default capability grants for the built-in film team roles. */
export const defaultRoleCapabilities: Record<string, readonly CapabilityId[]> = {
  producer: ['plan_work', 'review_story'],
  development: ['clarify_brief'],
  writer: ['write_screenplay', 'review_story'],
  director: ['review_story', 'design_storyboard', 'revise_storyboard', 'review_camera', 'verify_storyboard'],
  storyboard: ['design_storyboard', 'revise_storyboard'],
  camera: ['review_camera', 'review_continuity'],
  art: ['design_art', 'design_character', 'design_environment', 'design_prop'],
  character_art: ['design_character'],
  environment_art: ['design_environment'],
  prop_art: ['design_prop'],
  action: ['design_action', 'review_continuity'],
  vfx: ['design_vfx', 'review_qa'],
  continuity: ['review_continuity', 'verify_storyboard'],
  sound: ['design_sound', 'review_story'],
  editor: ['compile_edit'],
  executor: ['compile_video_prompt', 'execute_media'],
  reviewer: ['verify_storyboard', 'review_qa'],
};

export function capabilitiesForRole(
  roleId: string,
  agents?: readonly { id: string; capabilities?: readonly CapabilityId[] }[],
): readonly CapabilityId[] {
  const declared = agents?.find((a) => a.id === roleId)?.capabilities;
  // Presence, not length: capabilities: [] means "explicitly revoke everything".
  if (declared !== undefined) return declared;
  return defaultRoleCapabilities[roleId] ?? [];
}

/** A role id string or a partial agent definition; grants resolve declared → default → none. */
export type CapabilityHolder =
  | string
  | { id?: string; capabilities?: readonly CapabilityId[] };

export function grantedCapabilities(holder: CapabilityHolder | undefined): readonly CapabilityId[] {
  if (!holder) return [];
  if (typeof holder === 'string') return defaultRoleCapabilities[holder] ?? [];
  if (holder.capabilities !== undefined) return holder.capabilities;
  if (!holder.id) return [];
  return defaultRoleCapabilities[holder.id] ?? [];
}

/**
 * The single interpreter for capability requirements, shared by the policy
 * engine (authorization) and the action catalog (planner view), so the two
 * can never drift. An absent side of the requirement is always satisfied.
 */
export function satisfiesCapabilityRequirement(
  granted: readonly CapabilityId[],
  requirement: CapabilityRequirement,
): boolean {
  const allOfOk = !requirement.allOf || requirement.allOf.every((c) => granted.includes(c));
  const anyOfOk = !requirement.anyOf || requirement.anyOf.some((c) => granted.includes(c));
  return allOfOk && anyOfOk;
}

/**
 * Derive the capability a decision exercises, for task records and routing
 * metadata. This is DESCRIPTIVE: unknown roles fall back to the action's
 * canonical capability so records stay informative. AUTHORIZATION is separate
 * and strict — see agent/policy.ts, which never grants via fallback.
 */
export function capabilityForDecision(
  role: CapabilityHolder | undefined,
  action: AutoDecision['action'],
): CapabilityId {
  const granted = grantedCapabilities(role);
  const first = (...preferred: CapabilityId[]) =>
    preferred.find((c) => granted.includes(c));
  switch (action) {
    case 'review':
      return (
        first('review_camera', 'review_continuity', 'review_qa', 'review_story') ??
        'review_story'
      );
    case 'revise_shots':
      return first('revise_storyboard', 'design_storyboard') ?? 'revise_storyboard';
    case 'write_script':
      return first('write_screenplay') ?? 'write_screenplay';
    case 'design_assets':
      return (
        first('design_character', 'design_environment', 'design_prop', 'design_art') ??
        'design_art'
      );
    case 'stop':
      return 'plan_work';
  }
}

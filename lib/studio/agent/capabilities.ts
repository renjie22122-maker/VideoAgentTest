import type { AutoDecision } from './planner.ts';

/**
 * Capability model: separates "who an agent is" (role) from "what it can do"
 * (capability). The supervisor keeps choosing roleId today for compatibility;
 * the runtime derives the capability for routing, task records and future
 * capability-based planning. Custom agent configs with unknown role ids fall
 * back to the action-derived capability instead of failing.
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
  director: ['review_story', 'design_storyboard', 'revise_storyboard', 'review_camera'],
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

export function capabilitiesForRole(roleId: string): readonly CapabilityId[] {
  return defaultRoleCapabilities[roleId] ?? [];
}

/**
 * Derive the capability a decision exercises. Known roles prefer their
 * granted capabilities; unknown roles (custom agent configs) degrade to the
 * action's canonical capability so the runtime never rejects valid work.
 */
export function capabilityForDecision(
  roleId: string,
  action: AutoDecision['action'],
): CapabilityId {
  const granted = capabilitiesForRole(roleId);
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

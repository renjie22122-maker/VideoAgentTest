import { roleJSON } from '../../providers.ts';
import { skillGuide } from '../../skills.ts';
import { DIRECTOR_SCHEMA, validateDirectorPlan } from '../../director.ts';
import { contentFingerprint } from '../../auto-progress.ts';
import { invalidateFrom } from '../../domain.ts';
import { reopenStoryboard } from '../../graph.ts';
import { noProgress } from '../run-controller.ts';
import { unresolvedFindings } from '../observation.ts';
import type { Shot } from '../../types.ts';
import type { AgentAction } from './types.ts';

/** Comparable content identity of one shot: creative fields only, no transport. */
const shotContentKey = (shot: Shot) =>
  JSON.stringify({
    scene: shot.scene,
    title: shot.title,
    beat: shot.beat,
    description: shot.description,
    dialogue: shot.dialogue,
    sound: shot.sound,
    duration: shot.duration,
    size: shot.size,
    transition: shot.transition,
    camera: shot.camera,
    startState: shot.startState,
    endState: shot.endState,
    motion: shot.motion,
    intent: shot.intent,
    performance: shot.performance,
    soundCues: shot.soundCues,
    narrative: shot.narrative,
  });

/**
 * Storyboard revision: validated full-plan replacement with TARGETED
 * precision. When the decision carries targets, the model is told to only
 * change those shots and every non-targeted shot is preserved exactly, so
 * invalidation starts at the first affected index instead of wiping the
 * whole downstream.
 */
export const reviseStoryboardAction: AgentAction = {
  id: 'revise_shots',
  description: '修订分镜（可仅修订指定镜头），保留已确认剧本、对白与场次时长；下游素材与批准按受影响范围失效。',
  approval: '后续必须由另一岗位复核，之后仍需用户批准生成。',
  capabilityRequirement: { anyOf: ['revise_storyboard'] },
  preconditions: [
    { id: 'storyboard_exists', label: '存在分镜', message: '没有分镜可修改。', satisfied: (p) => !!p.plan },
  ],
  effects: ['storyboard', 'prompts', 'media', 'approvals'],
  requiresVerification: true,
  async execute(ctx) {
    const { project: p, run, decision, role, entry, contentBefore: before } = ctx;
    const targets = (decision.targets ?? []).filter((id) =>
      p.plan?.shots.some((s) => s.id === id),
    );
    const targetClause = targets.length
      ? ' 只修改以下镜头，其余镜头必须原样保留：' + targets.join('、') + '。'
      : '';
    const result = await roleJSON(
      role!.name,
      skillGuide('director', p) +
        DIRECTOR_SCHEMA +
        role!.checks +
        ' 输出 {shots:[完整镜头结构]}，保持已确认剧本全部对白、剧情、场次与各场时长。逐项处理 continuityReview 和 reports 的意见；不盲从建议，不删改对白，不修改剧本，可在同场内重新分配镜头时长。只修复有依据的问题，不编造 URL。交叉剪辑时按各场各叙事线核对对白，不要求播放顺序等同剧本场次排列。' +
        targetClause,
      { ...ctx.observation, currentPlan: p.plan, task: decision.reason, targets },
      { model: role!.model },
    );
    const plan = validateDirectorPlan(result, p, true);
    // Targeted revision: preserve every non-targeted shot exactly; full
    // revision: preserve transport inputs on unchanged shots.
    let firstChanged = 0;
    for (let i = 0; i < plan.shots.length; i++) {
      const shot = plan.shots[i];
      const previous = p.plan?.shots.find(
        (s) => s.id === shot.id && s.scene === shot.scene,
      );
      if (targets.length && previous && !targets.includes(shot.id)) {
        plan.shots[i] = structuredClone(previous);
        continue;
      }
      if (previous?.videoInput) shot.videoInput = previous.videoInput;
      if (!previous || shotContentKey(previous) !== shotContentKey(shot)) {
        if (firstChanged === 0) firstChanged = i;
      }
    }
    const candidate = { ...p, plan };
    const after = contentFingerprint(candidate);
    if (
      after === before ||
      run.log.some((log) => log.inputFingerprint === after && log.outcome === 'modified')
    ) {
      noProgress(
        run,
        after === before
          ? '分镜结果与现有内容相同。'
          : '检测到分镜修改回到了本轮先前版本。',
      );
      entry.outcome = 'unchanged';
    } else {
      const previousFindings = unresolvedFindings(p)
        .map((f) => ({
          shotId: f.shotId,
          evidence: f.evidence,
          suggestion: f.suggestion,
        }))
        .slice(0, 40);
      p.plan = plan;
      // Precise invalidation: only the affected suffix loses its media.
      invalidateFrom(p, firstChanged);
      reopenStoryboard(p);
      run.pendingReview = {
        revision: p.revision,
        authorRoleId: decision.roleId,
        reason: decision.reason,
        previousFindings,
      };
      run.summary = targets.length
        ? '已仅修订 ' +
          targets.length +
          ' 个镜头（自 ' +
          plan.shots[firstChanged]?.id +
          ' 起失效），下一步由另一岗位复核；尚未确认通过。'
        : '分镜文字已修改，下一步由另一岗位复核；下游素材已失效，尚未确认通过。';
      entry.outcome = 'modified';
      entry.message +=
        targets.length
          ? '【实际结果：已保存定向修订（' + targets.join('、') + '），待独立文本复核。】'
          : '【实际结果：已保存修订分镜，待独立文本复核。】';
    }
  },
};

import { roleJSON } from '../../providers.ts';
import { skillGuide } from '../../skills.ts';
import { DIRECTOR_SCHEMA, validateDirectorPlan } from '../../director.ts';
import { contentFingerprint } from '../../auto-progress.ts';
import { invalidateFrom } from '../../domain.ts';
import { reopenStoryboard } from '../../graph.ts';
import { noProgress } from '../run-controller.ts';
import { unresolvedFindings } from '../observation.ts';
import type { AgentAction } from './types.ts';

/**
 * Storyboard revision: validated full-plan replacement only. Downstream
 * invalidation is explicit and the AUTHOR != VERIFIER gate is armed by
 * setting pendingReview; the next step is forced into an independent review.
 */
export const reviseStoryboardAction: AgentAction = {
  id: 'revise_shots',
  description: '修订完整分镜，保留已确认剧本、对白与场次时长；下游素材与批准随之失效。',
  approval: '后续必须由另一岗位复核，之后仍需用户批准生成。',
  capabilityRequirement: { anyOf: ['revise_storyboard'] },
  preconditions: [
    { id: 'storyboard_exists', label: '存在分镜', message: '没有分镜可修改。', satisfied: (p) => !!p.plan },
  ],
  effects: ['storyboard', 'prompts', 'media', 'approvals'],
  requiresVerification: true,
  async execute(ctx) {
    const { project: p, run, decision, role, entry, contentBefore: before } = ctx;
    const result = await roleJSON(
      role!.name,
      skillGuide('director', p) +
        DIRECTOR_SCHEMA +
        role!.checks +
        ' 输出 {shots:[完整镜头结构]}，保持已确认剧本全部对白、剧情、场次与各场时长。逐项处理 continuityReview 和 reports 的意见；不盲从建议，不删改对白，不修改剧本，可在同场内重新分配镜头时长。只修复有依据的问题，不编造 URL。交叉剪辑时按各场各叙事线核对对白，不要求播放顺序等同剧本场次排列。',
      { ...ctx.observation, currentPlan: p.plan, task: decision.reason },
      { model: role!.model },
    );
    const plan = validateDirectorPlan(result, p, true);
    for (const shot of plan.shots) {
      const previous = p.plan?.shots.find(
        (s) => s.id === shot.id && s.scene === shot.scene,
      );
      if (previous?.videoInput) shot.videoInput = previous.videoInput;
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
      invalidateFrom(p, 0);
      reopenStoryboard(p);
      run.pendingReview = {
        revision: p.revision,
        authorRoleId: decision.roleId,
        reason: decision.reason,
        previousFindings,
      };
      run.summary =
        '分镜文字已修改，下一步由另一岗位复核；下游素材已失效，尚未确认通过。';
      entry.outcome = 'modified';
      entry.message += '【实际结果：已保存修订分镜，待独立文本复核。】';
    }
  },
};

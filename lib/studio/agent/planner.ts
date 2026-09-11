import { roleJSON } from '../providers.ts';
import { autoActions } from '../auto-run-state.ts';
import type { AutoRun } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AgentObservation } from './observation.ts';
import { assertAutoDecision } from './policy.ts';

export type AutoDecision = {
  roleId: string;
  action: (typeof autoActions)[number];
  reason: string;
  /** Optional routing/record hints; the runtime records them on the task. */
  capability?: string;
  targets?: string[];
  /** Optional follow-up task plan, executed sequentially via the scheduler. */
  plan?: { action: (typeof autoActions)[number]; roleId?: string; reason: string }[];
};

/** Compatibility wrapper: the policy engine is the single allow/deny authority. */
export function validateAutoDecision(
  raw: Record<string, unknown>,
  p: Project,
): AutoDecision {
  return assertAutoDecision(raw, p);
}

export type PlanOutcome =
  | { kind: 'pause' }
  | {
      kind: 'decision';
      decision: AutoDecision;
      requiredReview: AutoDecision | undefined;
    };

/**
 * The planner proposes, the runtime disposes. Pending storyboard revisions
 * are NOT handled here: the runtime migrates pendingReview into an explicit
 * verification task and the scheduler owns it — one rule set, no fallback
 * path that could re-plan around a blocked dependency.
 */
export async function planDecision(
  p: Project,
  run: AutoRun,
  observation: AgentObservation,
  assigned?: AutoDecision,
): Promise<PlanOutcome> {
  const supervisor = observation.roles.find((r) => r.id === 'producer');
  const raw =
    assigned ??
    (p.mode === 'demo'
      ? {
          roleId: observation.roles[0].id,
          action: run.steps ? 'stop' : 'review',
          reason: '演示自动调度，不修改真实内容。',
        }
      : await roleJSON(
          '总 Agent 调度器',
          '选择下一项最有价值的文本任务。返回 {roleId,action,reason}，可附加 capability（能力 ID）、targets（镜头 ID 列表）与 plan（最多 3 项按顺序执行的后续任务，每项 {action,roleId?,reason}）。allowedActions 由运行时按当前状态计算，按其 description、approval、effects 及 allowed/reasons 选择；未被允许的动作不可选。判断实际执行结果，不把建议、候选或尚待复核的修改当作完成。qualityReport 为本地确定性检查，error 必须解决或请求人工裁决，warning 是需判断的风险而不是强行改写理由；不可将缺失资料伪装已核验。禁止生成图片、视频、启动队列或变更用户批准。剧本修改后必须等待人工确认。新增不可或缺资产候选时提示人工补图；仅新增建议或可选资产时继续文字工作，不要求先确认所有图。遵循 assetPolicy 和 assetReadiness 的等级，不能因非必要参考图缺失而删除剧情。预算不足不是成功；unresolvedTextFindings 是当前尚待处理的文本意见，非空时不得声称无问题或已经通过，可继续修订或明确请求人工裁决；部门会审不会自动完成场记确认、提示词编译或用户批准，应按 stage 说明实际下一步。修改分镜后系统将强制安排独立文本复核。',
          observation,
          { model: supervisor?.model },
        ));
  const decision = validateAutoDecision(raw, p);
  return { kind: 'decision', decision, requiredReview: undefined };
}

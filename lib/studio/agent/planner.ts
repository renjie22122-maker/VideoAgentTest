import { roleJSON } from '../providers.ts';
import { projectAgents } from '../team-config.ts';
import { autoActions } from '../auto-run-state.ts';
import type { AutoRun } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AgentObservation } from './observation.ts';

export type AutoDecision = {
  roleId: string;
  action: (typeof autoActions)[number];
  reason: string;
};

export function validateAutoDecision(
  raw: Record<string, unknown>,
  p: Project,
): AutoDecision {
  const roles = projectAgents(p).filter((r) => r.enabled);
  if (
    !autoActions.includes(raw.action as AutoDecision['action']) ||
    typeof raw.reason !== 'string' ||
    !raw.reason.trim() ||
    raw.reason.length > 1500
  )
    throw new Error('总 Agent 返回了不允许的动作或无效理由。');
  if (raw.action !== 'stop' && !roles.some((r) => r.id === raw.roleId))
    throw new Error('总 Agent 选择了未启用岗位。');
  if (raw.action === 'revise_shots' && !p.plan)
    throw new Error('没有分镜可修改。');
  if (raw.action === 'design_assets' && !p.production?.assets)
    throw new Error('请先确认剧本并建立美术设定。');
  return {
    roleId: typeof raw.roleId === 'string' ? raw.roleId : 'producer',
    action: raw.action as AutoDecision['action'],
    reason: raw.reason,
  };
}

export type PlanOutcome =
  | { kind: 'pause' }
  | {
      kind: 'decision';
      decision: AutoDecision;
      requiredReview: AutoDecision | undefined;
    };

/**
 * The planner proposes, the runtime disposes. This resolves a next decision
 * (assigned, demo, or LLM supervisor) and — when a storyboard revision is
 * pending — forces an independent reviewer before any other work can proceed.
 */
export async function planDecision(
  p: Project,
  run: AutoRun,
  observation: AgentObservation,
  assigned?: AutoDecision,
): Promise<PlanOutcome> {
  const roles = observation.roles;
  let requiredReview: AutoDecision | undefined;
  if (run.pendingReview) {
    const reviewer =
      ['reviewer', 'continuity', 'director']
        .map((id) =>
          roles.find((r) => r.id === id && r.id !== run.pendingReview!.authorRoleId),
        )
        .find(Boolean) ??
      roles.find(
        (r) =>
          r.id !== run.pendingReview!.authorRoleId &&
          r.stages.some((s) => s === 'qa' || s === 'continuity'),
      );
    if (!reviewer) {
      run.status = 'waiting_user';
      run.stopReason = 'review_required';
      run.summary =
        '分镜已修改，缺少另一名已启用的会审岗位。请启用场记或质量审查后继续；尚未通过复核。';
      return { kind: 'pause' };
    }
    requiredReview = {
      roleId: reviewer.id,
      action: 'review',
      reason:
        '复核上一轮分镜修改，逐项核对原问题是否解决及是否引入新问题；仅评估当前版本文本。',
    };
  }
  const supervisor = roles.find((r) => r.id === 'producer');
  const raw =
    requiredReview ??
    assigned ??
    (p.mode === 'demo'
      ? {
          roleId: roles[0].id,
          action: run.steps ? 'stop' : 'review',
          reason: '演示自动调度，不修改真实内容。',
        }
      : await roleJSON(
          '总 Agent 调度器',
          '选择下一项最有价值的文本任务。返回 {roleId,action,reason}。遵循 allowedActions 中的交付物及批准规则。判断实际执行结果，不把建议、候选或尚待复核的修改当作完成。qualityReport 为本地确定性检查，error 必须解决或请求人工裁决，warning 是需判断的风险而不是强行改写理由；不可将缺失资料伪装已核验。review=部门会审；revise_shots=自动修正完整分镜；write_script=生成或修改剧本；design_assets=新增资产设计候选（不生图）；stop=停止并说明剩余事项。同一资产多个候选且只有一个 approved=true 是正常版本管理，不是重复批准或连续性错误。按 familyId 和 viewId 区分主图、候选、细节及服装套组；retired 资产不参与当前判断。design_assets 只能新增未批准设计候选，不能合并、删除或选择版本。优先解决有证据的问题，不反复做同一任务。禁止生成图片、视频、启动队列或变更用户批准。剧本修改后必须等待人工确认。新增不可或缺资产候选时提示人工补图；仅新增建议或可选资产时继续文字工作，不要求先确认所有图。遵循 assetPolicy 和 assetReadiness 的等级，不能因非必要参考图缺失而删除剧情。预算不足不是成功；unresolvedTextFindings 是当前尚待处理的文本意见，非空时不得声称无问题或已经通过，可继续修订或明确请求人工裁决；部门会审不会自动完成场记确认、提示词编译或用户批准，应按 stage 说明实际下一步。修改分镜后系统将强制安排独立文本复核。',
          observation,
          { model: supervisor?.model },
        ));
  const decision = validateAutoDecision(raw, p);
  return { kind: 'decision', decision, requiredReview };
}

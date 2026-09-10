import { unresolvedFindings } from '../observation.ts';
import type { AgentAction } from './types.ts';

/**
 * Stop: the supervisor's own success claim is verified by the deterministic
 * state machine. Outstanding findings downgrade the claim to waiting_user.
 */
export const stopAction: AgentAction = {
  id: 'stop',
  async execute(ctx) {
    const { project: p, run, decision, entry } = ctx;
    const remaining = unresolvedFindings(p);
    run.status = remaining.length ? 'waiting_user' : 'completed';
    run.stopReason = remaining.length ? 'unresolved_findings' : 'completed';
    run.summary = remaining.length
      ? '总 Agent 停止了本轮协作，但当前版本仍有 ' +
        remaining.length +
        ' 项文本问题，需要进一步修订或人工裁决。'
      : p.mode === 'demo'
        ? '演示协作已结束，未进行真实模型质量评估。'
        : '总 Agent 已结束本轮文本协作；不代表图片或视频已经通过质量审查。';
    entry.modelReason = decision.reason;
    entry.message =
      run.summary +
      '【实际结果：已停止文本协作，未批准生成，未启动图片或视频任务。】';
    entry.outcome = 'stopped';
  },
};

import { runTeamReview } from '../../team-runtime.ts';
import { unresolvedFindings } from '../observation.ts';
import { openVerificationTask } from '../task.ts';
import type { AgentAction } from './types.ts';

/**
 * Department text review. A review never mutates creative content and never
 * claims visual verification; when it verifies a pending storyboard revision,
 * it must clear the pending review gate and re-check deterministic findings.
 */
export const reviewAction: AgentAction = {
  id: 'review',
  description: '部门文本会审：按当前修订出具结构化报告，不修改作品，不声称看过画面。',
  approval: '不代表实际画面通过。',
  capabilityRequirement: { anyOf: ['review_story', 'review_camera', 'review_continuity', 'review_qa'] },
  preconditions: [],
  effects: ['teamReports'],
  requiresVerification: false,
  async execute(ctx) {
    const { project: p, run, decision, requiredReview, entry } = ctx;
    const { report } = await runTeamReview(p, decision.roleId, {
      verification: run.pendingReview,
    });
    entry.outcome = 'reviewed';
    entry.message +=
      '【实际结果：文本会审发现 ' +
      report.findings.filter((f) => f.severity !== 'note').length +
      ' 项待处理问题，不涉及画面检测。】';
    if (requiredReview && report.mode === 'demo') {
      run.status = 'waiting_user';
      run.stopReason = 'review_required';
      run.summary =
        '演示报告无法完成修订后的真实复核。请切换真实语言模型或人工审阅；待复核标记保留。';
    } else if (requiredReview) {
      // The AUTHOR != VERIFIER gate: only an independent reviewer can close
      // the verification task opened when pendingReview was set.
      const verificationTask = openVerificationTask(run);
      delete run.pendingReview;
      if (verificationTask) {
        verificationTask.status = 'completed';
        verificationTask.ownerRoleId = decision.roleId;
        verificationTask.result = { outcome: 'reviewed' };
        verificationTask.updatedAt = Date.now();
      }
      const remaining = unresolvedFindings(p);
      if (!remaining.length) {
        run.status = 'completed';
        run.stopReason = 'completed';
        run.summary =
          '分镜修改已完成独立文本复核，本次复核未报告待修问题；生成前仍需用户批准，实际画面尚未验收。';
      } else
        run.summary =
          '独立文本复核与结构检查仍有 ' +
          remaining.length +
          ' 项待处理问题，将在剩余步数内继续协调修订。';
    }
  },
};

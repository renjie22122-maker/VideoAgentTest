import { projectAgents } from './team-config.ts';
import { validateTeamReport } from './team.ts';
import { roleJSON } from './providers.ts';
import type { Project } from './types.ts';
import type { PendingAutoReview } from './auto-run-state.ts';
import { skillGuide } from './skills.ts';
import { buildQualityReport } from './quality-report.ts';
export async function runTeamReview(p: Project, roleId: unknown, options: { verification?: PendingAutoReview } = {}) {
  const roles = projectAgents(p).filter((a) => a.enabled);
  const input = { roleId };
  const role = roles.find((r) => r.id === input.roleId);
  if (!role?.enabled) throw new Error('请选择有效部门。');
  const raw =
    p.mode === 'demo'
      ? { summary: role.name + '演示报告：尚未运行模型审查。', findings: [] }
      : await roleJSON(
          role.name,
          skillGuide('continuity', p) + '\n交付：' +
            role.deliverable +
            '。' +
            role.checks +
            ' 只审查提供的文本，不声称看过图片或视频。同一资产有多个候选、仅一个批准版本是正常状态，不得报告为批准不一致；按 familyId、viewId 和 costumeOf 区分版本及套组。返回 {summary:string,findings:[{shotId:string, severity:"note"|"warning"|"error", evidence:string, suggestion:string, returnTo:string}]}。全局问题 shotId 为空字符串。returnTo 必须是给定岗位 ID。最多 20 项，证据不足则注明需要人工确认。verification 若存在，这是对修订后当前版本的独立复核：逐条对照 previousFindings 与当前分镜，已经解决的问题不沿用旧结论；未解决或新问题必须引用当前文本证据并给出返工岗位。不得因另一岗位声称已修复就返回空报告。依据各叙事线追踪状态，允许有标注的交叉剪辑与跨镜声音；输出评估只覆盖文本，不是实际视频质量合格证书。',
          {
            idea: p.idea,
            brief: p.brief,
            storyContext: p.storyContext,
            scriptApproved: p.production?.scriptApproved,
            assetBible: p.production?.assets?.bible,
            verification: options.verification,
            qualityReport: buildQualityReport(p),
            duration: p.duration,
            script: p.production?.script,
            plan: p.plan,
            assets: p.production?.library
              ?.filter((a) => !a.retired)
              .map((a) => ({
                id: a.id,
                familyId: a.parentId ?? a.id,
                version: a.version,
                viewId: a.viewId,
                costumeOf: a.costumeOf,
                status: a.status,
                name: a.name,
                design: a.design,
                approved: a.approved,
              })),
            departments: roles.map((r) => ({ id: r.id, name: r.name })),
            previousReports: p.production?.teamReports?.filter(
              (r) =>
                r.revision === p.revision &&
                (r.configRevision ?? 0) ===
                  (p.production?.agentConfigRevision ?? 0),
            ),
          },
          { model: role.model },
        );
  const report = validateTeamReport(raw, p, role.id, roles);
  const g = p.production!;
  g.teamReports = [
    ...(g.teamReports ?? []).filter(
      (r) =>
        !(
          r.roleId === role.id &&
          r.revision === p.revision &&
          (r.configRevision ?? 0) === (p.production?.agentConfigRevision ?? 0)
        ),
    ),
    report,
  ].slice(-100);

  return { role, report };
}

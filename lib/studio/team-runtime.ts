import { projectAgents } from './team-config.ts';
import { validateTeamReport } from './team.ts';
import { roleJSON } from './providers.ts';
import type { Project } from './types.ts';
export async function runTeamReview(p: Project, roleId: unknown) {
  const roles = projectAgents(p).filter((a) => a.enabled);
  const input = { roleId };
  const role = roles.find((r) => r.id === input.roleId);
  if (!role?.enabled) throw new Error('请选择有效部门。');
  const raw =
    p.mode === 'demo'
      ? { summary: role.name + '演示报告：尚未运行模型审查。', findings: [] }
      : await roleJSON(
          role.name,
          '交付：' +
            role.deliverable +
            '。' +
            role.checks +
            ' 只审查提供的文本，不声称看过图片或视频。返回 {summary:string,findings:[{shotId:string, severity:"note"|"warning"|"error", evidence:string, suggestion:string, returnTo:string}]}。全局问题 shotId 为空字符串。returnTo 必须是给定岗位 ID。最多 20 项，证据不足则注明需要人工确认。',
          {
            idea: p.idea,
            duration: p.duration,
            script: p.production?.script,
            plan: p.plan,
            assets: p.production?.library
              ?.filter((a) => !a.retired)
              .map((a) => ({
                id: a.id,
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

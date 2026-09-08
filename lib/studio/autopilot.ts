import { skillGuide } from './skills.ts';
import { DIRECTOR_SCHEMA } from './director.ts';
import { WRITER_GUIDE, demoScreenplay } from './screenplay.ts';
import type { Project } from './types.ts';
import { projectAgents } from './team-config.ts';
import { runTeamReview } from './team-runtime.ts';
import { roleJSON, planAssetLibrary } from './providers.ts';
import { validateDirectorPlan } from './director.ts';
import { validateScreenplay } from './screenplay.ts';
import { invalidateFrom } from './domain.ts';
import { reopenStoryboard } from './graph.ts';
export type AutoRun = {
  status: 'running' | 'completed' | 'stopped' | 'failed';
  steps: number;
  maxSteps: number;
  instruction: string;
  log: { at: number; role: string; action: string; message: string }[];
  error?: string;
};
export const autoActions = [
  'review',
  'revise_shots',
  'write_script',
  'design_assets',
  'stop',
] as const;
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
export async function autoStep(p: Project) {
  const run = p.production?.autoRun;
  if (!run || run.status !== 'running') throw new Error('自动运行未启动。');
  if (run.steps >= run.maxSteps) {
    run.status = 'completed';
    return;
  }
  const roles = projectAgents(p).filter((r) => r.enabled),
    context = {
      instruction: run.instruction,
      stage: p.production!.node,
      roles,
      allowedActions: autoActions,
      remaining: run.maxSteps - run.steps,
      idea: p.idea,
      answers: p.answers,
      brief: p.brief,
      duration: p.duration,
      scriptApproved: p.production!.scriptApproved,
      assets: p.production!.assets,
      library: p.production!.library?.map((a) => ({
        name: a.name,
        design: a.design,
        approved: a.approved,
        retired: a.retired,
      })),
      script: p.production!.script,
      plan: p.plan,
      reports: p.production!.teamReports?.filter(
        (r) =>
          r.revision === p.revision &&
          (r.configRevision ?? 0) === (p.production?.agentConfigRevision ?? 0),
      ),
      history: run.log,
    };
  const supervisor = roles.find((r) => r.id === 'producer');
  const raw =
    p.mode === 'demo'
      ? {
          roleId: roles[0].id,
          action: run.steps ? 'stop' : 'review',
          reason: '演示自动调度，不修改真实内容。',
        }
      : await roleJSON(
          '总 Agent 调度器',
          '选择下一项最有价值的文本任务。返回 {roleId,action,reason}。review=部门会审；revise_shots=自动修正完整分镜；write_script=生成或修改剧本；design_assets=新增资产设计候选（不生图）；stop=无需继续。优先解决有证据的问题，不反复做同一任务。禁止生成图片、视频、启动队列或变更用户批准。剧本修改后必须停止等待人工确认。',
          context,
          { model: supervisor?.model },
        );
  const decision = validateAutoDecision(raw, p),
    role = roles.find((r) => r.id === decision.roleId);
  run.steps++;
  if (decision.action === 'stop') run.status = 'completed';
  else if (decision.action === 'review')
    await runTeamReview(p, decision.roleId);
  else if (decision.action === 'revise_shots') {
    const result = await roleJSON(
      role!.name,
      skillGuide('director', p) +
        DIRECTOR_SCHEMA +
        role!.checks +
        ' 输出 {shots:[完整镜头结构]}，保持已确认剧本全部对白、剧情、场次与各场时长。只修复提供的具体问题，不编造 URL。',
      { ...context, currentPlan: p.plan, task: decision.reason },
      { model: role!.model },
    );
    const plan = validateDirectorPlan(result, p);
    const normalize = (v: string) => v.replace(/[\s\p{P}]/gu, '');
    const dialogue = p
      .production!.script?.scenes?.flatMap((s) => s.dialogue.map((d) => d.line))
      .join('');
    if (
      dialogue !== undefined &&
      normalize(plan.shots.map((s) => s.dialogue).join('')) !==
        normalize(dialogue)
    )
      throw new Error('自动分镜修改改变了已确认对白，已拒绝写入。');
    p.plan = plan;
    invalidateFrom(p, 0);
    reopenStoryboard(p);
  } else if (decision.action === 'write_script') {
    if (p.brief && !p.brief.ready)
      throw new Error('创意仍有关键歧义，请先回答后再自动编剧。');
    const result = await roleJSON(
      role!.name,
      skillGuide('writer', p) +
        WRITER_GUIDE +
        role!.checks +
        ' 输出完整 schemaVersion:2 结构化剧本，遵循现有结构，时长合计必须等于目标。',
      {
        ...context,
        duration: p.duration,
        idea: p.idea,
        answers: p.answers,
        previousScript: p.production!.script,
        outputSchemaExample: demoScreenplay(p),
      },
      { model: role!.model },
    );
    const script = validateScreenplay(result, p.duration),
      g = p.production!;
    if (g.script)
      (g.scriptHistory ??= []).push({ at: Date.now(), script: g.script });
    g.scriptHistory = g.scriptHistory?.slice(-10);
    p.phase = 'clarify';
    g.script = script;
    g.scriptApproved = false;
    g.node = 'script';
    g.assets = undefined;
    g.library = g.library?.map((a) => ({
      ...a,
      retired: true,
      approved: false,
    }));
    delete p.plan;
    p.jobs = p.jobs.map((j) => ({
      ...j,
      status: 'cancelled',
      error: '自动修改剧本后需重新确认。',
    }));
    p.revision++;
    p.title = script.title;
    g.prompts = undefined;
    g.continuityReview = undefined;
    g.renderApprovedRevision = undefined;
    g.qa = [];
    g.editPlan = undefined;
    run.status = 'completed';
  } else if (decision.action === 'design_assets') {
    const assets = await planAssetLibrary(p, {
      model: role!.model,
      role: role!.name,
      checks: role!.checks,
      task: decision.reason,
      repair: false,
    });
    const library = (p.production!.library ??= []);
    if (library.length + assets.length > 160)
      throw new Error('资产候选数量达到上限。');
    library.push(...assets);
    p.production!.library = library;
    run.status = 'completed';
  }
  run.log.push({
    at: Date.now(),
    role: role?.name ?? '总 Agent',
    action: decision.action,
    message: decision.reason,
  });
  if (run.steps >= run.maxSteps) run.status = 'completed';
}

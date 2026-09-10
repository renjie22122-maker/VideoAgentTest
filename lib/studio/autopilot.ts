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
import { autoActions, autoTaskContracts, currentAutoFindings, exhaustAutoRun } from './auto-run-state.ts';
import type { AutoLogEntry, AutoRun } from './auto-run-state.ts';
import { contentFingerprint, sameScript, uniqueAssetCandidates } from './auto-progress.ts';
import { buildQualityReport } from './quality-report.ts';
export { autoActions, createAutoRun, stopAutoRun, failAutoRun } from './auto-run-state.ts';
export type { AutoRun } from './auto-run-state.ts';
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
function noProgress(run: AutoRun, message: string) {
  run.status = 'stopped';
  run.stopReason = 'no_progress';
  run.summary = message + '已停止重复调用，原有作品内容保留。';
}

function unresolvedFindings(p: Project) {
  return [
    ...currentAutoFindings(p),
    ...buildQualityReport(p).findings.filter(f => f.severity === 'error').map(f => ({ shotId: f.shotIds[0] ?? '', evidence: f.evidence, suggestion: f.suggestion })),
    ...(p.production?.continuityReview?.revision === p.revision ? p.production.continuityReview.findings : []),
  ];
}

export async function autoStep(p: Project, assigned?: AutoDecision) {
  const run = p.production?.autoRun;
  if (!run || run.status !== 'running') throw new Error('自动运行未启动。');
  if (run.steps >= run.maxSteps) { exhaustAutoRun(run); return; }
  if (run.pendingReview && run.pendingReview.revision !== p.revision) delete run.pendingReview;
  const roles = projectAgents(p).filter(r => r.enabled);
  const context = {
    instruction: run.instruction, storyContext: p.storyContext, stage: p.production!.node,
    roles, allowedActions: autoTaskContracts, remaining: run.maxSteps - run.steps,
    idea: p.idea, answers: p.answers, brief: p.brief, duration: p.duration,
    scriptApproved: p.production!.scriptApproved, assets: p.production!.assets,
    library: p.production!.library?.map(a => ({
      id: a.id, familyId: a.parentId ?? a.id, version: a.version, viewId: a.viewId,
      costumeOf: a.costumeOf, status: a.status, name: a.name, design: a.design,
      approved: a.approved, retired: a.retired,
    })),
    script: p.production!.script, plan: p.plan,
    reports: p.production!.teamReports?.filter(r => r.revision === p.revision && (r.configRevision ?? 0) === (p.production?.agentConfigRevision ?? 0)),
    continuityReview: p.production?.continuityReview?.revision === p.revision ? p.production.continuityReview : undefined,
    pendingReview: run.pendingReview, history: run.log,
    qualityReport: buildQualityReport(p),
  };
  let requiredReview: AutoDecision | undefined;
  if (run.pendingReview) {
    const reviewer = ['reviewer', 'continuity', 'director'].map(id => roles.find(r => r.id === id && r.id !== run.pendingReview!.authorRoleId)).find(Boolean)
      ?? roles.find(r => r.id !== run.pendingReview!.authorRoleId && r.stages.some(s => s === 'qa' || s === 'continuity'));
    if (!reviewer) {
      run.status = 'waiting_user'; run.stopReason = 'review_required';
      run.summary = '分镜已修改，缺少另一名已启用的会审岗位。请启用场记或质量审查后继续；尚未通过复核。';
      return;
    }
    requiredReview = { roleId: reviewer.id, action: 'review', reason: '复核上一轮分镜修改，逐项核对原问题是否解决及是否引入新问题；仅评估当前版本文本。' };
  }
  const supervisor = roles.find(r => r.id === 'producer');
  const raw = requiredReview ?? assigned ?? (p.mode === 'demo'
    ? { roleId: roles[0].id, action: run.steps ? 'stop' : 'review', reason: '演示自动调度，不修改真实内容。' }
    : await roleJSON('总 Agent 调度器',
      '选择下一项最有价值的文本任务。返回 {roleId,action,reason}。遵循 allowedActions 中的交付物及批准规则。判断实际执行结果，不把建议、候选或尚待复核的修改当作完成。qualityReport 为本地确定性检查，error 必须解决或请求人工裁决，warning 是需判断的风险而不是强行改写理由；不可将缺失资料伪装已核验。review=部门会审；revise_shots=自动修正完整分镜；write_script=生成或修改剧本；design_assets=新增资产设计候选（不生图）；stop=停止并说明剩余事项。同一资产多个候选且只有一个 approved=true 是正常版本管理，不是重复批准或连续性错误。按 familyId 和 viewId 区分主图、候选、细节及服装套组；retired 资产不参与当前判断。design_assets 只能新增未批准设计候选，不能合并、删除或选择版本。优先解决有证据的问题，不反复做同一任务。禁止生成图片、视频、启动队列或变更用户批准。剧本修改和资产候选生成后必须等待人工确认。预算不足不是成功；修改分镜后系统将强制安排独立文本复核。',
      context, { model: supervisor?.model }));
  const decision = validateAutoDecision(raw, p);
  const role = roles.find(r => r.id === decision.roleId);
  const before = contentFingerprint(p), revisionBefore = p.revision;
  const entry: AutoLogEntry = {
    at: Date.now(), role: role?.name ?? '总 Agent', roleId: role?.id,
    action: decision.action, message: decision.reason, revisionBefore,
    inputFingerprint: before,
  };
  run.steps++;
  if (decision.action !== 'stop' && run.log.some(log => log.action === decision.action && log.roleId === decision.roleId && log.inputFingerprint === before)) {
    noProgress(run, '同一岗位对未改变内容重复执行同一任务。');
    entry.outcome = 'unchanged';
  } else if (decision.action === 'stop') {
    const remaining = unresolvedFindings(p);
    run.status = remaining.length ? 'waiting_user' : 'completed';
    run.stopReason = remaining.length ? 'unresolved_findings' : 'completed';
    run.summary = remaining.length
      ? '总 Agent 停止了本轮协作，但当前版本仍有 ' + remaining.length + ' 项文本问题，需要进一步修订或人工裁决。'
      : p.mode === 'demo' ? '演示协作已结束，未进行真实模型质量评估。' : '总 Agent 已结束本轮文本协作；不代表图片或视频已经通过质量审查。';
    entry.outcome = 'stopped';
  } else if (decision.action === 'review') {
    const { report } = await runTeamReview(p, decision.roleId, { verification: run.pendingReview });
    entry.outcome = 'reviewed';
    entry.message += '【实际结果：文本会审发现 ' + report.findings.filter(f => f.severity !== 'note').length + ' 项待处理问题，不涉及画面检测。】';
    if (requiredReview && report.mode === 'demo') {
      run.status = 'waiting_user'; run.stopReason = 'review_required';
      run.summary = '演示报告无法完成修订后的真实复核。请切换真实语言模型或人工审阅；待复核标记保留。';
    } else if (requiredReview) {
      delete run.pendingReview;
      const remaining = unresolvedFindings(p);
      if (!remaining.length) {
        run.status = 'completed'; run.stopReason = 'completed';
        run.summary = '分镜修改已完成独立文本复核，本次复核未报告待修问题；生成前仍需用户批准，实际画面尚未验收。';
      } else run.summary = '独立文本复核与结构检查仍有 ' + remaining.length + ' 项待处理问题，将在剩余步数内继续协调修订。';
    }
  } else if (decision.action === 'revise_shots') {
    const result = await roleJSON(role!.name,
      skillGuide('director', p) + DIRECTOR_SCHEMA + role!.checks +
      ' 输出 {shots:[完整镜头结构]}，保持已确认剧本全部对白、剧情、场次与各场时长。逐项处理 continuityReview 和 reports 的意见；不盲从建议，不删改对白，不修改剧本，可在同场内重新分配镜头时长。只修复有依据的问题，不编造 URL。交叉剪辑时按各场各叙事线核对对白，不要求播放顺序等同剧本场次排列。',
      { ...context, currentPlan: p.plan, task: decision.reason }, { model: role!.model });
    const plan = validateDirectorPlan(result, p, true);
    for (const shot of plan.shots) {
      const previous = p.plan?.shots.find(s => s.id === shot.id && s.scene === shot.scene);
      if (previous?.videoInput) shot.videoInput = previous.videoInput;
    }
    const candidate = { ...p, plan };
    const after = contentFingerprint(candidate);
    if (after === before || run.log.some(log => log.inputFingerprint === after && log.outcome === 'modified')) {
      noProgress(run, after === before ? '分镜结果与现有内容相同。' : '检测到分镜修改回到了本轮先前版本。');
      entry.outcome = 'unchanged';
    } else {
      const previousFindings = unresolvedFindings(p).map(f => ({ shotId: f.shotId, evidence: f.evidence, suggestion: f.suggestion })).slice(0, 40);
      p.plan = plan;
      invalidateFrom(p, 0); reopenStoryboard(p);
      run.pendingReview = { revision: p.revision, authorRoleId: decision.roleId, reason: decision.reason, previousFindings };
      run.summary = '分镜文字已修改，下一步由另一岗位复核；下游素材已失效，尚未确认通过。';
      entry.outcome = 'modified';
      entry.message += '【实际结果：已保存修订分镜，待独立文本复核。】';
    }
  } else if (decision.action === 'write_script') {
    if (p.brief && !p.brief.ready) throw new Error('创意仍有关键歧义，请先回答后再自动编剧。');
    const result = await roleJSON(role!.name,
      skillGuide('writer', p) + WRITER_GUIDE + role!.checks + ' 输出完整 schemaVersion:2 结构化剧本，遵循现有结构，时长合计必须等于目标。',
      { ...context, previousScript: p.production!.script, outputSchemaExample: demoScreenplay(p) }, { model: role!.model });
    const script = validateScreenplay(result, p.duration), g = p.production!;
    if (sameScript(script, g.script)) {
      noProgress(run, '返回的剧本没有实际修改。'); entry.outcome = 'unchanged';
    } else {
      if (g.script) (g.scriptHistory ??= []).push({ at: Date.now(), script: g.script });
      g.scriptHistory = g.scriptHistory?.slice(-10);
      p.phase = 'clarify'; g.script = script; g.scriptApproved = false; g.node = 'script'; g.assets = undefined;
      g.library = g.library?.map(a => ({ ...a, retired: true, approved: false }));
      delete p.plan;
      p.jobs = p.jobs.map(j => ({ ...j, status: 'cancelled', error: '自动修改剧本后需重新确认。' }));
      p.revision++; p.title = script.title;
      g.prompts = undefined; g.continuityReview = undefined; g.renderApprovedRevision = undefined; g.qa = []; g.editPlan = undefined;
      run.status = 'waiting_user'; run.stopReason = 'script_approval';
      run.summary = '新剧本已保存，等待你确认；相关分镜和素材需在确认后重新制作。';
      entry.outcome = 'modified';
      entry.message += '【实际结果：已保存未确认剧本，等待用户确认。】';
    }
  } else if (decision.action === 'design_assets') {
    const assets = await planAssetLibrary(p, { model: role!.model, role: role!.name, checks: role!.checks, task: decision.reason, repair: false });
    const library = p.production!.library ?? [];
    const candidates = uniqueAssetCandidates(assets, library);
    if (!candidates.length) {
      noProgress(run, '生成的资产设计与已有候选或批准版本相同。'); entry.outcome = 'unchanged';
    } else {
      if (library.length + candidates.length > 160) throw new Error('资产候选数量达到上限。');
      p.production!.library = [...library, ...candidates];
      run.status = 'waiting_user'; run.stopReason = 'asset_approval';
      run.summary = '已新增 ' + candidates.length + ' 个未批准的文字设计候选。请在角色与场景中查看、生成或上传参考图并选择版本；原批准版本保留。';
      entry.outcome = 'candidate_created'; entry.artifactIds = candidates.map(a => a.id);
      entry.message += '【实际结果：仅新增未批准的文字设计候选，未合并资产、未改变原批准版本、未生成图片。】';
    }
  }
  entry.revisionAfter = p.revision;
  entry.outputFingerprint = contentFingerprint(p);
  run.log.push(entry);
  if (run.status === 'running' && run.steps >= run.maxSteps) exhaustAutoRun(run);
}

export function continuityFixDecision(p: Project): AutoDecision {
 const report=p.production?.continuityReview;
 if(!p.plan||!p.production?.scriptApproved||!report||report.revision!==p.revision||!report.findings.length)throw new Error('请先取得当前版本的场记问题报告，并确认剧本。');
 if(p.mode==='demo')throw new Error('自动修订需要真实语言模型；演示模式请手动调整。');
 const roles=projectAgents(p).filter(r=>r.enabled);
 const role=roles.find(r=>r.id==='storyboard')??roles.find(r=>r.id==='director')??roles.find(r=>r.stages.includes('storyboard'));
 if(!role)throw new Error('请启用分镜导演或负责分镜的岗位。');
 return {roleId:role.id,action:'revise_shots',reason:'按当前版本专业场记报告逐项修订分镜，保留已确认剧本、全部对白和场次时长；不生成媒体。'};
}

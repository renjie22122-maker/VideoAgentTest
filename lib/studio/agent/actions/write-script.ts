import { roleJSON } from '../../providers.ts';
import { skillGuide } from '../../skills.ts';
import { WRITER_GUIDE, demoScreenplay, validateScreenplay } from '../../screenplay.ts';
import { sameScript } from '../../auto-progress.ts';
import { noProgress } from '../run-controller.ts';
import type { AgentAction } from './types.ts';

/**
 * Script (re)write: produces an UNCONFIRMED screenplay, archives the previous
 * one, invalidates every downstream artifact and stops for human approval.
 * The agent can never approve its own script.
 */
export const writeScriptAction: AgentAction = {
  id: 'write_script',
  description: '生成或修改结构化剧本；结果保持未确认，下游全部失效并等待人工批准。',
  approval: '停止并等待用户确认剧本。',
  capabilityRequirement: { anyOf: ['write_screenplay'] },
  preconditions: [],
  effects: ['script', 'assets', 'storyboard', 'media', 'approvals'],
  requiresVerification: false,
  async execute(ctx) {
    const { project: p, run, role, entry } = ctx;
    if (p.brief && !p.brief.ready)
      throw new Error('创意仍有关键歧义，请先回答后再自动编剧。');
    const result = await roleJSON(
      role!.name,
      skillGuide('writer', p) +
        WRITER_GUIDE +
        role!.checks +
        ' 输出完整 schemaVersion:2 结构化剧本，遵循现有结构，时长合计必须等于目标。',
      { ...ctx.observation, previousScript: p.production!.script, outputSchemaExample: demoScreenplay(p) },
      { model: role!.model },
    );
    const script = validateScreenplay(result, p.duration);
    const g = p.production!;
    if (sameScript(script, g.script)) {
      noProgress(run, '返回的剧本没有实际修改。');
      entry.outcome = 'unchanged';
    } else {
      if (g.script) (g.scriptHistory ??= []).push({ at: Date.now(), script: g.script });
      g.scriptHistory = g.scriptHistory?.slice(-10);
      p.phase = 'clarify';
      g.script = script;
      g.scriptApproved = false;
      g.node = 'script';
      g.assets = undefined;
      g.library = g.library?.map((a) => ({ ...a, retired: true, approved: false }));
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
      run.status = 'waiting_user';
      run.stopReason = 'script_approval';
      run.summary = '新剧本已保存，等待你确认；相关分镜和素材需在确认后重新制作。';
      entry.outcome = 'modified';
      entry.message += '【实际结果：已保存未确认剧本，等待用户确认。】';
    }
  },
};

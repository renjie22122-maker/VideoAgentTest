import { randomUUID } from 'node:crypto';
import { text, finite, validateBible } from '../domain.ts';
import { invalidateFrom } from '../domain.ts';
import { initialProduction, transition, requireNode, reopenStoryboard } from '../graph.ts';
import { nextStoryContext, validateStoryGuide } from '../story-context.ts';
import { resolveDuration, refreshEstimatedDuration } from '../duration.ts';
import { validateBriefDecisions, inheritBriefDecisions } from '../brief-decisions.ts';
import { analyzeClarification } from '../clarification.ts';
import { productionSkills } from '../skills.ts';
import { validateScreenplay } from '../screenplay.ts';
import { designAssets, generatePlan, writeScript } from '../providers.ts';
import { setting } from '../settings.ts';
import { bump } from './shared.ts';
import type { Project } from '../types.ts';
import type { CommandHandler } from './shared.ts';

/** Cross-act narration: save the story guide or open the next act. */
export const storyCommandHandler: CommandHandler = {
  action: 'story',
  matches: (input) => input.action === 'story_save' || input.action === 'story_next',
  async run(ctx) {
    const { project: p, all, input, save } = ctx;
    if (
      p!.jobs.some((j) => ['queued', 'running'].includes(j.status)) ||
      p!.production?.library?.some((a) => a.status === 'running')
    )
      throw new Error('请先完成或停止当前生成任务。');
    if (input.action === 'story_save') {
      const guide = validateStoryGuide(input.storyGuide);
      p!.storyContext = {
        ...p!.storyContext,
        seriesId: p!.storyContext?.seriesId ?? p!.id,
        actNumber: p!.storyContext?.actNumber ?? 1,
        guide,
      };
      if (p!.plan) {
        invalidateFrom(p!, 0);
        reopenStoryboard(p!);
      } else p!.revision++;
      bump(p!);
      await save();
      return p;
    }
    if (!p!.production?.scriptApproved)
      throw new Error('请先确认本幕剧本，再建立下一幕。');
    const idea = text(input.idea, '下一幕创意', 4000);
    const timing = resolveDuration(input.duration, { idea, answers: {} });
    const next: Project = {
      id: randomUUID(),
      revision: 1,
      title:
        '第 ' + ((p!.storyContext?.actNumber ?? 1) + 1) + ' 幕 · ' + idea.slice(0, 18),
      idea,
      duration: timing.seconds,
      durationMode: timing.mode,
      durationReason: timing.reason,
      ratio: p!.ratio,
      mode: p!.mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'clarify',
      answers: {},
      questions: [],
      jobs: [],
      storyContext: nextStoryContext(p!),
      production: initialProduction(),
    };
    next.production!.agentConfig = structuredClone(p!.production.agentConfig);
    next.production!.costumeSelections = structuredClone(
      p!.production.costumeSelections,
    );
    next.production!.library = structuredClone(p!.production.library ?? []).map(
      (a) => ({ ...a, sceneIds: undefined, retired: a.retired || !a.approved }),
    );
    all.push(next);
    await save();
    return next;
  },
};

/** Target duration change archives the script and downstream work. */
export const durationUpdateHandler: CommandHandler = {
  action: 'duration_update',
  matches: (input) => input.action === 'duration_update',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (
      p!.jobs.some((j) => ['running', 'queued'].includes(j.status)) ||
      p!.production?.library?.some((a) => a.status === 'running')
    )
      throw new Error('请先完成或停止生成任务，再修改时长。');
    const timing = resolveDuration(input.duration, p!);
    const previous = p!.production!;
    if (previous.script)
      (previous.scriptHistory ??= []).push({ at: Date.now(), script: previous.script });
    p!.duration = timing.seconds;
    p!.durationMode = timing.mode;
    p!.durationReason = timing.reason;
    p!.production = {
      ...initialProduction(),
      scriptHistory: previous.scriptHistory?.slice(-10),
      agentConfig: previous.agentConfig,
      agentConfigRevision: previous.agentConfigRevision,
      events: previous.events,
      library: previous.library?.map((a) => ({ ...a, retired: true, approved: false })),
    };
    p!.brief = undefined;
    p!.questions = [];
    delete p!.plan;
    p!.jobs = p!.jobs.map((j) => ({
      ...j,
      status: 'cancelled',
      error: '目标时长修改，需重新编剧和确认下游。',
    }));
    p!.phase = 'clarify';
    p!.revision++;
    p!.production.events.push({
      at: Date.now(),
      node: 'clarify',
      role: '制片',
      message:
        '目标时长改为 ' +
        p!.duration +
        ' 秒，保留创意与回答，旧剧本及资产已归档，等待重新编剧。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** User decisions on the creative brief's suggestions. */
export const briefDecisionsHandler: CommandHandler = {
  action: 'brief_decisions',
  matches: (input) => input.action === 'brief_decisions',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'clarify');
    if (!p!.brief) throw new Error('请先分析创意。');
    p!.brief = { ...p!.brief, decisions: validateBriefDecisions(p!.brief, input.decisions) };
    p!.answers.creative_suggestion_decisions = JSON.stringify(p!.brief.decisions);
    for (const q of p!.questions) {
      const value = input.answers?.[q.id];
      if (typeof value === 'string')
        p!.answers[q.id] = value.trim() ? text(value, q.label, 1500) : '';
    }
    refreshEstimatedDuration(p!);
    bump(p!);
    await save();
    return p;
  },
};

/** Clarification rounds: analysis, answers and brief confirmation. */
export const clarifyHandler: CommandHandler = {
  action: 'clarify',
  matches: (input) =>
    ['analyze_brief', 'clarify_answers', 'confirm_brief'].includes(input.action ?? ''),
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'clarify');
    if (input.action !== 'confirm_brief' && (p!.brief?.round ?? 0) >= 3)
      throw new Error('已完成三轮分析，请填写关键问题后确认当前理解继续，或创建新的创意。');
    const answers = { ...p!.answers };
    const history = [...(p!.brief?.history ?? [])];
    if (input.action !== 'analyze_brief')
      for (const q of p!.questions) {
        const answer = text(input.answers?.[q.id], q.label, 1500);
        answers[q.id] = answer;
        history.push({ question: q.label, answer });
      }
    if (typeof input.notes === 'string' && input.notes.trim()) {
      const answer = text(input.notes, '补充要求', 4000);
      answers.additional_requirements = answer;
      history.push({ question: '用户补充要求或对理解的纠正', answer });
    }
    if (input.action === 'confirm_brief') {
      if (!p!.brief || (p!.brief.round < 3 && !p!.brief.ready))
        throw new Error('请先提交回答检查歧义。');
      p!.brief = { ...p!.brief, history, ready: true };
      p!.questions = [];
    } else {
      const analysisProject = { ...p!, answers };
      refreshEstimatedDuration(analysisProject);
      const result = await analyzeClarification(analysisProject, history);
      p!.brief = inheritBriefDecisions(p!.brief, result.brief);
      p!.questions = result.questions;
    }
    p!.answers = answers;
    refreshEstimatedDuration(p!);
    p!.revision++;
    p!.production!.skillVersions = Object.fromEntries(
      Object.entries(productionSkills).map(([id, s]) => [id, s.version]),
    );
    p!.production!.events.push({
      at: Date.now(),
      node: 'clarify',
      role: '创意开发编辑',
      message: p!.brief.ready
        ? '关键歧义已处理，等待用户确认简报。'
        : '已阅读创意与回答，提出 ' + p!.questions.length + ' 个针对性问题。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Script generation or rewrite; always lands on the human approval gate. */
export const planHandler: CommandHandler = {
  action: 'plan',
  matches: (input) => input.action === 'plan' || input.action === 'rewrite_script',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (input.action === 'plan') requireNode(p!, 'clarify', 'script');
    if (p!.brief && !p!.brief.ready)
      throw new Error('请先完成针对性澄清并确认创意理解。');
    if (
      p!.jobs.some((j) => j.status === 'running' || j.status === 'queued') ||
      p!.production?.library?.some((a) => a.status === 'running')
    )
      throw new Error('请先完成或停止生成任务。');
    const answers: Record<string, string> = { ...p!.answers };
    for (const q of p!.questions)
      answers[q.id] = text(input.answers?.[q.id], q.label, 1500);
    // Use the saved target shown to the user; never change it inside a generation request.
    const candidate = { ...p!, answers };
    const script = await writeScript(candidate);
    const previous = p!.production!.script;
    const history = p!.production!.scriptHistory ?? [];
    if (previous) history.push({ at: Date.now(), script: previous });
    if (input.action === 'rewrite_script') {
      const events = p!.production!.events;
      p!.production = { ...initialProduction(), events };
      delete p!.plan;
      p!.phase = 'clarify';
      p!.jobs = p!.jobs.map((j) => ({
        ...j,
        status: 'cancelled',
        error: '剧本重写后原素材已失效。',
      }));
    }
    p!.answers = answers;
    p!.production!.script = script;
    p!.production!.scriptHistory = history.slice(-10);
    p!.production!.skillVersions = Object.fromEntries(
      Object.entries(productionSkills).map(([id, s]) => [id, s.version]),
    );
    p!.title = script.title;
    p!.revision++;
    transition(p!, 'script', '编剧完成结构化剧本，等待人工确认。');
    bump(p!);
    await save();
    return p;
  },
};

/** Human script approval: validates the text and designs the art bible. */
export const approveScriptHandler: CommandHandler = {
  action: 'approve_script',
  matches: (input) => input.action === 'approve_script',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'script');
    const g = p!.production!;
    const script = validateScreenplay(input.script, p!.duration);
    const candidate = { ...p!, production: { ...g, script } };
    const bible = await designAssets(candidate);
    g.script = script;
    g.scriptApproved = true;
    g.assets = { bible, seed: 42, locked: false };
    p!.title = script.title;
    p!.revision++;
    transition(p!, 'assets', '剧本已由用户确认，美术完成资产设定。');
    bump(p!);
    await save();
    return p;
  },
};

/** Asset bible approval: locks the bible and generates the storyboard. */
export const approveAssetsHandler: CommandHandler = {
  action: 'approve_assets',
  matches: (input) => input.action === 'approve_assets',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'assets');
    const g = p!.production!;
    if (p!.mode === 'live' && setting('IMAGE_PROVIDER') === 'fal') {
      if (JSON.stringify(input.bible) !== JSON.stringify(g.assets!.bible))
        throw new Error('设定已修改，请先保存设定并重新确认对应资产，再生成分镜。');
    }
    const seed = finite(input.seed, 0, 2147483647, 'Seed');
    if (!Number.isInteger(seed)) throw new Error('Seed 必须为整数。');
    const assets = { bible: validateBible(input.bible), seed, locked: true };
    const plan = await generatePlan({ ...p!, production: { ...g, assets } });
    g.assets = assets;
    p!.plan = { ...plan, ...g.script, bible: assets.bible };
    p!.phase = 'planned';
    p!.revision++;
    transition(p!, 'storyboard', '资产已锁定，导演生成分镜与运镜。');
    bump(p!);
    await save();
    return p;
  },
};

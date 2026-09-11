import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  text,
  validatePlan,
  validateShot,
  invalidateFrom,
  checkContinuity,
} from '../domain.ts';
import { reopenStoryboard, requireNode, transition } from '../graph.ts';
import { saveAssetUpload } from '../asset-upload.ts';
import { mergeShotPair } from '../shot-merge.ts';
import { MOTION_SCHEMA, validateMotion } from '../motion.ts';
import { roleJSON, continuitySkill, compilerSkill } from '../providers.ts';
import { recordApproval } from '../approvals.ts';
import { bump, studioRoot } from './shared.ts';
import type { CommandHandler } from './shared.ts';

/** Merge two adjacent shots into one continuous shot. */
export const mergeShotsHandler: CommandHandler = {
  action: 'merge_shots',
  matches: (input) => input.action === 'merge_shots',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.plan || !input.shotId || !input.neighborId)
      throw new Error('请选择两个相邻镜头。');
    if (p!.jobs.some((j) => ['running', 'queued'].includes(j.status)))
      throw new Error('请先完成或停止生成队列，再合并分镜。');
    if (p!.plan.shots.length <= 2)
      throw new Error('当前工作流至少保留两个镜头，请手动重新分配时长。');
    const { index, merged } = mergeShotPair(p!.plan.shots, input.shotId, input.neighborId);
    validateShot(merged, index);
    const backupDir = path.join(studioRoot(), 'auto-backups');
    await mkdir(backupDir, { recursive: true });
    await writeFile(
      path.join(backupDir, p!.id + '-merge-' + Date.now() + '.json'),
      JSON.stringify(p, null, 2),
    );
    invalidateFrom(p!, index);
    p!.plan.shots.splice(index, 2, merged);
    p!.plan.shots.forEach((s, i) => {
      s.id = 'shot-' + (i + 1);
    });
    reopenStoryboard(p!);
    p!.production!.events.push({
      at: Date.now(),
      node: 'storyboard',
      role: '用户',
      message:
        '合并 ' +
        input.shotId +
        ' 与 ' +
        input.neighborId +
        ' 为 ' +
        merged.duration +
        ' 秒连续镜头；对白与全片时长保留，需重新检查运镜与批准。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Upload a live storyboard frame for one shot. */
export const shotImageUploadHandler: CommandHandler = {
  action: 'shot_image_upload',
  matches: (input) => input.action === 'shot_image_upload',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.plan || p!.jobs.some((j) => ['running', 'queued'].includes(j.status)))
      throw new Error('请先停止或等待生成队列，再上传分镜画面。');
    const i = p!.plan.shots.findIndex((s) => s.id === input.shotId);
    if (i < 0) throw new Error('镜头不存在。');
    const image = await saveAssetUpload(input.imageBase64);
    invalidateFrom(p!, i);
    reopenStoryboard(p!);
    const s = p!.plan.shots[i];
    s.referenceUrl = image.url;
    s.referenceMode = 'live';
    s.referenceOrigin = 'upload';
    s.referenceFilename =
      typeof input.filename === 'string'
        ? input.filename.replace(/[\\/]/g, '_').slice(0, 150)
        : '本地图片';
    p!.production!.events.push({
      at: Date.now(),
      node: 'storyboard',
      role: '用户',
      message: '上传 ' + s.id + ' 分镜画面；本镜视频及后续素材失效，请重新检查并批准。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Natural-language camera motion planning for one shot. */
export const motionPlanHandler: CommandHandler = {
  action: 'motion_plan',
  matches: (input) => input.action === 'motion_plan',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.plan || p!.jobs.some((j) => ['running', 'queued'].includes(j.status)))
      throw new Error('请先生成分镜并等待当前队列结束。');
    const i = p!.plan.shots.findIndex((s) => s.id === input.shotId);
    if (i < 0) throw new Error('镜头不存在。');
    const notes = text(input.notes, '运动意图', 2000);
    const shot = p!.plan.shots[i];
    if (p!.mode === 'demo')
      throw new Error('演示模式请使用手动运动程序；自然语言规划需要已配置语言模型。');
    const raw = await roleJSON(
      '摄影 / 动作规划师',
      MOTION_SCHEMA +
        '只返回 {motion:上述结构}。遵守用户运动意图，不改写对白、剧情或时长；相机坐标沿用输入。',
      { shot, instruction: notes },
    );
    const motion = validateMotion(raw.motion);
    p!.plan.shots[i] = { ...shot, motion };
    invalidateFrom(p!, i);
    reopenStoryboard(p!);
    bump(p!);
    await save();
    return p;
  },
};

/** Manual single-shot edit. */
export const shotHandler: CommandHandler = {
  action: 'shot',
  matches: (input) => input.action === 'shot',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.plan) throw new Error('请先生成分镜。');
    const i = p!.plan.shots.findIndex((s) => s.id === input.shot?.id);
    if (i < 0) throw new Error('镜头不存在。');
    const shot = validateShot(input.shot, i);
    p!.plan.shots[i] = shot;
    invalidateFrom(p!, i);
    reopenStoryboard(p!);
    bump(p!);
    await save();
    return p;
  },
};

/** Art bible edit inside the plan. */
export const bibleHandler: CommandHandler = {
  action: 'bible',
  matches: (input) => input.action === 'bible',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.plan) throw new Error('请先生成分镜。');
    const plan = validatePlan({ ...p!.plan, bible: input.bible });
    p!.plan.bible = plan.bible;
    for (const a of p!.production?.library ?? []) a.approved = false;
    if (p!.production?.assets) p!.production.assets.bible = plan.bible;
    invalidateFrom(p!, 0);
    reopenStoryboard(p!);
    bump(p!);
    await save();
    return p;
  },
};

/** Professional continuity review of the current revision. */
export const continuityReviewHandler: CommandHandler = {
  action: 'continuity_review',
  matches: (input) => input.action === 'continuity_review',
  async run(ctx) {
    const { project: p, save } = ctx;
    requireNode(p!, 'storyboard', 'continuity');
    p!.production!.continuityReview = await continuitySkill(p!);
    if (p!.production!.node === 'storyboard')
      transition(p!, 'continuity', '场记完成规则与语义审查，等待用户复核。');
    bump(p!);
    await save();
    return p;
  },
};

/** Prompt compilation gate. */
export const compileHandler: CommandHandler = {
  action: 'compile',
  matches: (input) => input.action === 'compile',
  async run(ctx) {
    const { project: p, save } = ctx;
    requireNode(p!, 'storyboard', 'continuity');
    if (!p!.plan) throw new Error('缺少分镜。');
    if (checkContinuity(p!.plan).some((i) => i.level === 'error'))
      throw new Error('请先修正运镜错误。');
    if (p!.production!.continuityReview?.revision !== p!.revision)
      throw new Error('请先运行当前版本的专业场记审查。');
    if (p!.production!.node === 'storyboard')
      transition(p!, 'continuity', '场记完成规则检查，警告需要人工复核。');
    p!.production!.prompts = await compilerSkill(p!);
    if (p!.production!.assets) p!.production!.assets.locked = true;
    transition(p!, 'prompts', '提示词编译完成，等待人工批准生成。');
    bump(p!);
    await save();
    return p;
  },
};

/** Human approval of the compiled prompts before generation. */
export const approveRenderHandler: CommandHandler = {
  action: 'approve_render',
  matches: (input) => input.action === 'approve_render',
  async run(ctx) {
    const { project: p, save } = ctx;
    requireNode(p!, 'prompts');
    p!.production!.renderApprovedRevision = p!.revision;
    transition(p!, 'generation', '用户批准当前版本分镜与提示词。');
    recordApproval(p!, 'render', 'render');
    bump(p!);
    await save();
    return p;
  },
};

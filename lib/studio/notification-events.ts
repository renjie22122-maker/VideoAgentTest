import type { Project } from './types.ts';
export type NoticeTarget = {
  projectId: string;
  view:
    | 'story'
    | 'assets'
    | 'board'
    | 'checks'
    | 'prompts'
    | 'queue'
    | 'assembly';
  shotId?: string;
};
export type StudioNotice = {
  id: string;
  title: string;
  body: string;
  category: 'language' | 'image' | 'video';
  outcome: 'ready' | 'attention';
  target?: NoticeTarget;
  at: number;
};
const languageActions: Record<string, [string, NoticeTarget['view']]> = {
  create: ['创意分析', 'story'],
  analyze_brief: ['创意分析', 'story'],
  clarify_answers: ['创意澄清', 'story'],
  plan: ['剧本', 'story'],
  rewrite_script: ['剧本', 'story'],
  approve_script: ['资产文字设计', 'assets'],
  approve_assets: ['分镜设计', 'board'],
  asset_inventory: ['资产文字设计', 'assets'],
  asset_refresh_inventory: ['资产文字设计', 'assets'],
  asset_save_bible: ['资产文字设计', 'assets'],
  asset_supplement: ['资产查漏补缺', 'assets'],
  motion_plan: ['运镜设计', 'board'],
  continuity_review: ['场记审查', 'checks'],
  team_review: ['部门会审', 'checks'],
  compile: ['提示词编译', 'prompts'],
  prepare_assembly: ['剪辑与声音方案', 'assembly'],
};
const stamp = (p: Project) => p.updatedAt;
const target = (
  p: Project,
  view: NoticeTarget['view'],
  shotId?: string,
): NoticeTarget => ({ projectId: p.id, view, shotId });
export function isProjectResult(value: unknown): value is Project {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Project).id === 'string' &&
    typeof (value as Project).title === 'string' &&
    Array.isArray((value as Project).jobs)
  );
}
/** Compare saved states, never infer completion from HTTP success or a queue submission. */
export function projectNotices(
  previous: Project | undefined,
  next: Project,
): StudioNotice[] {
  if (!previous || previous.id !== next.id) return [];
  const notices: StudioNotice[] = [];
  const prefix = next.mode === 'demo' ? '演示 · ' : '';
  for (const job of next.jobs) {
    const old = previous.jobs.find((j) => j.id === job.id);
    if (
      job.assetSuperseded ||
      job.revision !== next.revision ||
      !['succeeded', 'failed'].includes(job.status)
    )
      continue;
    if (
      old?.status === job.status &&
      old.finishedAt === job.finishedAt &&
      old.retries === job.retries &&
      old.qaRetries === job.qaRetries &&
      old.outputUrl === job.outputUrl &&
      old.longTake?.phase === job.longTake?.phase
    )
      continue;
    if (!old) continue;
    const ready = job.status === 'succeeded';
    if (
      ready &&
      next.mode === 'live' &&
      (!job.outputUrl || (job.longTake && job.longTake.phase !== 'complete'))
    )
      continue;
    const label = job.kind === 'image' ? '分镜画面' : '视频片段';
    const shot = next.plan?.shots.find((s) => s.id === job.shotId);
    notices.push({
      id: [
        'job',
        next.id,
        job.id,
        job.status,
        job.retries ?? 0,
        job.qaRetries ?? 0,
        job.finishedAt ?? '',
      ].join(':'),
      title: prefix + label + (ready ? '已返回' : '需处理'),
      body:
        next.title +
        ' · ' +
        (shot?.title ?? job.shotId) +
        (ready
          ? '，可打开查看；仍需审查。'
          : '，请查看任务详情，勿直接重复提交。'),
      category: job.kind,
      outcome: ready ? 'ready' : 'attention',
      target: target(next, 'queue', job.shotId),
      at: stamp(next),
    });
  }
  for (const asset of next.production?.library ?? []) {
    if (
      asset.retired ||
      asset.origin === 'upload' ||
      !['ready', 'failed'].includes(asset.status)
    )
      continue;
    const old = previous.production?.library?.find((a) => a.id === asset.id);
    if (
      (old?.status === asset.status &&
        (asset.status !== 'ready' || old.url === asset.url)) ||
      asset.error?.startsWith('已停止本地跟踪')
    )
      continue;
    const ready = asset.status === 'ready';
    if (ready && !asset.url) continue;
    if (!old && asset.createdAt < previous.updatedAt) continue;
    notices.push({
      id: [
        'asset',
        next.id,
        asset.id,
        asset.status,
        asset.remoteId ?? '',
        ready ? '' : (asset.error ?? ''),
      ].join(':'),
      title: prefix + '美术参考图' + (ready ? '已返回' : '需处理'),
      body:
        next.title +
        ' · ' +
        asset.name +
        (ready ? '，请查看并确认使用。' : '，请查看任务详情，勿直接重复提交。'),
      category: 'image',
      outcome: ready ? 'ready' : 'attention',
      target: target(next, 'assets'),
      at: stamp(next),
    });
  }
  const old = previous.production?.autoRun,
    run = next.production?.autoRun;
  if (
    run &&
    !(
      old?.id === run.id &&
      old?.steps === run.steps &&
      old?.status === run.status
    ) &&
    run.status !== 'stopped' &&
    (run.steps > 0 ||
      ['failed', 'waiting_user', 'budget_exhausted', 'completed'].includes(
        run.status,
      ))
  ) {
    const attention = ['failed', 'waiting_user', 'budget_exhausted'].includes(
      run.status,
    );
    const label =
      run.status === 'failed'
        ? '自动协作需处理'
        : run.status === 'waiting_user'
          ? '自动协作等待你处理'
          : run.status === 'budget_exhausted'
            ? '本轮协作预算已用完'
            : run.status === 'completed'
              ? '本轮文字协作已结束'
              : '协作第 ' + run.steps + ' 步已返回';
    notices.push({
      id: ['auto', next.id, run.id ?? 'legacy', run.steps, run.status].join(
        ':',
      ),
      title: prefix + label,
      body:
        next.title +
        ' · ' +
        (run.summary ?? '结果已保存，可查看本步意见。') +
        '（不代表画面质量通过）',
      category: 'language',
      outcome: attention ? 'attention' : 'ready',
      target: target(next, next.plan ? 'checks' : 'story'),
      at: stamp(next),
    });
  }
  return notices;
}
export function languageNotice(
  action: string,
  next: Project,
): StudioNotice | undefined {
  const label = languageActions[action];
  if (!label) return;
  return {
    id: ['language', next.id, action, next.revision, next.updatedAt].join(':'),
    title: (next.mode === 'demo' ? '演示 · ' : '') + label[0] + '结果已返回',
    body: next.title + ' · 已保存，可返回工作台查看。',
    category: 'language',
    outcome: 'ready',
    target: target(next, label[1]),
    at: stamp(next),
  };
}
export function requestAttention(
  action: string,
  data: Record<string, unknown>,
  previous: Project | undefined,
  message: string,
): StudioNotice | undefined {
  const media =
    action.startsWith('asset_') &&
    [
      'asset_generate',
      'asset_regenerate',
      'asset_poll',
      'asset_retry',
    ].includes(action);
  const queued = ['enqueue', 'enqueue_group', 'poll'].includes(action);
  if (
    !languageActions[action] &&
    !media &&
    !queued &&
    !['auto_step', 'continuity_fix', 'quality_fix'].includes(action)
  )
    return;
  if (
    ['poll', 'asset_poll'].includes(action) &&
    message.startsWith('工作台正在处理上一项操作')
  )
    return;
  const kind =
    data.kind ??
    previous?.jobs.find((j) => j.status === 'running')?.kind ??
    previous?.jobs.find((j) => j.status === 'queued')?.kind;
  const category = media
    ? 'image'
    : queued
      ? kind === 'image'
        ? 'image'
        : 'video'
      : 'language';
  const identity =
    typeof data.assetId === 'string'
      ? data.assetId
      : typeof data.shotId === 'string'
        ? data.shotId
        : (previous?.production?.autoRun?.id ?? '');
  return {
    id: [
      'request',
      typeof data.id === 'string' ? data.id : 'new',
      action,
      identity,
      previous?.updatedAt ?? '',
      message,
    ].join(':'),
    title: '请求结果需要查看',
    body:
      (previous?.title ? previous.title + ' · ' : '') +
      '本次请求未取得完整结果，请查看工作台详情。远端可能仍在处理，请勿连续重复提交。',
    category,
    outcome: 'attention',
    target: previous
      ? target(
          previous,
          media
            ? 'assets'
            : queued
              ? 'queue'
              : (languageActions[action]?.[1] ?? 'checks'),
          typeof data.shotId === 'string' ? data.shotId : undefined,
        )
      : undefined,
    at: Date.now(),
  };
}

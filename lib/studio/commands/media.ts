import { saveAssetUpload } from '../asset-upload.ts';
import { requireReadyAssets } from '../asset-policy.ts';
import { requireFFmpeg } from '../take-media.ts';
import { checkContinuity, text } from '../domain.ts';
import { requireNode, transition } from '../graph.ts';
import { videoGroup } from '../video-group.ts';
import { suggestVideoAssets, videoAssetChoices } from '../video-asset-selection.ts';
import { miniMaxBase } from '../minimax-video.ts';
import { requeueFailedJob } from '../job-recovery.ts';
import { capabilities, videoPreview, currentVideoProfile, editorSkill } from '../providers.ts';
import { setting } from '../settings.ts';
import { bump, newJob } from './shared.ts';
import { tick } from './jobs.ts';
import type { CommandHandler } from './shared.ts';

/** Multi-shot grouped generation in one provider request. */
export const enqueueGroupHandler: CommandHandler = {
  action: 'enqueue_group',
  matches: (input) => input.action === 'enqueue_group',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.production?.scriptApproved || !p!.plan)
      throw new Error('请先确认剧本并完成文字分镜。');
    if (p!.jobs.some((j) => ['running', 'queued'].includes(j.status)))
      throw new Error('请先等待或停止当前队列。');
    const group = videoGroup(p!, input.shotId ?? '', input.neighborId ?? '');
    if (
      p!.mode === 'live' &&
      (currentVideoProfile().id !== 'minimax' ||
        !miniMaxBase(setting('MEDIA_GATEWAY_URL')) ||
        setting('VIDEO_MODEL') !== 'MiniMax-H3')
    )
      throw new Error('文字加美术参考图联合生成需要原生 MiniMax-H3。');
    if (
      p!.jobs.some(
        (j) =>
          j.group &&
          j.group.shots.some((s) => group.shots.some((g) => g.id === s.id)) &&
          j.status === 'failed' &&
          !j.remoteId,
      )
    )
      throw new Error('已有联合任务提交结果未知，请先核查供应商，不能直接重复提交。');
    p!.jobs.push({ ...newJob(p!, group.shots[0].id, 'video'), independent: true, group });
    p!.production.events.push({
      at: Date.now(),
      node: p!.production.node,
      role: '用户',
      message:
        '用户直接批准多镜联合生成：' +
        group.shots.map((s) => s.id).join(' + ') +
        '；保存独立联合片段，不改写或批准其他分镜。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Per-shot video input mode: text / references / first frame / first+last frame. */
export const videoConfigHandler: CommandHandler = {
  action: 'video_config',
  matches: (input) => input.action === 'video_config' || input.action === 'video_tail_upload',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (p!.jobs.some((j) => ['running', 'queued'].includes(j.status)))
      throw new Error('请先停止或等待队列结束。');
    const shot = p!.plan?.shots.find((s) => s.id === input.shotId);
    if (!shot) throw new Error('镜头不存在。');
    if (input.action === 'video_tail_upload') {
      const image = await saveAssetUpload(input.imageBase64);
      shot.videoInput = { ...shot.videoInput, mode: 'first_last', lastFrameUrl: image.url };
    } else {
      const config = input.videoInput;
      if (!config || !['text', 'references', 'first', 'first_last'].includes(config.mode))
        throw new Error('视频模式无效。');
      if (
        config.assetIds &&
        (!Array.isArray(config.assetIds) ||
          config.assetIds.length > 9 ||
          config.assetIds.some((id) => typeof id !== 'string') ||
          new Set(config.assetIds).size !== config.assetIds.length)
      )
        throw new Error('最多选择 9 张不同美术参考图。');
      const assetIds =
        config.mode === 'references'
          ? (config.assetIds ?? suggestVideoAssets(p!, shot.id).ids)
          : config.assetIds;
      if (
        config.mode === 'references' &&
        (!assetIds?.length ||
          assetIds.some((id) => !videoAssetChoices(p!).some((a) => a.id === id)))
      )
        throw new Error('请为本镜选择有效的已批准参考图；自动匹配为空时需手动选择。');
      shot.videoInput = {
        mode: config.mode,
        assetIds,
        lastFrameUrl: shot.videoInput?.lastFrameUrl,
      };
    }
    const g = p!.production!;
    const previousRevision = p!.revision;
    delete shot.videoMode;
    delete shot.videoUrl;
    p!.jobs = p!.jobs.map((j) =>
      j.shotId === shot.id && j.kind === 'video' ? { ...j, status: 'cancelled' } : j,
    );
    p!.revision++;
    // Input configuration does not rewrite approved narrative or compiled text.
    if (g.continuityReview?.revision === previousRevision)
      g.continuityReview.revision = p!.revision;
    if (g.renderApprovedRevision === previousRevision)
      g.renderApprovedRevision = p!.revision;
    g.qa = g.qa.filter((q) => q.shotId !== shot.id);
    g.editPlan = undefined;
    if (g.node === 'qa')
      transition(p!, 'generation', '本镜视频输入配置已保存，等待用户单独生成。');
    g.events.push({
      at: Date.now(),
      node: g.node,
      role: '用户',
      message:
        shot.id +
        ' 视频输入配置已保存；文字分镜及原有批准保留，仅本镜视频需重新生成和审查。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Human QA verdict on generated footage. */
export const reviewHandler: CommandHandler = {
  action: 'review',
  matches: (input) => input.action === 'review',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'qa');
    if (input.verdict !== 'passed' && input.verdict !== 'rejected')
      throw new Error('审查结论无效。');
    const g = p!.production!;
    const report = g.qa.find((q) => q.shotId === input.shotId);
    if (!report) throw new Error('审查镜头不存在。');
    const notes = text(input.notes, '审查意见', 1000);
    report.source = 'human';
    report.notes = notes;
    report.verdict = input.verdict;
    if (input.verdict === 'rejected') {
      if (report.attempt >= g.maxRetries)
        throw new Error('该镜头已达到重试上限，请修改分镜后开启新版本。');
      const i = p!.plan!.shots.findIndex((s) => s.id === input.shotId);
      const affected = new Set(p!.plan!.shots.slice(i).map((s) => s.id));
      for (const s of p!.plan!.shots.slice(i)) {
        delete s.videoUrl;
        delete s.videoMode;
      }
      p!.jobs = p!.jobs.map((j) =>
        j.kind === 'video' && affected.has(j.shotId) ? { ...j, status: 'cancelled' } : j,
      );
      g.qa = g.qa.filter((q) => !affected.has(q.shotId) || q.shotId === input.shotId);
      report.attempt++;
      transition(p!, 'generation', '审片退回：' + notes + '；重新生成该镜头与后续镜头。');
      for (const s of p!.plan!.shots.slice(i)) p!.jobs.push(newJob(p!, s.id, 'video'));
    } else if (
      g.qa.length === p!.plan!.shots.length &&
      g.qa.every((q) => q.verdict === 'passed')
    )
      transition(p!, 'assembly', '全部镜头通过人工审查，进入组装。');
    bump(p!);
    await save();
    return p;
  },
};

/** Generate the edit and sound plan. */
export const prepareAssemblyHandler: CommandHandler = {
  action: 'prepare_assembly',
  matches: (input) => input.action === 'prepare_assembly',
  async run(ctx) {
    const { project: p, save } = ctx;
    requireNode(p!, 'assembly', 'complete');
    p!.production!.editPlan = await editorSkill(p!);
    p!.production!.events.push({
      at: Date.now(),
      node: 'assembly',
      role: '剪辑指导',
      message: '后期剪辑与声音方案已生成，尚未执行音频合成。',
    });
    bump(p!);
    await save();
    return p;
  },
};

/** Mark the production complete. */
export const completeHandler: CommandHandler = {
  action: 'complete',
  matches: (input) => input.action === 'complete',
  async run(ctx) {
    const { project: p, save } = ctx;
    requireNode(p!, 'assembly', 'complete');
    if (!p!.production!.editPlan) throw new Error('请先生成并查看后期方案。');
    if (p!.production!.node !== 'complete')
      transition(p!, 'complete', '用户已完成预演视频导出。');
    bump(p!);
    await save();
    return p;
  },
};

/** Enqueue image/video generation, single shot or the full plan. */
export const enqueueHandler: CommandHandler = {
  action: 'enqueue',
  matches: (input) => input.action === 'enqueue',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    requireNode(p!, 'generation', 'qa');
    if (p!.production!.node === 'qa')
      transition(p!, 'generation', '用户重新生成单镜素材，返回生成阶段。');
    if (p!.production!.renderApprovedRevision !== p!.revision)
      throw new Error('请先批准当前版本提示词。');
    if (!p!.plan) throw new Error('请先生成分镜。');
    if (input.kind !== 'image' && input.kind !== 'video')
      throw new Error('任务类型无效。');
    if (checkContinuity(p!.plan).some((i) => i.level === 'error'))
      throw new Error('请先解决连续性检查中的错误。');
    if (p!.mode === 'live' && !capabilities()[input.kind as 'image' | 'video'])
      throw new Error(
        input.kind === 'image'
          ? '图像服务尚未配置，请在 API 设置中选择服务并填写对应密钥。'
          : '视频网关尚未配置。',
      );
    const targets = input.shotId
      ? p!.plan.shots.filter((s) => s.id === input.shotId)
      : p!.plan.shots;
    if (!targets.length) throw new Error('镜头不存在。');
    if (p!.mode === 'live')
      for (const shot of targets) {
        const previous = p!.jobs.findLast(
          (j) =>
            !j.assetSuperseded &&
            j.shotId === shot.id &&
            j.kind === input.kind &&
            j.revision === p!.revision,
        );
        if (!input.regenerate && (previous?.remoteId || previous?.longTake)) continue;
        requireReadyAssets(p!, [shot.id]);
      }
    if (input.kind === 'video')
      for (const s of targets) {
        const mode = s.videoInput?.mode ?? 'first';
        if (
          !['text', 'references'].includes(mode) &&
          (p!.mode === 'live' ? !s.referenceUrl : s.referenceMode !== 'demo')
        )
          throw new Error(s.id + ' 缺少参考图首帧；可选择文字或美术参考图模式。');
        if (mode === 'first_last' && !s.videoInput?.lastFrameUrl)
          throw new Error(s.id + ' 缺少尾帧。');
      }
    if (input.kind === 'video' && p!.mode === 'live')
      for (const shot of targets) {
        const existing = p!.jobs.findLast(
          (j) =>
            !j.assetSuperseded &&
            j.shotId === shot.id &&
            j.kind === 'video' &&
            j.revision === p!.revision,
        );
        if (!input.regenerate && existing?.remoteId && existing.remoteId !== 'fal-pending')
          continue;
        if (shot.duration > (currentVideoProfile().maxSeconds ?? Infinity))
          await requireFFmpeg();
        const preview = videoPreview(p!, newJob(p!, shot.id, 'video'));
        if (preview.issues.length) throw new Error(shot.id + '：' + preview.issues.join(' '));
      }
    if (input.regenerate) {
      if (!input.shotId) throw new Error('重新生成需指定单个镜头。');
      const s = targets[0];
      const latest = p!.jobs.findLast((j) => j.shotId === s.id && j.kind === input.kind);
      if (latest && ['queued', 'running'].includes(latest.status))
        throw new Error('此镜头正在生成，请勿重复提交。');
      if (latest?.longTake?.parts.some((part) => part.submitted && !part.remoteId))
        throw new Error('长镜头分段提交结果未知，请先核查供应商记录；停止队列不代表远端取消，不能直接重新生成。');
      if (
        latest?.longTake?.parts.some((part) => part.remoteId && !part.outputUrl && !part.failed)
      )
        throw new Error('长镜头还有已提交但未收回的分段，请先恢复查询，不能重复提交整镜。');
      if (latest?.remoteId === 'fal-pending')
        throw new Error('上次提交结果未知，请先核查供应商记录。');
      if (latest?.status === 'failed')
        throw new Error('失败任务请使用本镜生成 / 恢复查询，不能绕过重试保护。');
      p!.jobs.push({ ...newJob(p!, s.id, input.kind), independent: true });
      if (input.kind === 'video') delete s.videoMode;
      else {
        delete s.videoMode;
        delete s.videoUrl;
      }
      p!.production!.qa = p!.production!.qa.filter((q) => q.shotId !== s.id);
      p!.production!.editPlan = undefined;
      bump(p!);
      await save();
      return p;
    }
    for (const shot of targets) {
      if (input.kind === 'image' && shot.referenceUrl) continue;
      if (
        p!.jobs.some(
          (j) =>
            j.shotId === shot.id &&
            j.kind === input.kind &&
            ['queued', 'running', 'succeeded'].includes(j.status),
        )
      )
        continue;
      const failed = p!.jobs.findLast(
        (j) =>
          !j.assetSuperseded &&
          j.shotId === shot.id &&
          j.kind === input.kind &&
          (j.status === 'failed' || (j.status === 'cancelled' && !!j.longTake)) &&
          j.revision === p!.revision,
      );
      if (failed) {
        requeueFailedJob(failed, p!.production!.maxRetries);
        if (input.shotId) failed.independent = true;
        continue;
      }
      if (
        p!.jobs.filter(
          (j) =>
            !j.assetSuperseded &&
            j.shotId === shot.id &&
            j.kind === input.kind &&
            j.revision === p!.revision,
        ).length >=
        p!.production!.maxRetries + 1
      )
        throw new Error('该镜头已达到本版本任务预算，请修改分镜开启新版本。');
      p!.jobs.push({ ...newJob(p!, shot.id, input.kind), independent: !!input.shotId });
    }
    bump(p!);
    await save();
    return p;
  },
};

/** Cancel queued/running local tracking (remote tasks may still bill). */
export const cancelHandler: CommandHandler = {
  action: 'cancel',
  matches: (input) => input.action === 'cancel',
  async run(ctx) {
    const { project: p, save } = ctx;
    p!.jobs = p!.jobs.map((j) =>
      ['queued', 'running'].includes(j.status)
        ? {
            ...j,
            status: 'cancelled',
            error: '已停止本地跟踪；远端已提交的任务可能继续执行并计费。',
          }
        : j,
    );
    bump(p!);
    await save();
    return p;
  },
};

/** Advance the sequential generation queue and transition into QA when done. */
export const pollHandler: CommandHandler = {
  action: 'poll',
  matches: (input) => input.action === 'poll',
  async run(ctx) {
    const { project: p, save } = ctx;
    await tick(
      p!,
      async () => {
        bump(p!);
        await save();
      },
    );
    if (
      p!.production?.node === 'generation' &&
      p!.plan &&
      p!.plan.shots.every((s) => s.videoMode)
    ) {
      const g = p!.production;
      g.qa = p!.plan.shots.map((s) => {
        const previous = g.qa.find((q) => q.shotId === s.id);
        return {
          shotId: s.id,
          verdict: 'needs_review',
          source: previous?.source ?? (p!.mode === 'demo' ? 'demo' : 'human'),
          notes:
            previous?.notes ??
            (p!.mode === 'demo'
              ? '演示规则运行完成，尚未进行像素级视觉审查。请人工确认分镜节奏。'
              : '真实素材待人工审查；未配置视觉审查网关时，不自动判断画面质量。'),
          attempt: previous?.attempt ?? 0,
          at: previous?.at ?? Date.now(),
        };
      });
      transition(p!, 'qa', '素材已就绪，等待审片；不将规则检查作为视觉质量结论。');
    }
    bump(p!);
    await save();
    return p;
  },
};

import type { Project, Job } from './types.ts';
import { planLongTake, takeProject } from './long-take.ts';
import {
  normalizeTakePart,
  assembleTake,
  requireFFmpeg,
  newTakeMediaIds,
} from './take-media.ts';
import {
  currentVideoProfile,
  submitMedia,
  pollMedia,
  mediaInput,
} from './providers.ts';
export async function tickLongTake(
  p: Project,
  j: Job,
  persist: () => Promise<void>,
  deps = {
    profile: currentVideoProfile,
    submit: submitMedia,
    poll: pollMedia,
    input: mediaInput,
    normalize: normalizeTakePart,
    assemble: assembleTake,
    requireFFmpeg,
    newIds: newTakeMediaIds,
  },
) {
  const profile = deps.profile(),
    shot = p.plan!.shots.find((s) => s.id === j.shotId)!;
  if (!j.longTake) {
    await deps.requireFFmpeg();
    j.longTake = {
      parts: planLongTake(
        shot,
        profile.minSeconds ?? 4,
        profile.maxSeconds ?? 15,
      ),
      provider: profile.id,
      model: profile.model,
      phase: 'rendering',
    };
  }
  const take = j.longTake;
  if (take.provider !== profile.id || take.model !== profile.model)
    throw new Error('长镜头任务期间不能切换供应商或模型，请恢复原配置后继续。');
  j.status = 'running';
  j.startedAt ??= Date.now();
  const index = take.parts.findIndex(
    (part) => !part.fileId || !part.tailId || !part.outputUrl,
  );
  if (index < 0) {
    take.phase = 'assembling';
    await persist();
    j.outputUrl = await deps.assemble(
      take.parts.map((part) => part.fileId!),
      j.id,
    );
    take.phase = 'complete';
    j.status = 'succeeded';
    j.finishedAt = Date.now();
    shot.videoUrl = j.outputUrl;
    shot.videoMode = 'live';
    return;
  }
  const part = take.parts[index];
  if (part.outputUrl) {
    const ids = part.mediaIds ?? deps.newIds();
    part.mediaIds = ids;
    await persist();
    await deps.normalize(
      part.outputUrl,
      part.end - part.start,
      p.ratio,
      ids,
      Math.round(part.end * 24) - Math.round(part.start * 24),
    );
    Object.assign(part, ids);
    await persist();
    return;
  }
  const candidate = takeProject(p, j, index),
    child: Job = {
      ...j,
      id: j.id + '-part-' + index,
      longTake: undefined,
      remoteId: part.remoteId,
      group: undefined,
    };
  if (!part.remoteId) {
    if (part.submitted)
      throw new Error(
        '此长镜头分段上次提交结果未知，已阻止重复计费；请核对供应商记录。',
      );
    child.input = deps.input(candidate, child);
    j.input = { part: index + 1, total: take.parts.length, input: child.input };
    await persist();
    part.remoteId = await deps.submit(candidate, child, async () => {
      const previousSubmitted = part.submitted;
      part.submitted = true;
      try {
        await persist();
      } catch (error) {
        part.submitted = previousSubmitted;
        throw error;
      }
    });
    await persist();
    return;
  }
  const result = await deps.poll(child);
  if (result.status === 'failed') {
    part.failed = true;
    throw new Error(
      '第 ' +
        (index + 1) +
        ' 段生成失败：' +
        (result.error ?? '请核对供应商记录。'),
    );
  }
  if (result.status === 'succeeded') {
    if (!result.outputUrl) throw new Error('供应商未返回视频地址。');
    part.outputUrl = result.outputUrl;
    await persist();
  }
}

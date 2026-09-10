import { referencePredecessor } from '../narrative.ts';
import { tickLongTake } from '../take-runner.ts';
import { transition } from '../graph.ts';
import {
  mediaInput,
  submitMedia,
  pollMedia,
  reviewMedia,
  videoPreview,
  currentVideoProfile,
} from '../providers.ts';
import { newJob } from './shared.ts';
import type { Project, Job } from '../types.ts';

/**
 * Sequential media queue. Downstream requests receive the previous output.
 * Submissions persist the idempotency key first; resubmission after a crash
 * reuses the same key instead of double-paying.
 */
export async function tick(p: Project, persist: () => Promise<void>) {
  const job = p.jobs.find((j) => j.status === 'running') || p.jobs.find((j) => j.status === 'queued');
  if (!job || !p.plan) return;
  const index = p.plan.shots.findIndex((s) => s.id === job.shotId);
  const shot = p.plan.shots[index];
  const previous = referencePredecessor(p.plan.shots, index);
  if (
    previous &&
    !job.independent &&
    (job.kind === 'image' ||
      (!shot.videoInput && currentVideoProfile().id === 'gateway'))
  ) {
    const ready =
      job.kind === 'image'
        ? job.mode === 'demo'
          ? previous.referenceMode === 'demo'
          : !!previous.referenceUrl
        : job.mode === 'demo'
          ? previous.videoMode === 'demo'
          : !!previous.videoUrl;
    if (!ready) {
      job.status = 'failed';
      job.error = '上一镜头尚未成功，请先重试上游任务。';
      return;
    }
  }
  try {
    if (
      job.kind === 'video' &&
      !job.group &&
      job.mode === 'live' &&
      (job.longTake || shot.duration > (currentVideoProfile().maxSeconds ?? Infinity))
    ) {
      await tickLongTake(p, job, persist);
      return;
    }
    if (job.status === 'queued') {
      job.status = 'running';
      job.startedAt = Date.now();
      job.input = mediaInput(p, job);
      await persist();
      if (job.mode === 'live' && !job.remoteId) {
        if (job.kind === 'video' && !job.group) {
          const preview = videoPreview(p, job);
          if (preview.issues.length) throw new Error(preview.issues.join(' '));
        }
        job.remoteId = await submitMedia(p, job, async () => {
          const previousId = job.remoteId;
          job.remoteId = 'fal-pending';
          try {
            await persist();
          } catch (e) {
            job.remoteId = previousId;
            throw e;
          }
        });
        await persist();
      }
      return;
    }
    if (Date.now() - (job.startedAt || 0) > 30 * 60 * 1000) {
      job.status = 'failed';
      job.error = '生成超过 30 分钟，请在供应商端核查任务。';
      return;
    }
    if (job.group && job.mode === 'demo') {
      job.status = 'succeeded';
      job.finishedAt = Date.now();
      return;
    }
    if (job.mode === 'demo') {
      if (Date.now() - (job.startedAt || 0) < 900) return;
      job.status = 'succeeded';
      job.finishedAt = Date.now();
      if (job.kind === 'image') shot.referenceMode = 'demo';
      else if (await reflect(p, job)) shot.videoMode = 'demo';
      return;
    }
    // Persist the idempotency key before submission; resubmission after a crash uses the same key.
    if (!job.remoteId) {
      job.remoteId = await submitMedia(p, job);
      return;
    }
    if (job.remoteId === 'fal-pending')
      throw new Error('上次供应商提交结果不明，已阻止自动重复提交。请核查供应商记录后再手动重试。');
    const result = await pollMedia(job);
    job.status = result.status;
    job.error = result.error;
    if (result.status === 'succeeded') {
      job.outputUrl = result.outputUrl;
      job.finishedAt = Date.now();
      if (job.group) return;
      if (job.kind === 'image') {
        shot.referenceUrl = result.outputUrl;
        shot.referenceMode = 'live';
        shot.referenceOrigin = 'generated';
      } else if (await reflect(p, job)) {
        shot.videoUrl = result.outputUrl;
        shot.videoMode = 'live';
      }
    }
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : '生成失败';
  }
}

async function reflect(p: Project, j: Job): Promise<boolean> {
  const review = await reviewMedia(p, j);
  const g = p.production!;
  if (!review) {
    const previous = g.qa.find((q) => q.shotId === j.shotId);
    if (previous && j.qaRetries) {
      previous.attempt = Math.max(previous.attempt, j.qaRetries);
      previous.notes += ' 返工素材已就绪，等待人工复核。';
    }
    return true;
  }
  const attempt = j.qaRetries ?? 0;
  g.qa = g.qa.filter((q) => q.shotId !== j.shotId);
  g.qa.push({
    shotId: j.shotId,
    verdict: review.verdict,
    source: review.source,
    notes: review.notes,
    attempt,
  });
  transition(p, 'qa', '自动审查：' + review.notes);
  transition(p, 'generation', review.verdict === 'passed' ? '审查通过，继续生成。' : '审查退回，检查重试预算。');
  if (review.verdict === 'passed') return true;
  if (attempt >= g.maxRetries)
    throw new Error('自动审查未通过，已达到重试上限，请修改分镜。');
  j.status = 'cancelled';
  j.error = '自动审查退回；正在使用反思意见重试。';
  p.jobs.unshift({ ...newJob(p, j.shotId, 'video'), qaRetries: attempt + 1 });
  return false;
}

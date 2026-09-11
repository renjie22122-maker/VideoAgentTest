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
import { safely } from '../durable/ledger.ts';
import type { Project, Job } from '../types.ts';

/** A local worker owns a running job for at most this long; longer means it died. */
export const GENERATION_LEASE_MS = 5 * 60 * 1000;

function persistJob(p: Project, job: Job) {
  safely((ledger) =>
    ledger.upsertGenerationJob({
      jobId: job.id,
      projectId: p.id,
      shotId: job.shotId,
      kind: job.kind,
      status: job.status,
      submission: job.submission?.state ?? 'unsent',
      providerJobId: job.submission?.providerJobId ?? '',
      leaseExpiresAt: job.leaseExpiresAt ?? 0,
      attempt: job.retries ?? 0,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
    }),
  );
}

/** The durable submission boundary: a marker persisted before the HTTP call. */
function markSubmissionUnknown(job: Job): string {
  job.submission = { state: 'unknown' };
  return 'fal-pending';
}

/**
 * The ONE submission entry, shared by first submission and crash recovery:
 *
 *   prepare & validate → confirm persistent state allows submit →
 *   persist the pre-submit checkpoint → send → persist the provider id.
 *
 * beforeSubmit is part of this contract, not an optional extra a caller may
 * forget: the checkpoint must be durable before any adapter sends the request.
 */
async function submitJob(
  p: Project,
  job: Job,
  persist: () => Promise<void>,
): Promise<void> {
  if (job.submission?.state === 'unknown')
    throw new Error('上次供应商提交结果不明，已阻止自动重复提交。请核查供应商记录后再手动重试。');
  if (job.submission?.state === 'submitted' && !job.remoteId)
    throw new Error('已提交任务缺少远端任务 ID，请核查供应商记录后再手动重试。');
  if (job.kind === 'video' && !job.group) {
    const preview = videoPreview(p, job);
    if (preview.issues.length) throw new Error(preview.issues.join(' '));
  }
  job.remoteId = await submitMedia(p, job, async () => {
    const previousId = job.remoteId;
    job.remoteId = markSubmissionUnknown(job);
    persistJob(p, job);
    try {
      await persist();
    } catch (e) {
      job.remoteId = previousId;
      throw e;
    }
  });
  job.submission = { state: 'submitted', providerJobId: job.remoteId };
  persistJob(p, job);
  await persist();
}

/**
 * Reconciliation BEFORE lease handling: a known provider id in the durable
 * ledger wins over an unknown/empty local state. An expired lease only means
 * the local worker died — it never invalidates a confirmed remote submission.
 */
function reconcileSubmission(p: Project, job: Job): boolean {
  const row = safely((ledger) => ledger.generationJob(job.id));
  if (
    row &&
    row.submission === 'submitted' &&
    row.providerJobId &&
    job.submission?.state !== 'submitted'
  ) {
    job.submission = { state: 'submitted', providerJobId: row.providerJobId };
    if (!job.remoteId || job.remoteId === 'fal-pending') job.remoteId = row.providerJobId;
    persistJob(p, job);
    return true;
  }
  return false;
}

/**
 * Sequential media queue. Downstream requests receive the previous output.
 * Submissions persist the idempotency key first; resubmission after a crash
 * reuses the same key instead of double-paying. The durable ledger records
 * every transition, so a restarted process can tell "not yet submitted" from
 * "submitted but result unknown" — and never re-submits the latter.
 */
export async function tick(p: Project, persist: () => Promise<void>) {
  const job = p.jobs.find((j) => j.status === 'running') || p.jobs.find((j) => j.status === 'queued');
  if (!job || !p.plan) return;
  const index = p.plan.shots.findIndex((s) => s.id === job.shotId);
  const shot = p.plan.shots[index];
  const previous = referencePredecessor(p.plan.shots, index);
  // Reconcile with the durable ledger FIRST: a known provider id survives an
  // expired lease and an unknown local marker.
  if (job.status === 'running') reconcileSubmission(p, job);
  // Lease recovery: a running job whose lease expired belonged to a dead local
  // worker. Unsent work may restart; unknown submissions must not re-submit.
  if (job.status === 'running' && job.leaseExpiresAt && Date.now() > job.leaseExpiresAt) {
    if (job.submission?.state === 'unsent') {
      job.status = 'queued';
      job.leaseExpiresAt = undefined;
      persistJob(p, job);
      return;
    }
    if (job.submission?.state === 'unknown') {
      job.status = 'failed';
      job.error = '本地进程中断时提交结果未知，已阻止重复提交。请核查供应商记录。';
      persistJob(p, job);
      return;
    }
    // Submitted work: fall through and resume polling with the known provider id.
  }
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
      persistJob(p, job);
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
      persistJob(p, job);
      return;
    }
    if (job.status === 'queued') {
      job.status = 'running';
      job.startedAt = Date.now();
      job.leaseExpiresAt = Date.now() + GENERATION_LEASE_MS;
      job.submission = { state: 'unsent' };
      job.input = mediaInput(p, job);
      persistJob(p, job);
      await persist();
      if (job.mode === 'live' && !job.remoteId) {
        await submitJob(p, job, persist);
      }
      return;
    }
    if (Date.now() - (job.startedAt || 0) > 30 * 60 * 1000) {
      job.status = 'failed';
      job.error = '生成超过 30 分钟，请在供应商端核查任务。';
      persistJob(p, job);
      return;
    }
    if (job.group && job.mode === 'demo') {
      job.status = 'succeeded';
      job.finishedAt = Date.now();
      persistJob(p, job);
      return;
    }
    if (job.mode === 'demo') {
      if (Date.now() - (job.startedAt || 0) < 900) return;
      job.status = 'succeeded';
      job.finishedAt = Date.now();
      persistJob(p, job);
      if (job.kind === 'image') shot.referenceMode = 'demo';
      else if (await reflect(p, job)) shot.videoMode = 'demo';
      return;
    }
    // Persist the idempotency key before submission; resubmission after a crash uses the same key.
    if (!job.remoteId) {
      await submitJob(p, job, persist);
      return;
    }
    if (job.remoteId === 'fal-pending') {
      // Crash recovery: if the ledger knows the provider id for this job, adopt
      // it and resume polling; otherwise the submission outcome stays unknown.
      const row = safely((ledger) => ledger.generationJob(job.id));
      if (row && row.submission === 'submitted' && row.providerJobId) {
        job.remoteId = row.providerJobId;
        job.submission = { state: 'submitted', providerJobId: row.providerJobId };
        persistJob(p, job);
      } else {
        throw new Error('上次供应商提交结果不明，已阻止自动重复提交。请核查供应商记录后再手动重试。');
      }
    }
    const result = await pollMedia(job);
    job.status = result.status;
    job.error = result.error;
    if (result.status === 'succeeded') {
      job.outputUrl = result.outputUrl;
      job.finishedAt = Date.now();
      job.leaseExpiresAt = undefined;
      if (job.group) {
        persistJob(p, job);
        return;
      }
      if (job.kind === 'image') {
        shot.referenceUrl = result.outputUrl;
        shot.referenceMode = 'live';
        shot.referenceOrigin = 'generated';
      } else if (await reflect(p, job)) {
        shot.videoUrl = result.outputUrl;
        shot.videoMode = 'live';
      }
    }
    persistJob(p, job);
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : '生成失败';
    persistJob(p, job);
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
    at: Date.now(),
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

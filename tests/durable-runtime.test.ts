import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLedger, closeLedger } from '../lib/studio/durable/ledger.ts';
import { estimateLLMCost, estimateVideoCost, estimateImageCost } from '../lib/studio/durable/pricing.ts';
import { tick, GENERATION_LEASE_MS } from '../lib/studio/commands/jobs.ts';
import { startBackgroundWorker } from '../lib/studio/server.ts';
import { createAutoRun, reconcileRunTasks, nextScheduledTask } from '../lib/studio/autopilot.ts';
import { defaultAgents } from '../lib/studio/team-config.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project, Job } from '../lib/studio/types.ts';

const project = (): Project => ({
  id: 'durable-test',
  revision: 1,
  idea: '雨中等车。',
  title: '雨',
  duration: 30,
  ratio: '16:9',
  mode: 'demo',
  phase: 'clarify',
  createdAt: 0,
  updatedAt: 0,
  questions: [],
  answers: {},
  jobs: [],
  production: initialProduction(),
});

const job = (p: Project, id = 'job-1', overrides: Partial<Job> = {}): Job => ({
  id,
  shotId: p.plan?.shots[0].id ?? 'shot-1',
  kind: 'video',
  status: 'queued',
  mode: p.mode,
  revision: p.revision,
  createdAt: 1000,
  ...overrides,
});

void test('the ledger persists generation job submission boundaries across processes', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ledger-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const ledger = openLedger();
  assert.ok(['sqlite', 'jsonl'].includes(ledger.backend));
  ledger.upsertGenerationJob({
    jobId: 'job-1',
    projectId: 'p1',
    shotId: 'shot-1',
    kind: 'video',
    status: 'running',
    submission: 'unknown',
    providerJobId: '',
    leaseExpiresAt: 0,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  // Same process, but a NEW ledger handle = the crash boundary: the row must
  // come from durable storage, not from memory of the previous handle.
  closeLedger();
  const reopened = openLedger();
  const row = reopened.generationJob('job-1');
  assert.ok(row);
  assert.equal(row.submission, 'unknown');
  assert.equal(row.providerJobId, '');
  // Agent runs/tasks and usage records round-trip too.
  reopened.upsertAgentRun({
    runId: 'run-1',
    projectId: 'p1',
    status: 'running',
    steps: 2,
    maxSteps: 4,
    instruction: '检查文本',
    summary: '',
    commitCount: 0,
    committedFingerprint: '',
    updatedAt: 2,
  });
  reopened.upsertAgentTask({
    taskId: 'task-1',
    runId: 'run-1',
    projectId: 'p1',
    kind: 'review',
    status: 'completed',
    ownerRoleId: 'reviewer',
    capability: 'review_qa',
    dependsOn: '',
    inputRevision: 1,
    outcome: 'reviewed',
    reason: '审查',
    verificationAuthor: '',
    commitCount: 0,
    updatedAt: 3,
  });
  reopened.recordUsage({
    id: 'usage-1',
    projectId: 'p1',
    category: 'video',
    provider: 'minimax',
    model: 'MiniMax-H3',
    estimatedCost: 1.5,
    jobId: 'job-1',
    createdAt: 4,
  });
  closeLedger();
  const again = openLedger();
  assert.equal(again.agentTasks('run-1').length, 1);
  assert.equal(again.agentTasks('run-1')[0].status, 'completed');
  assert.equal(again.usage('p1')[0].estimatedCost, 1.5);
});

void test('crash recovery: an unknown submission with a known provider id resumes, without one it never resubmits', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recover-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    MEDIA_GATEWAY_URL: process.env.MEDIA_GATEWAY_URL,
    MEDIA_API_KEY: process.env.MEDIA_API_KEY,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    MEDIA_GATEWAY_URL: 'https://recover-gateway.invalid',
    MEDIA_API_KEY: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    closeLedger();
  });
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.plan.shots[0].videoInput = { mode: 'text' };
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  // Job crashed between the marker and the response: remoteId is the marker,
  // submission state unknown, no provider id recorded.
  const crashed = job(p, 'job-crashed', {
    status: 'running',
    mode: 'live',
    startedAt: Date.now() - 1000,
    remoteId: 'fal-pending',
    submission: { state: 'unknown' },
    leaseExpiresAt: Date.now() + GENERATION_LEASE_MS,
  });
  p.jobs = [crashed];
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    polls++;
    return new Response(JSON.stringify({ status: 'succeeded', outputUrl: 'https://example.com/ok.mp4' }));
  });
  await tick(p, async () => {});
  // No provider id anywhere: the submission outcome stays unknown; no HTTP, no resubmit.
  assert.equal(polls, 0);
  assert.equal(crashed.status, 'failed');
  assert.match(crashed.error ?? '', /提交结果不明/);
  // Second case: the ledger DID capture the provider id before the crash.
  const recovered = job(p, 'job-recovered', {
    status: 'running',
    mode: 'live',
    startedAt: Date.now() - 1000,
    remoteId: 'fal-pending',
    submission: { state: 'unknown' },
    leaseExpiresAt: Date.now() + GENERATION_LEASE_MS,
  });
  p.jobs = [recovered];
  const ledger = openLedger();
  ledger.upsertGenerationJob({
    jobId: recovered.id,
    projectId: p.id,
    shotId: recovered.shotId,
    kind: 'video',
    status: 'running',
    submission: 'submitted',
    providerJobId: 'provider-42',
    leaseExpiresAt: recovered.leaseExpiresAt ?? 0,
    attempt: 0,
    createdAt: recovered.createdAt,
    updatedAt: 0,
  });
  await tick(p, async () => {});
  assert.equal(polls, 1, 'adopted provider id must resume polling instead of resubmitting');
  assert.equal(recovered.remoteId, 'provider-42');
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.submission?.state, 'submitted');
});

void test('lease recovery distinguishes unsent from unknown work', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lease-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const p = project();
  p.plan = demoPlan(p);
  // Expired lease + unsent submission: safe to restart locally.
  const unsent = job(p, 'job-unsent', { status: 'running', mode: 'live', leaseExpiresAt: 1, submission: { state: 'unsent' } });
  p.jobs = [unsent];
  await tick(p, async () => {});
  assert.equal(unsent.status, 'queued');
  assert.equal(unsent.leaseExpiresAt, undefined);
  // Expired lease + unknown submission: never resubmitted, blocked with a clear error.
  const unknown = job(p, 'job-unknown', { status: 'running', mode: 'live', leaseExpiresAt: 1, submission: { state: 'unknown' } });
  p.jobs = [unknown];
  await tick(p, async () => {});
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.error ?? '', /提交结果未知/);
});

void test('a known provider id survives an expired lease and an unknown local marker', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reconcile-lease-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    MEDIA_GATEWAY_URL: process.env.MEDIA_GATEWAY_URL,
    MEDIA_API_KEY: process.env.MEDIA_API_KEY,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    MEDIA_GATEWAY_URL: 'https://reconcile-gateway.invalid',
    MEDIA_API_KEY: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    closeLedger();
  });
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.plan.shots[0].videoInput = { mode: 'text' };
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  const j = job(p, 'job-lease-known', {
    status: 'running',
    mode: 'live',
    startedAt: Date.now() - 1000,
    remoteId: 'fal-pending',
    submission: { state: 'unknown' },
    leaseExpiresAt: 1, // EXPIRED lease
  });
  p.jobs = [j];
  const ledger = openLedger();
  ledger.upsertGenerationJob({
    jobId: j.id,
    projectId: p.id,
    shotId: j.shotId,
    kind: 'video',
    status: 'running',
    submission: 'submitted',
    providerJobId: 'provider-known',
    leaseExpiresAt: 1,
    attempt: 0,
    createdAt: j.createdAt,
    updatedAt: 0,
  });
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    polls++;
    return new Response(JSON.stringify({ status: 'succeeded', outputUrl: 'https://example.com/known.mp4' }));
  });
  await tick(p, async () => {});
  // Reconciliation happened BEFORE lease handling: the known id is adopted and polled.
  assert.equal(polls, 1);
  assert.equal(j.remoteId, 'provider-known');
  assert.equal(j.status, 'succeeded');
  assert.equal(j.submission?.state, 'submitted');
  // The ledger must NOT have been downgraded by the old unknown/empty state.
  const row = openLedger().generationJob(j.id)!;
  assert.equal(row.submission, 'submitted');
  assert.equal(row.providerJobId, 'provider-known');
});

void test('the ledger never downgrades a confirmed submission', () => {
  const p = project();
  const ledger = openLedger();
  ledger.upsertGenerationJob({
    jobId: 'job-protected',
    projectId: p.id,
    shotId: 'shot-1',
    kind: 'video',
    status: 'running',
    submission: 'submitted',
    providerJobId: 'provider-42',
    leaseExpiresAt: 0,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  // A stale unknown/empty write must not clear the confirmed submission.
  ledger.upsertGenerationJob({
    jobId: 'job-protected',
    projectId: p.id,
    shotId: 'shot-1',
    kind: 'video',
    status: 'failed',
    submission: 'unknown',
    providerJobId: '',
    leaseExpiresAt: 0,
    attempt: 0,
    createdAt: 1,
    updatedAt: 2,
  });
  const row = ledger.generationJob('job-protected')!;
  assert.equal(row.submission, 'submitted');
  assert.equal(row.providerJobId, 'provider-42');
});

void test('the background worker advances approved media without any page request', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bg-worker-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const { writeFile, readFile } = await import('node:fs/promises');
  const p = project();
  p.plan = demoPlan(p);
  p.jobs = [job(p, 'job-bg', { status: 'queued' })];
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const { backgroundTick } = await import('../lib/studio/commands/background.ts');
  await backgroundTick(); // queued → running
  now += 1000;
  await backgroundTick(); // demo elapsed ≥ 900ms → succeeded
  const saved = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  const done = saved[0].jobs.find((j) => j.id === 'job-bg')!;
  assert.equal(done.status, 'succeeded');
  assert.equal(saved[0].plan!.shots[0].videoMode, 'demo');
});

void test('the worker is opt-out via environment and never starts agent steps', () => {
  const old = process.env.STUDIO_BACKGROUND_WORKER;
  process.env.STUDIO_BACKGROUND_WORKER = '0';
  const stop = startBackgroundWorker(10);
  assert.equal(typeof stop, 'function');
  if (old === undefined) delete process.env.STUDIO_BACKGROUND_WORKER;
  else process.env.STUDIO_BACKGROUND_WORKER = old;
});

void test('reconcileRunTasks restores ledger-known tasks and fails interrupted steps', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reconcile-tasks-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const p = project();
  const run = createAutoRun(p, '任务');
  run.id = 'run-reconcile';
  const ledger = openLedger();
  ledger.upsertAgentTask({
    taskId: 'task-pending',
    runId: 'run-reconcile',
    projectId: p.id,
    kind: 'review',
    status: 'pending',
    ownerRoleId: '',
    capability: '',
    dependsOn: '',
    inputRevision: 1,
    outcome: '',
    reason: '待执行会审',
    verificationAuthor: '',
    commitCount: 0,
    updatedAt: 1,
  });
  ledger.upsertAgentTask({
    taskId: 'task-crashed',
    runId: 'run-reconcile',
    projectId: p.id,
    kind: 'revise_storyboard',
    status: 'running',
    ownerRoleId: 'storyboard',
    capability: 'revise_storyboard',
    dependsOn: '',
    inputRevision: 1,
    outcome: '',
    reason: '修订中断',
    verificationAuthor: '',
    commitCount: 0,
    updatedAt: 2,
  });
  ledger.upsertAgentTask({
    taskId: 'task-verify',
    runId: 'run-reconcile',
    projectId: p.id,
    kind: 'verify_storyboard',
    status: 'verification',
    ownerRoleId: 'storyboard',
    capability: 'verify_storyboard',
    dependsOn: 'task-crashed',
    inputRevision: 1,
    outcome: '',
    reason: '复核',
    verificationAuthor: 'storyboard',
    commitCount: 0,
    updatedAt: 3,
  });
  // The project only knows the verify task; the others were lost in a crash.
  run.tasks = [
    {
      id: 'task-verify',
      kind: 'verify_storyboard',
      status: 'completed',
      ownerRoleId: 'reviewer',
      capability: 'verify_storyboard',
      createdBy: 'system',
      dependsOn: ['task-crashed'],
      targetShotIds: [],
      reason: '复核',
      inputVersions: { revision: 1, configRevision: 0 },
      attempts: 1,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const added = reconcileRunTasks(run, p);
  assert.equal(added, 2);
  const pending = run.tasks!.find((task) => task.id === 'task-pending')!;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.reason, '待执行会审');
  const crashed = run.tasks!.find((task) => task.id === 'task-crashed')!;
  assert.equal(crashed.status, 'failed', 'an interrupted step must surface as failed');
  // The project's own record wins over the ledger.
  assert.equal(run.tasks!.find((task) => task.id === 'task-verify')!.status, 'completed');
});

void test('project pending vs ledger running: the interrupted task is never re-executed', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'conflict-pending-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const p = project();
  const run = createAutoRun(p, '任务');
  run.id = 'run-conflict';
  const taskRow = (status: string, commitCount: number) => ({
    taskId: 't1',
    runId: 'run-conflict',
    projectId: p.id,
    kind: 'review',
    status,
    ownerRoleId: 'reviewer',
    capability: 'review_qa',
    dependsOn: '',
    inputRevision: 1,
    outcome: '',
    reason: '审查',
    verificationAuthor: '',
    commitCount,
    updatedAt: 1,
  });
  const ledger = openLedger();
  // Crash window: the project saved t1 as pending; execution began and the
  // ledger recorded running; the process died before the project save.
  run.tasks = [
    {
      id: 't1',
      kind: 'review',
      status: 'pending',
      ownerRoleId: 'reviewer',
      createdBy: 'system',
      dependsOn: [],
      targetShotIds: [],
      reason: '审查',
      inputVersions: { revision: 1, configRevision: 0 },
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  ledger.upsertAgentRun({
    runId: 'run-conflict',
    projectId: p.id,
    status: 'running',
    steps: 1,
    maxSteps: 4,
    instruction: '任务',
    summary: '',
    commitCount: 0,
    committedFingerprint: '',
    updatedAt: 1,
  });
  ledger.upsertAgentTask(taskRow('running', 1));
  reconcileRunTasks(run, p);
  const task = run.tasks!.find((t) => t.id === 't1')!;
  assert.equal(task.status, 'failed', 'a stale pending must not become re-executable');
  assert.equal(nextScheduledTask(run, defaultAgents()).kind, 'idle');
});

void test('a completed ledger task whose result never committed is restored as failed and blocks its verify', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'conflict-uncommitted-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const p = project();
  const run = createAutoRun(p, '任务');
  run.id = 'run-uncommitted';
  const ledger = openLedger();
  ledger.upsertAgentRun({
    runId: 'run-uncommitted',
    projectId: p.id,
    status: 'running',
    steps: 1,
    maxSteps: 4,
    instruction: '任务',
    summary: '',
    commitCount: 1, // only ONE save ever happened
    committedFingerprint: '',
    updatedAt: 1,
  });
  ledger.upsertAgentTask({
    taskId: 't-revise',
    runId: 'run-uncommitted',
    projectId: p.id,
    kind: 'revise_storyboard',
    status: 'completed',
    ownerRoleId: 'storyboard',
    capability: 'revise_storyboard',
    dependsOn: '',
    inputRevision: 1,
    outcome: 'modified',
    reason: '修订',
    verificationAuthor: '',
    commitCount: 2, // predicted save #2 — which never happened
    updatedAt: 2,
  });
  ledger.upsertAgentTask({
    taskId: 't-verify',
    runId: 'run-uncommitted',
    projectId: p.id,
    kind: 'verify_storyboard',
    status: 'verification',
    ownerRoleId: 'storyboard',
    capability: 'verify_storyboard',
    dependsOn: 't-revise',
    inputRevision: 1,
    outcome: '',
    reason: '复核',
    verificationAuthor: 'storyboard',
    commitCount: 2,
    updatedAt: 2,
  });
  reconcileRunTasks(run, p);
  const revise = run.tasks!.find((t) => t.id === 't-revise')!;
  const verify = run.tasks!.find((t) => t.id === 't-verify')!;
  assert.equal(revise.status, 'failed', 'uncommitted completion must surface as failed');
  assert.equal(revise.result, undefined);
  assert.equal(verify.status, 'failed');
  // The blocked verify never becomes runnable: no ready, no waiting.
  const scheduled = nextScheduledTask(run, defaultAgents());
  assert.equal(scheduled.kind, 'idle');
});

void test('a committed completion is restored intact and its verify becomes runnable', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'conflict-committed-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
    closeLedger();
  });
  const p = project();
  const run = createAutoRun(p, '任务');
  run.id = 'run-committed';
  const ledger = openLedger();
  ledger.upsertAgentRun({
    runId: 'run-committed',
    projectId: p.id,
    status: 'running',
    steps: 1,
    maxSteps: 4,
    instruction: '任务',
    summary: '',
    commitCount: 2, // the save after the revise DID happen
    committedFingerprint: '',
    updatedAt: 2,
  });
  ledger.upsertAgentTask({
    taskId: 't-revise',
    runId: 'run-committed',
    projectId: p.id,
    kind: 'revise_storyboard',
    status: 'completed',
    ownerRoleId: 'storyboard',
    capability: 'revise_storyboard',
    dependsOn: '',
    inputRevision: 1,
    outcome: 'modified',
    reason: '修订',
    verificationAuthor: '',
    commitCount: 2,
    updatedAt: 2,
  });
  ledger.upsertAgentTask({
    taskId: 't-verify',
    runId: 'run-committed',
    projectId: p.id,
    kind: 'verify_storyboard',
    status: 'verification',
    ownerRoleId: 'storyboard',
    capability: 'verify_storyboard',
    dependsOn: 't-revise',
    inputRevision: 1,
    outcome: '',
    reason: '复核',
    verificationAuthor: 'storyboard',
    commitCount: 2,
    updatedAt: 2,
  });
  reconcileRunTasks(run, p);
  assert.equal(run.tasks!.find((t) => t.id === 't-revise')!.status, 'completed');
  const scheduled = nextScheduledTask(run, defaultAgents());
  assert.equal(scheduled.kind, 'ready');
});

void test('the JSONL backend collapses per-task history into one latest state', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jsonl-semantics-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LEDGER_BACKEND: process.env.LEDGER_BACKEND,
  };
  Object.assign(process.env, { STUDIO_DATA_DIR: dir, LEDGER_BACKEND: 'jsonl' });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    closeLedger();
  });
  const ledger = openLedger();
  assert.equal(ledger.backend, 'jsonl');
  const row = (status: string, updatedAt: number) => ({
    taskId: 't-jsonl',
    runId: 'run-jsonl',
    projectId: 'p-jsonl',
    kind: 'review',
    status,
    ownerRoleId: 'reviewer',
    capability: 'review_qa',
    dependsOn: '',
    inputRevision: 1,
    outcome: status === 'completed' ? 'reviewed' : '',
    reason: '审查',
    verificationAuthor: '',
    commitCount: 1,
    updatedAt,
  });
  ledger.upsertAgentTask(row('pending', 1));
  ledger.upsertAgentTask(row('running', 2));
  ledger.upsertAgentTask(row('completed', 3));
  const rows = ledger.agentTasks('run-jsonl');
  assert.equal(rows.length, 1, 'one task id must yield one latest row');
  assert.equal(rows[0].status, 'completed');
});

void test('pricing estimates are deterministic and configurable', () => {
  assert.equal(estimateImageCost('fal'), 0.05);
  assert.ok(estimateVideoCost('minimax', 'MiniMax-H3', 10) > 0);
  assert.ok(estimateLLMCost('deepseek-chat', 1000) > 0);
  assert.ok(estimateLLMCost('claude-sonnet', 1000) > estimateLLMCost('deepseek-chat', 1000));
});

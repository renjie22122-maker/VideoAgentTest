import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLedger, closeLedger } from '../lib/studio/durable/ledger.ts';
import { estimateLLMCost, estimateVideoCost, estimateImageCost } from '../lib/studio/durable/pricing.ts';
import { tick, GENERATION_LEASE_MS } from '../lib/studio/commands/jobs.ts';
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

void test('pricing estimates are deterministic and configurable', () => {
  assert.equal(estimateImageCost('fal'), 0.05);
  assert.ok(estimateVideoCost('minimax', 'MiniMax-H3', 10) > 0);
  assert.ok(estimateLLMCost('deepseek-chat', 1000) > 0);
  assert.ok(estimateLLMCost('claude-sonnet', 1000) > estimateLLMCost('deepseek-chat', 1000));
});

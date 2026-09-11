import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeLedger, openLedger } from '../lib/studio/durable/ledger.ts';
import { costSummary } from '../lib/studio/agent/observation.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';

const project = (): Project => ({
  id: 'cost-test',
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

void test('cost summary aggregates the bounded project ledger by category', () => {
  const p = project();
  p.production!.costLedger = [
    { id: '1', category: 'video', provider: 'minimax', model: 'MiniMax-H3', estimatedCost: 3.25, at: 1 },
    { id: '2', category: 'llm', provider: 'deepseek', model: 'deepseek-chat', estimatedCost: 0.12, at: 2 },
    { id: '3', category: 'video', provider: 'minimax', model: 'MiniMax-H3', estimatedCost: 1.75, at: 3 },
  ];
  const summary = costSummary(p);
  assert.equal(summary.currency, 'USD');
  assert.equal(summary.spentEstimated, 5.12);
  assert.deepEqual(summary.byCategory, { llm: 0.12, image: 0, video: 5 });
  assert.equal(summary.budgetUsd, undefined);
});

void test('an LLM call records a documented estimate into the durable ledger', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'llm-cost-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    LLM_BASE_URL: 'https://cost-test.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test-model',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    closeLedger();
  });
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] })),
  );
  const { roleJSON } = await import('../lib/studio/providers.ts');
  await roleJSON('测试角色', '返回 {ok:true}', { idea: '测试' });
  const rows = openLedger().usage('');
  assert.ok(rows.length >= 1);
  const row = rows[rows.length - 1];
  assert.equal(row.category, 'llm');
  assert.equal(row.model, 'test-model');
  assert.ok(row.estimatedCost > 0);
  assert.equal(row.jobId, '');
});

void test('LLM calls with a project context flow into the project budget summary', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'llm-attributed-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    LLM_BASE_URL: 'https://attributed-cost.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test-model',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    closeLedger();
  });
  const p = project();
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] })),
  );
  const { roleJSON } = await import('../lib/studio/providers.ts');
  // The observation-shaped input carries projectId — the attribution contract.
  await roleJSON('测试角色', '返回 {ok:true}', { projectId: p.id, idea: '测试' });
  const summary = costSummary(p);
  // The project mirror has no entries; the LLM spend comes from the ledger.
  assert.equal(p.production!.costLedger, undefined);
  assert.ok(summary.byCategory.llm > 0, 'attributed LLM calls must appear in the project summary');
  assert.ok(summary.spentEstimated > 0);
});

void test('video submission estimates flow into the project ledger mirror', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-cost-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    MEDIA_GATEWAY_URL: process.env.MEDIA_GATEWAY_URL,
    MEDIA_API_KEY: process.env.MEDIA_API_KEY,
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER,
    VIDEO_MODEL: process.env.VIDEO_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    MEDIA_GATEWAY_URL: 'https://gateway-cost.invalid',
    MEDIA_API_KEY: 'test',
    VIDEO_PROVIDER: 'gateway',
    VIDEO_MODEL: 'gateway-video',
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
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ id: 'gateway-job-1' }), { status: 200 }),
  );
  const { submitMedia } = await import('../lib/studio/providers.ts');
  const remoteId = await submitMedia(
    p,
    { id: 'job-cost-1', shotId: p.plan.shots[0].id, kind: 'video', status: 'running', mode: 'live', revision: 1, createdAt: 0 },
  );
  assert.equal(remoteId, 'gateway-job-1');
  const mirror = p.production!.costLedger!;
  assert.equal(mirror.length, 1);
  assert.equal(mirror[0].category, 'video');
  assert.equal(mirror[0].jobId, 'job-cost-1');
  assert.ok(mirror[0].estimatedCost > 0);
  const summary = costSummary(p);
  assert.ok(summary.spentEstimated > 0);
});

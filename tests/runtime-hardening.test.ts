import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  tryAcquireProjectLock,
  tryAcquireGlobalLock,
  releaseProjectLock,
  saveProjectEntry,
} from '../lib/studio/commands/shared.ts';
import { recordApproval, approvalStatus } from '../lib/studio/approvals.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { createAutoRun } from '../lib/studio/autopilot.ts';
import type { Project } from '../lib/studio/types.ts';

const project = (id = 'lock-test', mode: Project['mode'] = 'demo'): Project => ({
  id,
  revision: 1,
  idea: '雨中等车。',
  title: '雨',
  duration: 30,
  ratio: '16:9',
  mode,
  phase: 'clarify',
  createdAt: 0,
  updatedAt: 0,
  questions: [],
  answers: {},
  jobs: [],
  production: initialProduction(),
});

void test('project locks conflict per project and the global lock conflicts with all', () => {
  assert.equal(tryAcquireProjectLock('a'), true);
  assert.equal(tryAcquireProjectLock('a'), false, 'same project cannot double-lock');
  assert.equal(tryAcquireProjectLock('b'), true, 'different projects coexist');
  assert.equal(tryAcquireGlobalLock(), false, 'global conflicts with held project locks');
  releaseProjectLock('a');
  releaseProjectLock('b');
  assert.equal(tryAcquireGlobalLock(), true);
  assert.equal(tryAcquireProjectLock('a'), false, 'project conflicts with held global lock');
  releaseProjectLock('*');
  assert.equal(tryAcquireProjectLock('a'), true);
  releaseProjectLock('a');
});

void test('merge saves preserve concurrent changes to other projects', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'merge-save-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const a = project('project-a');
  const b = project('project-b');
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([a, b]));
  // Concurrent writer updates B on disk while we hold A.
  const disk = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  disk[1].title = '并发修改的 B';
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify(disk));
  // Our merge save writes A only.
  a.title = '修改后的 A';
  await saveProjectEntry(a);
  const saved = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  assert.equal(saved.find((p) => p.id === 'project-a')!.title, '修改后的 A');
  assert.equal(saved.find((p) => p.id === 'project-b')!.title, '并发修改的 B');
});

void test('approval events are additive, bounded and expire with the revision', () => {
  const p = project();
  const event = recordApproval(p, 'render', 'render');
  assert.equal(event.approvedBy, 'user');
  assert.equal(approvalStatus(event, p.revision), 'approved');
  p.revision++;
  assert.equal(approvalStatus(event, p.revision), 'expired');
  for (let i = 0; i < 205; i++) recordApproval(p, 'asset', 'asset-' + i);
  assert.equal(p.production!.approvalEvents!.length, 200);
});

void test('the budget gate blocks enqueue when PROJECT_BUDGET_USD is exceeded', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'budget-gate-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    PROJECT_BUDGET_USD: process.env.PROJECT_BUDGET_USD,
  };
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const p = project('budget-project');
  p.plan = demoPlan(p);
  p.plan.shots.forEach((s) => {
    s.videoInput = { mode: 'text' };
  });
  p.production!.node = 'generation';
  p.production!.renderApprovedRevision = p.revision;
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  process.env.PROJECT_BUDGET_USD = '0.0001';
  await assert.rejects(
    dispatch({ action: 'enqueue', id: p.id, revision: 1, kind: 'video' }),
    /预算不足/,
  );
  const blocked = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  assert.equal(blocked[0].jobs.length, 0, 'the gate must refuse before any job is created');
  delete process.env.PROJECT_BUDGET_USD;
  const result = (await dispatch({ action: 'enqueue', id: p.id, revision: 1, kind: 'video' })) as Project;
  assert.equal(result.jobs.length, p.plan.shots.length);
});

void test('runtime_report exposes run, tasks, cost, artifacts and approvals read-only', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'runtime-report-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p = project('report-project');
  p.plan = demoPlan(p);
  p.production!.costLedger = [
    { id: 'c1', category: 'video', provider: 'minimax', model: 'MiniMax-H3', estimatedCost: 2, at: 1 },
  ];
  recordApproval(p, 'script', 'script');
  const run = createAutoRun(p, '检查文本');
  run.id = 'report-run';
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'cancelled', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0, verification: { required: true, authorRoleId: 'storyboard', previousFindings: [] } },
  ];
  p.production!.autoRun = run;
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  const report = (await dispatch({ action: 'runtime_report', id: p.id })) as {
    run: { status: string; steps: number };
    tasks: { id: string; blockedBy: string | null; result: string | null }[];
    cost: { spentEstimated: number };
    artifacts: { kind: string; status: string }[];
    approvals: { type: string; status: string }[];
  };
  assert.equal(report.run.status, 'running');
  const verify = report.tasks.find((task) => task.id === 't2')!;
  assert.match(verify.blockedBy!, /未完成/);
  assert.equal(report.cost.spentEstimated, 2);
  assert.ok(report.artifacts.some((n) => n.kind === 'video' || n.kind === 'shot'));
  assert.equal(report.approvals[0].type, 'script');
  assert.equal(report.approvals[0].status, 'approved');
  // Read-only: the report never mutates and never takes a lock.
  const before = await readFile(path.join(dir, 'projects.json'), 'utf8');
  await dispatch({ action: 'runtime_report', id: p.id });
  assert.equal(await readFile(path.join(dir, 'projects.json'), 'utf8'), before);
});

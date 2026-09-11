import test from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  autoStep,
  createAutoRun,
  syncVerificationTask,
  nextScheduledTask,
  runnableTasks,
  blockedReason,
  selectVerifier,
  routeCapability,
} from '../lib/studio/autopilot.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { defaultAgents } from '../lib/studio/team-config.ts';
import { withIntent } from './intent-fixture.ts';
import type { Project } from '../lib/studio/types.ts';

const project = () =>
  ({
    id: 'scheduler-test',
    revision: 1,
    idea: '雨中等车。',
    title: '雨',
    duration: 24,
    ratio: '16:9',
    mode: 'demo',
    phase: 'clarify',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  }) as Project;

void test('dependsOn is strict: missing, running or cancelled dependencies block the task', () => {
  const p = project();
  const run = createAutoRun(p, '任务');
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'completed', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0 },
  ];
  assert.deepEqual(runnableTasks(run).map((t) => t.id), ['t2']);
  // A still-running dependency blocks the verification task.
  run.tasks[0].status = 'running';
  assert.deepEqual(runnableTasks(run), []);
  // Cancelled does NOT satisfy a dependency: verification never runs for
  // work that did not land.
  run.tasks[0].status = 'cancelled';
  assert.deepEqual(runnableTasks(run), []);
  assert.match(blockedReason(run.tasks[1], run.tasks)!, /未完成/);
  // A dependency that does not exist at all blocks instead of passing.
  run.tasks[1].dependsOn = ['task-never-created'];
  assert.deepEqual(runnableTasks(run), []);
  assert.match(blockedReason(run.tasks[1], run.tasks)!, /不存在/);
  run.tasks[1].dependsOn = [];
  assert.deepEqual(runnableTasks(run).map((t) => t.id), ['t2']);
});

void test('the scheduler routes verification by capability preference, never to the author', () => {
  const p = project();
  const run = createAutoRun(p, '任务');
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'completed', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0, verification: { required: true, authorRoleId: 'storyboard', previousFindings: [] } },
  ];
  const roles = defaultAgents();
  const scheduled = nextScheduledTask(run, roles);
  assert.equal(scheduled.kind, 'ready');
  if (scheduled.kind !== 'ready') return;
  assert.equal(scheduled.task.id, 't2');
  // Historical preference order: reviewer first, never the author.
  assert.equal(scheduled.decision.roleId, 'reviewer');
  assert.equal(scheduled.decision.action, 'review');
  // Router honors capability grants and exclusion (director is explicitly
  // granted verify_storyboard and precedes continuity in the team order).
  assert.equal(routeCapability(roles, 'verify_storyboard', 'storyboard')!.id, 'director');
  assert.equal(selectVerifier(roles, 'storyboard')!.id, 'reviewer');
  // Only the author enabled: runnable task, no eligible verifier → waiting.
  const alone = roles.filter((r) => r.id === 'storyboard');
  const waiting = nextScheduledTask(run, alone);
  assert.equal(waiting.kind, 'waiting');
  // A capability-less QA role is not eligible just because it sits in the qa stage.
  const qaWithoutCapability: import('../lib/studio/team-config.ts').AgentDefinition[] = [
    { id: 'storyboard', name: '分镜', stages: ['storyboard'], deliverable: 'x', checks: 'x', enabled: true },
    { id: 'qa_agent', name: '质检', stages: ['qa'], deliverable: 'x', checks: 'x', enabled: true },
  ];
  const byStageOnly = nextScheduledTask(run, qaWithoutCapability);
  assert.equal(byStageOnly.kind, 'waiting');
  assert.equal(selectVerifier(qaWithoutCapability, 'storyboard'), undefined);
});

void test('blocked verification never falls back to the planner', async () => {
  const p = project();
  const run = createAutoRun(p, '任务');
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'cancelled', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0, verification: { required: true, authorRoleId: 'storyboard', previousFindings: [] } },
  ];
  p.production!.autoRun = run;
  run.pendingReview = { revision: 1, authorRoleId: 'storyboard', reason: '修订', previousFindings: [] };
  const scheduled = nextScheduledTask(run, defaultAgents());
  assert.equal(scheduled.kind, 'blocked');
  // autoStep must stop without asking the planner or calling any worker.
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.stopReason, 'review_required');
  assert.equal(run.steps, 0);
  assert.equal(run.log.length, 0);
  assert.match(run.summary!, /被阻塞/);
  assert.equal(run.tasks!.find((t) => t.id === 't2')!.status, 'verification');
});

void test('a blocked verification calls no worker even in live mode', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.node = 'storyboard';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'scheduler-blocked-' + Date.now()),
    LLM_BASE_URL: 'https://scheduler-blocked.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
  const run = createAutoRun(p, '复核');
  p.production!.autoRun = run;
  run.pendingReview = { revision: p.revision, authorRoleId: 'storyboard', reason: '修订', previousFindings: [] };
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'cancelled', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0, verification: { required: true, authorRoleId: 'storyboard', previousFindings: [] } },
  ];
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  assert.equal(calls, 0, 'no supervisor or worker call may happen on a blocked path');
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.steps, 0);
});

void test('a verifier without review capability is never executed through the scheduled path', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.node = 'storyboard';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  p.production!.agentConfig = {
    version: 1,
    agents: [
      { id: 'storyboard', name: '分镜', stages: ['storyboard'], deliverable: 'x', checks: 'x', enabled: true, capabilities: ['revise_storyboard'] },
      { id: 'qa_agent', name: '质检', stages: ['qa'], deliverable: 'x', checks: 'x', enabled: true, capabilities: ['review_qa'] },
    ],
  };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'scheduler-verifier-' + Date.now()),
    LLM_BASE_URL: 'https://scheduler-verifier.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const changed = withIntent(p.plan.shots, p.production!.script);
  changed[0].description += ' 主角先站稳，再转身。';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots: changed }) } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '修订分镜', 2);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  assert.equal(calls, 1, 'only the revise worker call may happen');
  const verify = p.production!.autoRun!.tasks!.find((task) => task.kind === 'verify_storyboard')!;
  assert.equal(verify.status, 'verification');
  // The next step: qa_agent grants review_qa but NOT verify_storyboard — the
  // capability-driven selector refuses it; no worker call, gate stays open.
  p.production!.autoRun = createAutoRun(p, '继续复核');
  syncVerificationTask(p.production!.autoRun!, p);
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  assert.equal(calls, 1, 'an incapable verifier must never reach a worker');
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
  assert.equal(p.production!.autoRun!.stopReason, 'review_required');
  assert.equal(p.production!.autoRun!.pendingReview!.authorRoleId, 'storyboard');
});

void test('a plain scheduled review never completes the run while accepted work remains', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'scheduler-plain-' + Date.now()),
    LLM_BASE_URL: 'https://scheduler-plain.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const content = calls === 1
      ? JSON.stringify({
          roleId: 'reviewer',
          action: 'review',
          reason: '初审',
          // The second entry omits roleId: routing must resolve it by capability.
          plan: [{ action: 'review', reason: '复审' }],
        })
      : JSON.stringify({ summary: '未见新增问题', findings: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '会审计划', 4);
  await autoStep(p);
  assert.equal(calls, 2);
  const run = p.production!.autoRun!;
  // The plain first review must NOT have completed the run: accepted work remains.
  assert.equal(run.status, 'running');
  const planTask = run.tasks!.find((task) => task.ownerRoleId === '')!;
  assert.equal(planTask.status, 'pending');
  // Step 2: the roleId-less plan entry routes by capability requirement.
  await autoStep(p);
  assert.equal(calls, 3, 'the routed follow-up review runs with no additional supervisor call');
  const done = run.tasks!.find((task) => task.id === planTask.id)!;
  assert.equal(done.status, 'completed');
  assert.equal(done.ownerRoleId, 'producer', 'routed to the first enabled role granting a review capability');
  assert.equal(run.steps, 2);
});

void test('a supervisor follow-up plan runs through the scheduler without another planner call', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'scheduler-plan-' + Date.now()),
    LLM_BASE_URL: 'https://scheduler-plan.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const content = calls === 1
      ? JSON.stringify({
          roleId: 'reviewer',
          action: 'review',
          reason: '初审',
          plan: [{ action: 'review', roleId: 'continuity', reason: '场记复审' }],
        })
      : JSON.stringify({ summary: '未见新增问题', findings: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '会审计划', 3);
  await autoStep(p);
  assert.equal(calls, 2, 'supervisor + first review');
  const tasks = p.production!.autoRun!.tasks!;
  const first = tasks.find((task) => task.kind === 'review' && task.ownerRoleId === 'reviewer')!;
  const plan = tasks.find((task) => task.ownerRoleId === 'continuity')!;
  assert.equal(first.status, 'completed');
  assert.deepEqual(plan.dependsOn, [first.id]);
  assert.equal(plan.status, 'pending');
  // Step 2: the scheduler runs the planned task — zero additional supervisor calls.
  await autoStep(p);
  assert.equal(calls, 3, 'only the planned worker call');
  const done = p.production!.autoRun!.tasks!.find((task) => task.id === plan.id)!;
  assert.equal(done.status, 'completed');
  assert.equal(done.result?.outcome, 'reviewed');
  assert.equal(done.ownerRoleId, 'continuity');
  assert.equal(p.production!.autoRun!.steps, 2);
});

void test('autoStep serves the scheduled verification task before any planner call', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.node = 'storyboard';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'scheduler-test-' + Date.now()),
    LLM_BASE_URL: 'https://scheduler-test.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const changed = withIntent(p.plan.shots, p.production!.script);
  changed[0].description += ' 主角先站稳，再转身。';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const content = calls === 1
      ? JSON.stringify({ shots: changed })
      : JSON.stringify({ summary: '复核未见待修问题', findings: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '修订分镜', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  assert.equal(calls, 1);
  assert.equal(p.production!.autoRun!.status, 'budget_exhausted');
  // Restart inherits pendingReview; the scheduler now owns the forced review.
  p.production!.autoRun = createAutoRun(p, '继续复核');
  syncVerificationTask(p.production!.autoRun!, p);
  const beforePlanner = calls;
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  // The scheduled verify task ran as a review (worker call) with no supervisor call.
  assert.equal(calls, beforePlanner + 1);
  const log = p.production!.autoRun!.log[0];
  assert.equal(log.action, 'review');
  assert.equal(log.roleId, 'reviewer');
  assert.equal(p.production!.autoRun!.status, 'completed');
  assert.equal(p.production!.autoRun!.pendingReview, undefined);
});

import test from 'node:test';
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
  const scheduled = nextScheduledTask(run, roles)!;
  assert.equal(scheduled.task.id, 't2');
  // Historical preference order: reviewer first, never the author.
  assert.equal(scheduled.decision.roleId, 'reviewer');
  assert.equal(scheduled.decision.action, 'review');
  // Router honors capability grants and exclusion.
  assert.equal(routeCapability(roles, 'verify_storyboard', 'storyboard')!.id, 'continuity');
  assert.equal(selectVerifier(roles, 'storyboard')!.id, 'reviewer');
  // Only the author enabled: nothing is scheduled.
  const alone = roles.filter((r) => r.id === 'storyboard');
  assert.equal(nextScheduledTask(run, alone), undefined);
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
    STUDIO_DATA_DIR: 'scheduler-test-' + Date.now(),
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

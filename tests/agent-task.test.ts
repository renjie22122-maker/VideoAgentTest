import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autoStep, createAutoRun, syncVerificationTask } from '../lib/studio/autopilot.ts';
import type { AgentTask } from '../lib/studio/autopilot.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { withIntent } from './intent-fixture.ts';
import type { Project } from '../lib/studio/types.ts';

const project = () =>
  ({
    id: 'task-test',
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

const tasksOf = (p: Project) => p.production!.autoRun!.tasks ?? [];
const byKind = (p: Project, kind: AgentTask['kind']) =>
  tasksOf(p).filter((t) => t.kind === kind);

function liveStoryboard(p: Project, t: test.TestContext, url: string): Project {
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.node = 'storyboard';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  const keys = ['STUDIO_DATA_DIR', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    // Isolate settings storage: no saved api-settings.json may shadow the env.
    STUDIO_DATA_DIR: path.join(tmpdir(), 'task-live-' + Date.now()),
    LLM_BASE_URL: url + '/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  return p;
}

void test('a storyboard revision opens revise + verification tasks with a dependency', async (t) => {
  const p = liveStoryboard(project(), t, 'https://task-llm.invalid');
  const changed = withIntent(p.plan!.shots, p.production!.script!);
  changed[0].description += ' 主角先站稳，再转身。';
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots: changed }) } }] })),
  );
  p.production!.autoRun = createAutoRun(p, '修订分镜', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  const revise = byKind(p, 'revise_storyboard');
  const verify = byKind(p, 'verify_storyboard');
  assert.equal(revise.length, 1);
  assert.equal(revise[0].status, 'completed');
  assert.equal(revise[0].result?.outcome, 'modified');
  assert.equal(revise[0].createdBy, 'user');
  assert.equal(verify.length, 1);
  assert.equal(verify[0].status, 'verification');
  assert.deepEqual(verify[0].dependsOn, [revise[0].id]);
  assert.equal(verify[0].verification?.required, true);
  assert.equal(verify[0].verification?.authorRoleId, 'storyboard');
  assert.equal(verify[0].inputVersions.revision, p.revision);
  // Budget exhaustion must keep the verification gate open.
  assert.equal(p.production!.autoRun!.status, 'budget_exhausted');
});

void test('only an independent review closes the verification task', async (t) => {
  const p = liveStoryboard(project(), t, 'https://task-llm.invalid');
  const changed = withIntent(p.plan!.shots, p.production!.script!);
  changed[0].description += ' 主角先站稳，再转身。';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const content = calls === 1
      ? JSON.stringify({ shots: changed })
      : JSON.stringify({ summary: '修改后文本复核未见待修问题', findings: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '修订分镜', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  // Inherit pendingReview into a fresh run, like restarting the collaboration.
  p.production!.autoRun = createAutoRun(p, '继续复核');
  syncVerificationTask(p.production!.autoRun!, p);
  assert.equal(byKind(p, 'verify_storyboard').length, 1);
  // The user wrongly tries to stop: the planner must force the review instead.
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  const verify = byKind(p, 'verify_storyboard');
  assert.equal(verify.length, 1);
  assert.equal(verify[0].status, 'completed');
  assert.equal(verify[0].result?.outcome, 'reviewed');
  assert.equal(verify[0].ownerRoleId, 'reviewer');
  assert.equal(p.production!.autoRun!.pendingReview, undefined);
});

void test('refused repetition and failed workers leave faithful task records', async (t) => {
  const p = project();
  p.production!.autoRun = createAutoRun(p, '检查文本');
  const decision = { roleId: 'reviewer', action: 'review' as const, reason: '审查' };
  await autoStep(p, decision);
  await autoStep(p, decision);
  const reviews = byKind(p, 'review');
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].status, 'completed');
  assert.equal(reviews[1].status, 'cancelled');
  assert.equal(reviews[1].result?.outcome, 'unchanged');
  // Failed worker call: planner decides review, the department call throws.
  const live = liveStoryboard(project(), t, 'https://task-llm.invalid');
  live.production!.autoRun = createAutoRun(live, '会审');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 2) throw new Error('部门调用失败');
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ roleId: 'reviewer', action: 'review', reason: '审查' }) } },
        ],
      }),
    );
  });
  // The provider layer wraps worker failures as network-class errors; the
  // task trail must still record the failure faithfully.
  await assert.rejects(autoStep(live), /无法连接/);
  const failed = live.production!.autoRun!.tasks?.find(
    (task) => task.kind === 'review' && task.status === 'failed',
  );
  assert.ok(failed, 'the failing worker call must leave a failed task');
  assert.equal(live.production!.autoRun!.steps, 1);
});

void test('stop claims are recorded as tasks and cannot hide unresolved findings', async () => {
  const p = project();
  p.plan = demoPlan(p);
  p.plan.shots[1].id = p.plan.shots[0].id; // deterministic contradiction
  p.production!.autoRun = createAutoRun(p, '结束');
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '全部完成' });
  const stops = byKind(p, 'stop');
  assert.equal(stops.length, 1);
  assert.equal(stops[0].status, 'completed');
  assert.equal(stops[0].result?.outcome, 'stopped');
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
});

void test('tasks persist through the command gateway and file round trip', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'task-dispatch-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p = project();
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  await dispatch({ action: 'auto_start', id: p.id, revision: 1, notes: '检查文本', maxSteps: 1 });
  const started = (await dispatch({ action: 'get', id: p.id, revision: 1 })) as Project;
  const runId = started.production!.autoRun!.id!;
  const next = (await dispatch({
    action: 'auto_step',
    id: p.id,
    revision: 1,
    expectedRunId: runId,
    expectedStep: 0,
  })) as Project;
  const persisted = next.production!.autoRun!.tasks ?? [];
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].kind, 'review');
  assert.equal(persisted[0].status, 'completed');
  const reloaded = JSON.parse(
    await readFile(path.join(dir, 'projects.json'), 'utf8'),
  ) as Project[];
  assert.deepEqual(reloaded[0].production!.autoRun!.tasks, persisted);
});

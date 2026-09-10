import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autoStep, validateAutoDecision, createAutoRun } from '../lib/studio/autopilot.ts';
import { contentFingerprint } from '../lib/studio/auto-progress.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { withIntent } from './intent-fixture.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { defaultAgents } from '../lib/studio/team-config.ts';
import type { Project } from '../lib/studio/types.ts';
const project = () =>
  ({
    id: 'auto-test',
    revision: 1,
    idea: '一个人在雨中等待，然后离开。',
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
  }) as Project;
const start = (p: Project) => {
  p.production!.autoRun = {
    status: 'running',
    steps: 0,
    maxSteps: 4,
    instruction: '检查文本',
    log: [],
  };
};
void test('automatic dispatch rejects media tools and unavailable departments', () => {
  const p = project();
  for (const action of ['enqueue', 'image', 'video', 'approve_script', 'eval'])
    assert.throws(() =>
      validateAutoDecision({ action, roleId: 'producer', reason: 'test' }, p),
    );
  assert.throws(() =>
    validateAutoDecision(
      { action: 'review', roleId: 'missing', reason: 'test' },
      p,
    ),
  );
  assert.throws(() =>
    validateAutoDecision(
      { action: 'revise_shots', roleId: 'producer', reason: 'test' },
      p,
    ),
  );
  assert.throws(() =>
    validateAutoDecision(
      { action: 'design_assets', roleId: 'producer', reason: 'test' },
      p,
    ),
  );
});
void test('demo dispatch reviews then stops; budget ends without a further call', async () => {
  const p = project();
  start(p);
  await autoStep(p);
  assert.equal(p.production!.teamReports!.length, 1);
  assert.equal(p.production!.autoRun!.steps, 1);
  await autoStep(p);
  assert.equal(p.production!.autoRun!.status, 'completed');
  assert.deepEqual(p.jobs, []);
  start(p);
  p.production!.autoRun!.steps = 4;
  await autoStep(p);
  assert.equal(p.production!.autoRun!.steps, 4);
  assert.equal(p.production!.autoRun!.status, 'budget_exhausted');
  assert.equal(p.production!.autoRun!.stopReason, 'budget_exhausted');
});
void test('automatic steps are transactional, honor model routing, and require script approval', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'autopilot-'));
  const env = { ...process.env };
  const fetchBefore = globalThis.fetch;
  process.env.STUDIO_DATA_DIR = dir;
  process.env.LLM_BASE_URL = 'https://test.invalid/v1';
  process.env.LLM_API_KEY = 'test';
  process.env.LLM_MODEL = 'default-test';
  t.after(() => {
    globalThis.fetch = fetchBefore;
    for (const key of [
      'STUDIO_DATA_DIR',
      'LLM_BASE_URL',
      'LLM_API_KEY',
      'LLM_MODEL',
    ]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  });
  const { dispatch } = await import('../lib/studio/server.ts');
  const p = project();
  p.mode = 'live';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.agentConfig = {
    version: 1,
    agents: defaultAgents().map((a) => ({
      ...a,
      model: a.id === 'producer' ? 'supervisor-test' : 'worker-test',
    })),
  };
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  let current = p;
  const act = async (action: string, extra = {}) => {
    const result = await dispatch({
      id: p.id,
      revision: p.revision,
      action,
      ...(action === 'auto_step' ? { expectedRunId: current.production?.autoRun?.id, expectedStep: current.production?.autoRun?.steps } : {}),
      ...extra,
    }) as Project;
    current = result;
    return result;
  };
  await act('auto_start', { notes: '改进剧本' });
  const firstRunId = current.production!.autoRun!.id!;
  for (const action of [
    'duration_update',
    'shot_image_upload',
    'motion_plan',
    'enqueue',
  ])
    await assert.rejects(act(action), /停止自动/);
  let responses: unknown[] = [
    { roleId: 'producer', action: 'write_script', reason: '完善剧本' },
    {},
  ];
  const models: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.match(url instanceof Request ? url.url : url.toString(), /test.invalid\/v1\/chat\/completions$/);
    assert.equal(typeof init?.body, 'string');
    models.push(JSON.parse(init!.body as string).model);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(responses.shift()) } }],
      }),
    );
  };
  let next = await act('auto_step');
  assert.equal(next.production!.autoRun!.status, 'failed');
  assert.deepEqual(next.production!.script, p.production!.script);
  assert.equal(next.revision, 1);
  assert.equal(next.production!.scriptApproved, true);
  const files = await readdir(path.join(dir, 'auto-backups'));
  assert.equal(files.length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, 'auto-backups', files[0]), 'utf8'))
      .revision,
    1,
  );
  const failedSnapshot = await readFile(path.join(dir, 'projects.json'), 'utf8');
  const failedReplay = await dispatch({ id: p.id, revision: p.revision, action: 'auto_step', expectedRunId: firstRunId, expectedStep: 0 }) as Project;
  assert.deepEqual(failedReplay, next);
  assert.equal(models.length, 2);
  assert.equal(await readFile(path.join(dir, 'projects.json'), 'utf8'), failedSnapshot);
  await act('auto_start', { notes: '改进剧本' });
  const secondRunId = current.production!.autoRun!.id!;
  await assert.rejects(dispatch({ id: p.id, revision: p.revision, action: 'auto_step', expectedRunId: firstRunId, expectedStep: 0 }), /已更换/);
  assert.equal(models.length, 2);
  responses = [
    { roleId: 'writer', action: 'write_script', reason: '完善剧本' },
    { ...demoScreenplay(p), title: '雨后' },
  ];
  next = await act('auto_step');
  assert.equal(next.production!.autoRun!.status, 'waiting_user');
  assert.equal(next.production!.autoRun!.stopReason, 'script_approval');
  assert.equal(next.production!.scriptApproved, false);
  assert.equal(next.production!.node, 'script');
  assert.equal(next.production!.scriptHistory!.length, 1);
  assert.equal(next.revision, 2);
  assert.deepEqual(next.jobs, []);
  assert.deepEqual(models.slice(-2), ['supervisor-test', 'worker-test']);
  const approvedGateSnapshot = await readFile(path.join(dir, 'projects.json'), 'utf8');
  const backupsBeforeReplay = await readdir(path.join(dir, 'auto-backups'));
  const successReplay = await dispatch({ id: p.id, revision: 1, action: 'auto_step', expectedRunId: secondRunId, expectedStep: 0 }) as Project;
  assert.deepEqual(successReplay, JSON.parse(JSON.stringify(next)));
  assert.equal(models.length, 4);
  assert.equal(await readFile(path.join(dir, 'projects.json'), 'utf8'), approvedGateSnapshot);
  assert.deepEqual(await readdir(path.join(dir, 'auto-backups')), backupsBeforeReplay);
  p.revision = next.revision;
  await act('auto_start', { notes: '停止测试' });
  const thirdRunId = current.production!.autoRun!.id!;
  responses = [{ roleId: 'reviewer', action: 'review', reason: '检查修改后的剧本文字' }, { summary: '未见新增问题', findings: [] }];
  next = await act('auto_step');
  assert.equal(next.production!.autoRun!.status, 'running');
  assert.equal(next.production!.autoRun!.steps, 1);
  const runningReplay = await dispatch({ id: p.id, revision: p.revision, action: 'auto_step', expectedRunId: thirdRunId, expectedStep: 0 }) as Project;
  assert.deepEqual(runningReplay, JSON.parse(JSON.stringify(next)));
  assert.equal(models.length, 6);
  next = await act('auto_stop');
  assert.equal(next.production!.autoRun!.status, 'stopped');
  assert.equal(models.length, 6);
});

void test('asset candidates allow text collaboration while images remain unapproved; identical designs do not accumulate', async () => {
  const p = project(); p.plan = demoPlan(p);
  p.production!.script = demoScreenplay(p);
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  start(p);
  const decision = { roleId: 'character_art', action: 'design_assets' as const, reason: '形成候选' };
  await autoStep(p, decision);
  assert.equal(p.production!.autoRun!.status, 'running');
  assert.equal(p.production!.autoRun!.stopReason, undefined);
  const count = p.production!.library!.length;
  assert.ok(count > 0);
  assert.ok(p.production!.library!.every(a => !a.approved && a.status === 'draft' && !a.url));
  assert.equal(p.production!.autoRun!.log[0].artifactIds!.length, count);
  start(p);
  await autoStep(p, decision);
  assert.equal(p.production!.library!.length, count);
  assert.equal(p.production!.autoRun!.stopReason, 'no_progress');
  assert.equal(p.production!.autoRun!.log[0].outcome, 'unchanged');
  assert.deepEqual(p.jobs, []);
});

void test('same-content repeated reviews stop without another worker call and unresolved reports cannot pass', async () => {
  const p = project(); start(p);
  const decision = { roleId: 'reviewer', action: 'review' as const, reason: '审查' };
  await autoStep(p, decision);
  await autoStep(p, decision);
  assert.equal(p.production!.autoRun!.status, 'stopped');
  assert.equal(p.production!.autoRun!.stopReason, 'no_progress');
  assert.equal(p.production!.teamReports!.length, 1);
  assert.equal(p.production!.autoRun!.steps, 2);
  p.production!.teamReports![0].findings = [{ shotId: '', severity: 'warning', evidence: '问题证据', suggestion: '调整', returnTo: 'writer' }];
  start(p);
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '无需继续' });
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
  assert.equal(p.production!.autoRun!.stopReason, 'unresolved_findings');
});

void test('storyboard revisions require independent review, preserve pending work across budget and never call media', async t => {
  const old = { STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_API_KEY: process.env.LLM_API_KEY, LLM_MODEL: process.env.LLM_MODEL };
  Object.assign(process.env, { STUDIO_DATA_DIR: await mkdtemp(path.join(tmpdir(), 'auto-review-')), LLM_BASE_URL: 'https://auto-review.invalid/v1', LLM_API_KEY: 'test', LLM_MODEL: 'test' });
  t.after(() => { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const p = project(); p.duration = 24; p.mode = 'live'; p.plan = demoPlan(p);
  p.production!.node = 'storyboard'; p.production!.script = demoScreenplay(p); p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  p.production!.continuityReview = { revision: p.revision, summary: '需要修订', findings: [{ shotId: 'shot-1', evidence: '动作先后', message: '不清晰', suggestion: '补充动作过渡' }] };
  const changed = withIntent(p.plan.shots, p.production!.script);
  changed[0].description += ' 主角先站稳，再转身。';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.match(String(url), /auto-review.invalid\/v1\/chat\/completions$/);
    const request = JSON.parse(init.body as string); calls++;
    if (calls === 2) {
      const context = JSON.parse(request.messages[1].content);
      assert.equal(context.verification.revision, p.revision);
      assert.equal(context.verification.previousFindings.length, 1);
      assert.match(request.messages[0].content, /独立复核/);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { shots: changed } : { summary: '修改后文本复核未见待修问题', findings: [] }) } }] }));
  });
  p.production!.autoRun = createAutoRun(p, '修订并复核', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  assert.equal(calls, 1);
  assert.equal(p.production!.autoRun!.status, 'budget_exhausted');
  assert.equal(p.production!.autoRun!.stopReason, 'review_required');
  assert.equal(p.production!.autoRun!.pendingReview!.revision, p.revision);
  const revised = structuredClone(p.plan);
  p.production!.autoRun = createAutoRun(p, '继续复核');
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '错误地想直接结束' });
  assert.equal(calls, 2);
  assert.equal(p.production!.autoRun!.log[0].roleId, 'reviewer');
  assert.equal(p.production!.autoRun!.log[0].action, 'review');
  assert.equal(p.production!.autoRun!.status, 'completed');
  assert.equal(p.production!.autoRun!.pendingReview, undefined);
  assert.deepEqual(p.plan, revised);
  assert.deepEqual(p.jobs, []);
});

void test('content fingerprints ignore transport metadata but detect substantive user changes', () => {
  const p = project(); p.plan = demoPlan(p);
  const before = contentFingerprint(p);
  p.revision++; p.updatedAt++; p.plan.shots[0].referenceUrl = '/api/media/test.png';
  p.plan.shots[0].videoUrl = '/api/media/test.mp4';
  assert.equal(contentFingerprint(p), before);
  p.plan.shots[0].description += '站稳后再走';
  assert.notEqual(contentFingerprint(p), before);
});

void test('deterministic contradictions block a supervisor success claim even without model findings', async () => {
  const p = project(); p.plan = demoPlan(p);
  p.plan.shots[1].id = p.plan.shots[0].id;
  start(p);
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '全部完成' });
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
  assert.equal(p.production!.autoRun!.stopReason, 'unresolved_findings');
  assert.match(p.production!.autoRun!.summary!, /文本问题/);
});

void test('pending reviews survive absent reviewer roles and demo reports cannot approve real changes', async () => {
  const p = project(); start(p);
  const pending = { revision: p.revision, authorRoleId: 'storyboard', reason: '修订', previousFindings: [] };
  p.production!.autoRun!.pendingReview = pending;
  p.production!.agentConfig = { version: 1, agents: defaultAgents().filter(a => a.id === 'storyboard') };
  await autoStep(p);
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
  assert.equal(p.production!.autoRun!.steps, 0);
  assert.deepEqual(p.production!.autoRun!.pendingReview, pending);
  delete p.production!.agentConfig;
  p.production!.autoRun = createAutoRun(p, '继续复核');
  await autoStep(p);
  assert.equal(p.production!.autoRun!.status, 'waiting_user');
  assert.equal(p.production!.autoRun!.stopReason, 'review_required');
  assert.deepEqual(p.production!.autoRun!.pendingReview, pending);
});

void test('supervisor receives outstanding text findings and cannot claim approval in its stop log', async t => {
  const p = project(); start(p);
  await autoStep(p, { roleId: 'reviewer', action: 'review', reason: '建立测试报告' });
  const report = p.production!.teamReports![0];
  report.findings = [{ shotId: 'shot-15', severity: 'warning', evidence: '刀已离手却再次甩刀', suggestion: '统一起始状态和动作', returnTo: 'storyboard' }];
  const stale = structuredClone(report); stale.revision = 0;
  p.production!.teamReports!.push(stale);
  p.production!.continuityReview = { revision: p.revision, summary: '仍需复核', findings: [{ shotId: 'shot-12', evidence: '未覆盖已确认动作', message: '动作缺失', suggestion: '恢复动作或请用户裁决' }] };
  const old = { STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_API_KEY: process.env.LLM_API_KEY, LLM_MODEL: process.env.LLM_MODEL };
  Object.assign(process.env, { STUDIO_DATA_DIR: await mkdtemp(path.join(tmpdir(), 'auto-stop-')), LLM_BASE_URL: 'https://auto-stop.invalid/v1', LLM_API_KEY: 'test', LLM_MODEL: 'test' });
  t.after(() => { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  p.mode = 'live'; start(p);
  const claim = '已通过文本会审，无任何问题，只需批准生成';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    calls++;
    assert.match(String(url), /auto-stop.invalid\/v1\/chat\/completions$/);
    const request = JSON.parse(init.body as string);
    const context = JSON.parse(request.messages[1].content);
    assert.equal(context.unresolvedTextFindings.length, 2);
    assert.deepEqual(context.unresolvedTextFindings.map((f: {shotId: string}) => f.shotId), ['shot-15', 'shot-12']);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ roleId: 'producer', action: 'stop', reason: claim }) } }] }));
  });
  await autoStep(p);
  assert.equal(calls, 1);
  const run = p.production!.autoRun!;
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.stopReason, 'unresolved_findings');
  assert.match(run.log[0].message, /仍有 2 项文本问题/);
  assert.match(run.log[0].message, /未批准生成/);
  assert.equal(run.log[0].message.includes(claim), false);
  assert.equal(run.log[0].modelReason, claim);
  assert.equal(p.production!.renderApprovedRevision, undefined);
  assert.deepEqual(p.jobs, []);
});

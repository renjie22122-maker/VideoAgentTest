import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autoStep, validateAutoDecision } from '../lib/studio/autopilot.ts';
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
  assert.equal(p.production!.autoRun!.status, 'completed');
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
  const act = (action: string, extra = {}) =>
    dispatch({
      id: p.id,
      revision: p.revision,
      action,
      ...extra,
    }) as Promise<Project>;
  await act('auto_start', { notes: '改进剧本' });
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
  await act('auto_start', { notes: '改进剧本' });
  responses = [
    { roleId: 'writer', action: 'write_script', reason: '完善剧本' },
    demoScreenplay(p),
  ];
  next = await act('auto_step');
  assert.equal(next.production!.autoRun!.status, 'completed');
  assert.equal(next.production!.scriptApproved, false);
  assert.equal(next.production!.node, 'script');
  assert.equal(next.production!.scriptHistory!.length, 1);
  assert.equal(next.revision, 2);
  assert.deepEqual(next.jobs, []);
  assert.deepEqual(models.slice(-2), ['supervisor-test', 'worker-test']);
  p.revision = next.revision;
  await act('auto_start', { notes: '停止测试' });
  next = await act('auto_stop');
  assert.equal(next.production!.autoRun!.status, 'stopped');
  assert.equal(models.length, 4);
});

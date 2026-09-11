import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction, transition } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';

const project = (id = 'invariant-test', mode: Project['mode'] = 'demo'): Project => ({
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

void test('revision never decreases across a scripted mutation sequence', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'invariant-revision-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p = project();
  p.plan = demoPlan(p);
  p.production!.node = 'generation';
  p.production!.renderApprovedRevision = p.revision;
  p.plan.shots.forEach((s) => {
    s.videoInput = { mode: 'text' };
  });
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  const revision = p.revision;
  // enqueue does not bump revision; cancel then video_config does.
  await dispatch({ action: 'enqueue', id: p.id, revision, kind: 'video' });
  await dispatch({ action: 'cancel', id: p.id, revision });
  await dispatch({ action: 'video_config', id: p.id, revision, shotId: p.plan.shots[0].id, videoInput: { mode: 'text' } });
  const saved = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  const after = saved[0].revision;
  assert.ok(after > revision, 'mutations must never decrease the revision');
  // A stale revision is always rejected.
  await assert.rejects(
    dispatch({ action: 'video_config', id: p.id, revision, shotId: p.plan.shots[0].id, videoInput: { mode: 'text' } }),
    /其他窗口更改/,
  );
});

void test('illegal production transitions are rejected by the state machine', () => {
  const p = project();
  assert.throws(() => transition(p, 'generation', '非法跳转'), /不能从/);
  assert.throws(() => transition(p, 'qa', '非法跳转'), /不能从/);
  transition(p, 'script', '合法');
  transition(p, 'assets', '合法');
  transition(p, 'storyboard', '合法');
  assert.throws(() => transition(p, 'complete', '跳过阶段'), /不能从/);
});

void test('generation approval gates hold before any media work', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'invariant-gate-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p = project();
  p.plan = demoPlan(p);
  p.production!.node = 'generation';
  // No renderApprovedRevision: the approval gate must refuse.
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  await assert.rejects(
    dispatch({ action: 'enqueue', id: p.id, revision: p.revision, kind: 'video' }),
    /批准当前版本提示词/,
  );
  const saved = JSON.parse(await readFile(path.join(dir, 'projects.json'), 'utf8')) as Project[];
  assert.equal(saved[0].jobs.length, 0, 'no job may exist behind a refused gate');
});

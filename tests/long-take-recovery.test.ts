import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project, Job } from '../lib/studio/types.ts';
void test('cancelling a long take cannot bypass unknown or still-pending provider submission guards', async (t) => {
  const previous = process.env.STUDIO_DATA_DIR;
  const root = await mkdtemp(path.join(tmpdir(), 'take-guard-'));
  process.env.STUDIO_DATA_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
  });
  const p: Project = {
    id: 'take-test',
    idea: '走廊',
    answers: {},
    title: 'test',
    revision: 1,
    duration: 30,
    ratio: '16:9',
    mode: 'demo',
    phase: 'planned',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    jobs: [],
    production: initialProduction(),
  };
  p.plan = demoPlan(p);
  p.plan.shots.forEach((s) => {
    s.videoInput = { mode: 'text' };
  });
  p.production!.node = 'generation';
  p.production!.renderApprovedRevision = 1;
  const job: Job = {
    id: 'job',
    shotId: p.plan.shots[0].id,
    kind: 'video',
    status: 'cancelled',
    mode: 'live',
    revision: 1,
    createdAt: 0,
    longTake: {
      phase: 'rendering',
      provider: 'minimax',
      model: 'MiniMax-H3',
      parts: [{ start: 0, end: 15, requestSeconds: 15, submitted: true }],
    },
  };
  p.jobs = [job];
  const { dispatch } = await import('../lib/studio/server.ts');
  for (const remoteId of [undefined, 'minimax-remote-id']) {
    job.longTake!.parts[0].remoteId = remoteId;
    await writeFile(path.join(root, 'projects.json'), JSON.stringify([p]));
    await assert.rejects(
      () =>
        dispatch({
          action: 'enqueue',
          id: p.id,
          revision: p.revision,
          shotId: job.shotId,
          kind: 'video',
          regenerate: true,
        }),
      remoteId ? /未收回/ : /提交结果未知/,
    );
    const saved = JSON.parse(
      await readFile(path.join(root, 'projects.json'), 'utf8'),
    )[0] as Project;
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.jobs[0].status, 'cancelled');
  }
});

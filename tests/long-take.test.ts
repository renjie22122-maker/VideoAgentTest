import test from 'node:test';
import assert from 'node:assert/strict';
import { planLongTake, takeProject } from '../lib/studio/long-take.ts';
import { tickLongTake } from '../lib/studio/take-runner.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { videoProfile } from '../lib/studio/video-profile.ts';
import { requeueFailedJob } from '../lib/studio/job-recovery.ts';
import type { Project, Job, Shot } from '../lib/studio/types.ts';
function fixture() {
  const p = {
    id: 'p',
    title: 'test',
    createdAt: 0,
    updatedAt: 0,
    phase: 'planned',
    questions: [],
    idea: '沿走廊前行',
    answers: {},
    duration: 30,
    ratio: '16:9',
    mode: 'live',
    revision: 1,
    jobs: [],
  } as Project;
  p.plan = demoPlan(p);
  p.plan.shots = [
    {
      ...p.plan.shots[0],
      duration: 30,
      videoInput: { mode: 'text' },
      camera: {
        movement: 'push',
        lens: 35,
        easing: 'linear',
        start: { x: 0, y: 1.6, z: 10 },
        end: { x: 0, y: 1.6, z: 4 },
      },
    },
  ];
  return p;
}
void test('long take partitions meet provider bounds and preserve total duration', () => {
  const s = fixture().plan!.shots[0];
  for (const duration of [16, 30, 31, 60, 120]) {
    const parts = planLongTake({ ...s, duration });
    assert.equal(parts.at(-1)!.end, duration);
    assert.ok(
      parts.every((p) => p.requestSeconds <= 15 && p.requestSeconds >= 4),
    );
    assert.equal(parts[0].start, 0);
    parts.slice(1).forEach((p, i) => assert.equal(p.start, parts[i].end));
  }
  assert.throws(
    () => planLongTake({ ...s, dialogue: '一段未计时的对白' }),
    /时间窗/,
  );
});
void test('next segment requires actual tail and continues rather than restarts camera', () => {
  const p = fixture(),
    s = p.plan!.shots[0],
    j = {
      shotId: s.id,
      longTake: {
        parts: planLongTake(s),
        provider: 'minimax',
        model: 'MiniMax-H3',
        phase: 'rendering',
      },
    } as Job;
  assert.throws(() => takeProject(p, j, 1), /尾帧/);
  j.longTake!.parts[0].tailId = '00000000-0000-0000-0000-000000000001';
  const a = takeProject(p, j, 0).plan!.shots[0],
    b = takeProject(p, j, 1).plan!.shots[0];
  assert.deepEqual(a.camera.end, b.camera.start);
  assert.equal(b.videoInput!.mode, 'first');
  assert.match(b.referenceUrl!, /000001.png$/);
  assert.equal(s.duration, 30);
});
void test('serial worker persists submission and resumes processing without rerendering completed parts', async () => {
  const p = fixture(),
    j = {
      id: '00000000-0000-0000-0000-000000000001',
      shotId: p.plan!.shots[0].id,
      kind: 'video',
      mode: 'live',
      status: 'queued',
    } as Job;
  let submits = 0,
    persists = 0;
  const deps = {
    profile: () => videoProfile({ provider: 'minimax', model: 'MiniMax-H3' }),
    requireFFmpeg: async () => {},
    input: () => ({}),
    newIds: () => ({
      fileId: '00000000-0000-0000-0000-000000000002',
      tailId: '00000000-0000-0000-0000-000000000003',
    }),
    submit: async (_p: Project, _j: Job, before?: () => Promise<void>) => {
      await before?.();
      assert.ok(j.longTake!.parts[submits].submitted);
      submits++;
      return 'remote-' + submits;
    },
    poll: async () => ({
      status: 'succeeded' as const,
      outputUrl: 'https://provider.example/clip.mp4',
    }),
    normalize: async (
      _url: string,
      _seconds: number,
      _ratio: string,
      ids: { fileId: string; tailId: string },
    ) => ids,
    assemble: async () => '/api/studio-videos/final.mp4',
  };
  for (let i = 0; i < 7; i++)
    await tickLongTake(
      p,
      j,
      async () => {
        persists++;
      },
      deps,
    );
  assert.equal(submits, 2);
  assert.equal(j.status, 'succeeded');
  assert.equal(p.plan!.shots[0].videoUrl, '/api/studio-videos/final.mp4');
  assert.ok(persists >= 6);
});
void test('unknown submissions are blocked; known failure only retries the failing part', () => {
  const j = {
    status: 'failed',
    longTake: {
      parts: [
        { start: 0, end: 15, requestSeconds: 15, outputUrl: 'saved' },
        { start: 15, end: 30, requestSeconds: 15, submitted: true },
      ],
      phase: 'rendering',
      provider: 'minimax',
      model: 'MiniMax-H3',
    },
  } as Job;
  assert.throws(() => requeueFailedJob(j, 2), /未知/);
  j.longTake!.parts[1].remoteId = 'id';
  j.longTake!.parts[1].failed = true;
  requeueFailedJob(j, 2);
  assert.equal(j.longTake!.parts[0].outputUrl, 'saved');
  assert.equal(j.longTake!.parts[1].remoteId, undefined);
  assert.equal(j.retries, 1);
});

void test('segmentation avoids spoken lines and never repeats them into the following part', () => {
  const p = fixture(),
    s = p.plan!.shots[0];
  s.dialogue = '向前走';
  s.performance = [
    {
      sourceSceneId: s.scene,
      dialogueIndex: 1,
      characterId: 'c',
      text: '向前走',
      start: 14,
      end: 17,
      mode: 'on_screen',
      delivery: '自然',
      pace: '自然',
      emphasis: '无',
      pauses: '无',
      breath: '自然',
      listener: '同伴',
    },
  ];
  const parts = planLongTake(s);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => !(p.start < 14 && p.end > 14 && p.end < 17)));
  const job = {
    shotId: s.id,
    longTake: {
      parts,
      provider: 'minimax',
      model: 'MiniMax-H3',
      phase: 'rendering',
    },
  } as Job;
  parts.forEach((p) => {
    p.tailId = '00000000-0000-0000-0000-000000000001';
  });
  const spoken = parts
    .map((_, i) => takeProject(p, job, i).plan!.shots[0].dialogue)
    .filter(Boolean);
  assert.deepEqual(spoken, ['向前走']);
});

function timedLine(
  start: number,
  end: number,
  text = '完整对白',
): NonNullable<Shot['performance']>[number] {
  return {
    sourceSceneId: 'scene-1',
    dialogueIndex: 1,
    characterId: 'c',
    text,
    start,
    end,
    mode: 'on_screen',
    delivery: '自然',
    pace: '自然',
    emphasis: '无',
    pauses: '无',
    breath: '自然',
    listener: '同伴',
  };
}
void test('planner moves earlier cuts to retain a legal fifteen-second line', () => {
  const s = {
    ...fixture().plan!.shots[0],
    duration: 31,
    dialogue: '完整对白',
    performance: [timedLine(11, 26)],
  };
  const parts = planLongTake(s);
  assert.deepEqual(
    parts.map(({ start, end }) => [start, end]),
    [
      [0, 11],
      [11, 26],
      [26, 31],
    ],
  );
  assert.equal(parts.length, 3, 'do not add avoidable paid requests');
});
void test('planner preserves fractional dialogue boundaries and overlapping speech', () => {
  const base = fixture().plan!.shots[0];
  const adjacent = planLongTake({
    ...base,
    duration: 34.25,
    dialogue: '甲乙',
    performance: [timedLine(4.25, 19.25, '甲'), timedLine(19.25, 34.25, '乙')],
  });
  assert.ok(
    adjacent.some((part) => part.end === 19.25),
    'adjacent lines may share a cut',
  );
  for (const performance of [
    [timedLine(11.25, 26.25)],
    [timedLine(10, 14), timedLine(13, 20)],
  ]) {
    const parts = planLongTake({
      ...base,
      duration: 31.25,
      dialogue: '完整对白',
      performance,
    });
    for (const line of performance) {
      assert.equal(
        parts.filter((part) => part.start <= line.start && part.end >= line.end)
          .length,
        1,
      );
      assert.ok(
        parts.every((part) => !(line.start < part.end && part.end < line.end)),
      );
    }
    assert.equal(parts.at(-1)!.end, 31.25);
  }
  assert.throws(
    () =>
      planLongTake({
        ...base,
        duration: 31,
        dialogue: '完整对白',
        performance: [timedLine(10, 26)],
      }),
    /不截断对白/,
  );
  assert.throws(
    () =>
      planLongTake({
        ...base,
        duration: 31,
        dialogue: '完整对白',
        performance: [timedLine(30, 32)],
      }),
    /时间窗/,
  );
});
function runnerDeps() {
  return {
    profile: () => videoProfile({ provider: 'minimax', model: 'MiniMax-H3' }),
    requireFFmpeg: async () => {},
    input: () => ({}),
    newIds: () => ({
      fileId: crypto.randomUUID(),
      tailId: crypto.randomUUID(),
    }),
    submit: async (_p: Project, _j: Job, before?: () => Promise<void>) => {
      await before?.();
      return 'remote-id';
    },
    poll: async () => ({ status: 'running' as const }),
    normalize: async (
      _url: string,
      _seconds: number,
      _ratio: string,
      ids: { fileId: string; tailId: string },
      _frames?: number,
    ) => ids,
    assemble: async () => '/api/studio-videos/final.mp4',
  };
}
void test('failure to persist a submission marker does not label an unsubmitted request as unknown', async () => {
  const p = fixture(),
    j = {
      id: crypto.randomUUID(),
      shotId: p.plan!.shots[0].id,
      kind: 'video',
      mode: 'live',
      status: 'queued',
    } as Job;
  let submitted = 0;
  const deps = {
    ...runnerDeps(),
    submit: async (_p: Project, _j: Job, before?: () => Promise<void>) => {
      await before?.();
      submitted++;
      return 'remote-id';
    },
  };
  await assert.rejects(
    tickLongTake(
      p,
      j,
      async () => {
        if (j.longTake?.parts[0].submitted)
          throw new Error('disk failure before request');
      },
      deps,
    ),
    /disk failure/,
  );
  assert.equal(submitted, 0);
  assert.equal(j.longTake!.parts[0].submitted, undefined);
  j.status = 'failed';
  requeueFailedJob(j, 2);
  await tickLongTake(p, j, async () => {}, deps);
  assert.equal(submitted, 1);
  assert.equal(j.longTake!.parts[0].remoteId, 'remote-id');
});
void test('a timeout after submission retains the unknown-result protection', async () => {
  const p = fixture(),
    j = {
      id: crypto.randomUUID(),
      shotId: p.plan!.shots[0].id,
      kind: 'video',
      mode: 'live',
      status: 'queued',
    } as Job;
  const deps = {
    ...runnerDeps(),
    submit: async (_p: Project, _j: Job, before?: () => Promise<void>) => {
      await before?.();
      throw new Error('provider timeout');
    },
  };
  await assert.rejects(
    tickLongTake(p, j, async () => {}, deps),
    /provider timeout/,
  );
  assert.equal(j.longTake!.parts[0].submitted, true);
  j.status = 'failed';
  assert.throws(() => requeueFailedJob(j, 2), /未知/);
});
void test('normalization uses an absolute frame budget without rounding drift across parts', async () => {
  for (const duration of [61, 120.5, 601, 3599]) {
    const p = fixture();
    p.plan!.shots[0].duration = duration;
    const parts = planLongTake(p.plan!.shots[0]).map((part) => ({
      ...part,
      outputUrl: 'https://provider.example/ready.mp4',
    }));
    const j = {
      id: crypto.randomUUID(),
      shotId: p.plan!.shots[0].id,
      kind: 'video',
      mode: 'live',
      status: 'running',
      longTake: {
        provider: 'minimax',
        model: 'MiniMax-H3',
        phase: 'rendering',
        parts,
      },
    } as Job;
    let frames = 0,
      normalized = 0;
    const deps = {
      ...runnerDeps(),
      normalize: async (
        _url: string,
        _seconds: number,
        _ratio: string,
        ids: { fileId: string; tailId: string },
        count?: number,
      ) => {
        assert.ok(count && count > 0);
        frames += count;
        normalized++;
        return ids;
      },
    };
    for (let i = 0; i <= parts.length; i++)
      await tickLongTake(p, j, async () => {}, deps);
    assert.equal(normalized, parts.length);
    assert.equal(frames, Math.round(duration * 24));
    assert.equal(j.status, 'succeeded');
  }
});

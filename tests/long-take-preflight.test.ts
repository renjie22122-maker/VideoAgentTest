import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { videoPreview } from '../lib/studio/providers.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import type { Project, Job } from '../lib/studio/types.ts';

function fixture(t: TestContext, provider = 'minimax') {
  const values = {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'frame-take-preview-' + randomUUID()),
    VIDEO_PROVIDER: provider,
    MEDIA_GATEWAY_URL: 'https://api.minimax.io',
    VIDEO_MODEL: 'MiniMax-H3',
    MEDIA_API_KEY: 'test-key-no-network',
    FAL_API_KEY: 'test-key-no-network',
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('Unexpected network request'); });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.equal(fetches, 0, 'preflight must not call a provider');
  });
  const p: Project = {
    id: 'test-take-preview', title: '走廊长镜头', idea: '人物连续走过走廊',
    createdAt: 0, updatedAt: 0, phase: 'planned', questions: [], answers: {},
    duration: 30, ratio: '16:9', mode: 'live', revision: 1, jobs: [],
  };
  p.plan = demoPlan(p);
  p.plan.shots = [{ ...p.plan.shots[0], duration: 30, videoInput: { mode: 'text' },
    intent: { actionIndices: [1], dialogueIndices: [], purpose: '展示人物前行',
      movementReason: '跟随人物', speedPlan: '全程匀速', actionTiming: '0–30秒：连续前行',
      visualPlan: '保持走廊方向', cutReason: '一镜到底', physicsChecks: ['脚底接触地面'], scaleAnchors: ['人物小于门高'] },
  }];
  const shot = p.plan.shots[0];
  const job: Job = { id: 'test-take-job', shotId: shot.id, kind: 'video', mode: 'live', status: 'queued', revision: 1, createdAt: 0 };
  return { p, shot, job };
}

void test('long-take preflight reports first-segment compilation failures instead of passing silently', t => {
  const { p, shot, job } = fixture(t);
  shot.description = '景'.repeat(4000);
  shot.sound = '声'.repeat(1000);
  shot.startState = { ...shot.startState, wardrobe: '衣'.repeat(1000), props: '道'.repeat(1000) };
  const result = videoPreview(p, job);
  assert.ok(result.issues.some(issue => /第 1 段.*7000/.test(issue)));
  const segments = JSON.parse(result.prompt!).分段;
  assert.ok(segments[0].问题.length > 0);
  assert.equal(segments[0].提示词, undefined);
});

void test('later segment compilation is checked before the first paid request', t => {
  const { p, shot, job } = fixture(t);
  shot.description = '景'.repeat(3000);
  shot.endState = { ...shot.endState, pose: '姿'.repeat(500), wardrobe: '衣'.repeat(1000), props: '道'.repeat(1000), light: '光'.repeat(1000) };
  const result = videoPreview(p, job);
  const segments = JSON.parse(result.prompt!).分段;
  assert.equal(segments[0].问题.length, 0);
  assert.ok(segments[0].提示词.length > 0);
  assert.ok(result.issues.some(issue => /第 2 段.*7000/.test(issue)));
});

void test('preview exposes each continuation prompt without altering the project or requiring generated tails', t => {
  const { p, shot, job } = fixture(t);
  shot.referenceUrl = 'https://assets.example/start.png';
  shot.videoInput = { mode: 'first_last', lastFrameUrl: 'https://assets.example/end.png' };
  const before = JSON.stringify({ p, job });
  const result = videoPreview(p, job);
  assert.deepEqual(result.issues, []);
  const preview = JSON.parse(result.prompt!);
  assert.match(preview.参考帧说明, /占位/);
  assert.deepEqual(preview.分段.map((part: {输入方式: string}) => part.输入方式), ['first', 'first_last']);
  assert.ok(preview.分段.every((part: {提示词: string; 问题: string[]}) => part.提示词 && !part.问题.length));
  assert.equal(JSON.stringify({ p, job }), before);
});

void test('Kling long-take preflight compiles rounded requests and following first-frame parts', t => {
  const { p, shot, job } = fixture(t, 'fal-kling');
  shot.duration = 31;
  const result = videoPreview(p, job);
  assert.deepEqual(result.issues, []);
  const parts = JSON.parse(result.prompt!).分段;
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part: {请求秒: number; 提示词: string}) => Number.isInteger(part.请求秒) && part.请求秒 <= 15 && part.提示词));
  assert.deepEqual(parts.map((part: {输入方式: string}) => part.输入方式), ['text', 'first', 'first']);
});

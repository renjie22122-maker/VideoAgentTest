import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseVisualFindings, buildVisualReviewRequest, sampleVideoFrames } from '../lib/studio/visual-qa.ts';
import { reviewMediaFrames } from '../lib/studio/providers.ts';
import { reviewForJob } from '../lib/studio/commands/jobs.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { runFFmpeg } from '../lib/studio/take-media.ts';
import type { Project, Job } from '../lib/studio/types.ts';

const project = (): Project => ({
  id: 'visual-qa-test',
  revision: 1,
  idea: '雨中等车。',
  title: '雨',
  duration: 24,
  ratio: '16:9',
  mode: 'live',
  phase: 'clarify',
  createdAt: 0,
  updatedAt: 0,
  questions: [],
  answers: {},
  jobs: [],
  production: initialProduction(),
});

const job = (p: Project): Job => ({
  id: 'job-vqa',
  shotId: p.plan?.shots[0].id ?? 'shot-1',
  kind: 'video',
  status: 'running',
  mode: 'live',
  revision: p.revision,
  createdAt: 0,
  outputUrl: 'https://example.com/clip.mp4',
});

void test('visual findings parser enforces timestamped, actionable evidence', () => {
  assert.deepEqual(parseVisualFindings([], 10), []);
  const findings = parseVisualFindings(
    [
      { code: 'identity-change', severity: 'error', timestamp: 2.5, evidence: '发色', suggestion: '保持发色与参考一致' },
    ],
    10,
  );
  assert.equal(findings[0].code, 'identity-change');
  assert.equal(findings[0].timestamp, 2.5);
  assert.throws(() => parseVisualFindings([{ code: 'x', severity: 'fatal', timestamp: 2, suggestion: '修' }], 10), /无效/);
  assert.throws(() => parseVisualFindings([{ code: 'x', severity: 'error', suggestion: '修' }], 10), /无效/);
  assert.throws(() => parseVisualFindings([{ code: 'x', severity: 'error', timestamp: 99, suggestion: '修' }], 10), /无效/);
  assert.throws(() => parseVisualFindings(Array.from({ length: 11 }, () => ({ code: 'x', severity: 'info', timestamp: 1, suggestion: '修' })), 10), /格式无效/);
});

void test('the visual review request carries frames, criteria and idempotency', () => {
  const p = project();
  p.plan = demoPlan(p);
  const j = job(p);
  const frames = [
    { path: '/tmp/f0.png', timestampSec: 1.2, dataUrl: 'data:image/png;base64,QUJD' },
    { path: '/tmp/f1.png', timestampSec: 2.4, dataUrl: 'data:image/png;base64,REVG' },
  ];
  const request = buildVisualReviewRequest(p, j, frames);
  const requestFrames = request.frames as { timestampSec: number; dataUrl: string }[];
  assert.equal(request.idempotencyKey, 'job-vqa-qa-frames');
  assert.equal(requestFrames.length, 2);
  assert.equal(requestFrames[0].timestampSec, 1.2);
  assert.ok(String(requestFrames[0].dataUrl).startsWith('data:image/png;base64,'));
  assert.deepEqual(request.criteria, ['identity', 'wardrobe', 'limbs', 'action_match', 'camera_motion', 'temporal_continuity']);
});

void test('frame review posts frames to the gateway and parses findings', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vqa-frames-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    QA_GATEWAY_URL: process.env.QA_GATEWAY_URL,
    QA_API_KEY: process.env.QA_API_KEY,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    QA_GATEWAY_URL: 'https://vqa-gateway.invalid',
    QA_API_KEY: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const p = project();
  p.plan = demoPlan(p);
  const j = job(p);
  let captured: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    captured = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        verdict: 'rejected',
        notes: '发色漂移',
        findings: [{ code: 'identity-change', severity: 'error', timestamp: 1.2, suggestion: '保持发色一致' }],
      }),
    );
  });
  const frames = [
    { path: '/tmp/f0.png', timestampSec: 1.2, dataUrl: 'data:image/png;base64,QUJD' },
  ];
  const review = await reviewMediaFrames(p, j, frames);
  assert.equal(review!.verdict, 'rejected');
  assert.equal(review!.findings.length, 1);
  assert.equal((captured.frames as unknown[]).length, 1);
  assert.equal(captured.idempotencyKey, 'job-vqa-qa-frames');
});

void test('reviewForJob falls back to the URL contract when frame sampling is off', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vqa-fallback-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    QA_GATEWAY_URL: process.env.QA_GATEWAY_URL,
    QA_API_KEY: process.env.QA_API_KEY,
    VISUAL_QA_SAMPLE_FRAMES: process.env.VISUAL_QA_SAMPLE_FRAMES,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    QA_GATEWAY_URL: 'https://vqa-fallback.invalid',
    QA_API_KEY: 'test',
    VISUAL_QA_SAMPLE_FRAMES: '0',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const p = project();
  p.plan = demoPlan(p);
  const j = job(p);
  let captured: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    captured = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ verdict: 'passed', notes: 'ok' }));
  });
  const review = await reviewForJob(p, j);
  assert.equal(review!.verdict, 'passed');
  assert.ok('videoUrl' in captured, 'the fallback posts the video URL contract');
  assert.ok(!('frames' in captured));
});

void test('frame sampling extracts evenly spaced frames when ffmpeg is available', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vqa-sample-'));
  let ffmpegAvailable = true;
  try {
    await runFFmpeg(['-version']);
  } catch {
    ffmpegAvailable = false;
  }
  if (!ffmpegAvailable) {
    t.skip('FFmpeg unavailable in this environment; sampling stays guarded');
    return;
  }
  const clip = path.join(dir, 'clip.mp4');
  await runFFmpeg([
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
    '-pix_fmt', 'yuv420p', '-y', clip,
  ]);
  const frames = await sampleVideoFrames(clip, dir, 3);
  assert.equal(frames.length, 3);
  assert.ok(frames[0].timestampSec < frames[1].timestampSec);
  assert.ok(frames[1].timestampSec < frames[2].timestampSec);
  assert.ok(frames[0].dataUrl.startsWith('data:image/png;base64,'));
});

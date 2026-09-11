import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

/**
 * Visual QA closed-loop evaluation with a LOCAL mock vision gateway:
 *   node --experimental-strip-types scripts/visual-qa-eval.mjs
 *
 * Real FFmpeg frame sampling, real HTTP contract, zero model spend. The mock
 * gateway rejects the first review with a structured finding (identity
 * change) and passes the second — measuring: frames sampled, findings parsed,
 * regeneration decision, retry budget, final verdict.
 */

const dir = await mkdtemp(path.join(tmpdir(), 'vqa-eval-'));
process.env.STUDIO_DATA_DIR = dir;
process.env.VISUAL_QA_SAMPLE_FRAMES = '1';

const { runFFmpeg } = await import('../lib/studio/take-media.ts');
let ffmpegAvailable = true;
try {
  await runFFmpeg(['-version']);
} catch {
  ffmpegAvailable = false;
}
if (!ffmpegAvailable) {
  console.log(JSON.stringify({ skipped: true, reason: 'FFmpeg unavailable' }));
  process.exit(0);
}

// 1. Generate a real 2s test clip.
const clip = path.join(dir, 'clip.mp4');
await runFFmpeg([
  '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
  '-pix_fmt', 'yuv420p', '-y', clip,
]);

// 2. Mock vision gateway: reject once with a timestamped finding, then pass.
let reviewCount = 0;
const gateway = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    reviewCount++;
    const request = JSON.parse(body);
    const frames = Array.isArray(request.frames) ? request.frames.length : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (reviewCount === 1) {
      res.end(
        JSON.stringify({
          verdict: 'rejected',
          notes: '模拟视觉缺陷：角色发色漂移（第 2 帧）。',
          findings: [
            { code: 'identity-change', severity: 'error', timestamp: frames >= 2 ? request.frames[1].timestampSec : 0.5, suggestion: '保持发色与美术参考一致，重新生成本镜。' },
          ],
        }),
      );
    } else {
      res.end(JSON.stringify({ verdict: 'passed', notes: '复核通过', findings: [] }));
    }
  });
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const port = gateway.address().port;
process.env.QA_GATEWAY_URL = `http://127.0.0.1:${port}`;
process.env.QA_API_KEY = 'eval';

// 3. Drive the loop: reject → regeneration decision → pass.
const { reflect } = await import('../lib/studio/commands/jobs.ts');
const { demoPlan } = await import('../lib/studio/domain.ts');
const { demoScreenplay } = await import('../lib/studio/screenplay.ts');
const { initialProduction } = await import('../lib/studio/graph.ts');

const p = {
  id: 'vqa-eval',
  revision: 1,
  idea: '测试',
  title: 't',
  duration: 24,
  ratio: '16:9',
  mode: 'live',
  phase: 'planned',
  createdAt: 0,
  updatedAt: 0,
  questions: [],
  answers: {},
  jobs: [],
  production: initialProduction(),
};
p.plan = demoPlan(p);
p.production.script = demoScreenplay(p);
p.production.scriptApproved = true;
p.production.assets = { bible: p.plan.bible, seed: 42, locked: false };
p.production.node = 'generation';

const job = {
  id: 'job-vqa',
  shotId: p.plan.shots[0].id,
  kind: 'video',
  status: 'running',
  mode: 'live',
  revision: p.revision,
  createdAt: Date.now(),
  outputUrl: clip,
};

const firstDecision = await reflect(p, job);
const firstVerdict = p.production.qa.find((q) => q.shotId === p.plan.shots[0].id)?.verdict;
const firstFindings = p.production.qa.find((q) => q.shotId === p.plan.shots[0].id)?.findings ?? [];
const retried = p.jobs[0];
retried.outputUrl = clip;
const secondDecision = await reflect(p, retried);
const qa = p.production.qa.find((q) => q.shotId === p.plan.shots[0].id);

gateway.close();

console.log(
  JSON.stringify(
    {
      skipped: false,
      ffmpeg: true,
      gatewayReviews: reviewCount,
      firstVerdict,
      firstFindings: firstFindings.map((f) => ({ code: f.code, timestamp: f.timestamp })),
      regenerationDecided: firstDecision === false,
      retryBudgetUsed: retried?.qaRetries ?? 0,
      secondVerdict: qa?.verdict,
      finalFindingsStored: qa?.findings?.length ?? 0,
      loopClosed: secondDecision === true,
    },
    null,
    2,
  ),
);

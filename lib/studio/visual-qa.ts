import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runFFmpeg } from './take-media.ts';
import { text } from './domain.ts';
import { previousNarrativeShot } from './narrative.ts';
import { assetReferences } from './assets.ts';
import { readImage } from './openai-images.ts';
import type { Project, Job } from './types.ts';
import { productionSkills } from './skills.ts';

/**
 * Visual QA closed loop, frame-sampling half:
 *
 *   generated video → frame sampling (FFmpeg) → multimodal review request
 *   → structured findings → corrective regeneration decision.
 *
 * Sampling depth is configurable: VISUAL_QA_FRAME_COUNT (default 5) and
 * VISUAL_QA_FRAME_WIDTH (default 720). The review request carries the
 * NARRATIVE predecessor (not just the playback predecessor), approved asset
 * reference images, and dialogue performance windows so short glitches,
 * identity and lip-sync can be checked against evidence.
 */
export type VisualFinding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** Frame timestamp (seconds) this finding refers to. */
  timestamp?: number;
  /** Optional evidence excerpt from the vision reviewer. */
  evidence?: string;
  suggestion: string;
};

export type VisualReviewReport = {
  verdict: 'passed' | 'rejected';
  notes: string;
  findings: VisualFinding[];
  source: 'vision';
};

export type SampledFrame = { path: string; timestampSec: number; dataUrl: string };

/** Decodes the Duration line from a bare `ffmpeg -i` probe's stderr log. */
function durationFromProbeLog(log: string): number {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log ?? '');
  if (!match) throw new Error('无法读取视频时长。');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function probeDurationSeconds(source: string): Promise<number> {
  try {
    // A bare -i probe exits non-zero after printing the container info.
    await runFFmpeg(['-i', source]);
    throw new Error('探针意外成功。');
  } catch (error) {
    const log =
      error instanceof Error && error.cause && typeof error.cause === 'string'
        ? error.cause
        : '';
    const duration = durationFromProbeLog(log);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error('无法读取视频时长。');
    return duration;
  }
}

/**
 * Extract `count` frames at evenly spaced timestamps. Sequential spawns, small
 * output (480px wide), one directory per call — safe for long takes too.
 */
export async function sampleVideoFrames(
  source: string,
  outDir: string,
  count = Number(process.env.VISUAL_QA_FRAME_COUNT ?? 5),
  width = Number(process.env.VISUAL_QA_FRAME_WIDTH ?? 720),
): Promise<SampledFrame[]> {
  await mkdir(outDir, { recursive: true });
  const duration = await probeDurationSeconds(source);
  const frames: SampledFrame[] = [];
  for (let i = 0; i < count; i++) {
    const timestampSec = Math.min(
      duration - 0.05,
      Math.max(0.05, ((i + 1) / (count + 1)) * duration),
    );
    const framePath = path.join(outDir, 'frame-' + i + '.png');
    await runFFmpeg([
      '-ss',
      timestampSec.toFixed(2),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      'scale=' + Math.max(64, Math.min(1920, Math.round(width))) + ':-2',
      '-y',
      framePath,
    ]);
    const bytes = await readFile(framePath);
    frames.push({
      path: framePath,
      timestampSec: Math.round(timestampSec * 100) / 100,
      dataUrl: 'data:image/png;base64,' + bytes.toString('base64'),
    });
  }
  return frames;
}

export async function buildVisualReviewRequest(
  p: Project,
  j: Job,
  frames: SampledFrame[],
): Promise<Record<string, unknown>> {
  const shot = p.plan?.shots.find((s) => s.id === j.shotId);
  const index = p.plan?.shots.findIndex((s) => s.id === j.shotId) ?? -1;
  // The NARRATIVE predecessor — cross-cutting timelines must not confuse
  // threads with the playback-order neighbor.
  const previous = index >= 0 ? (previousNarrativeShot(p.plan!.shots, index) ?? null) : null;
  // Approved asset reference images: local ones become data URLs, remote stay HTTPS.
  const referenceImages: string[] = [];
  for (const url of assetReferences(p, j.shotId).slice(0, 9)) {
    const match = /^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(url);
    referenceImages.push(
      match
        ? 'data:image/' +
            (match[2] === 'jpg' ? 'jpeg' : match[2]) +
            ';base64,' +
            (await readImage(match[1], match[2])).toString('base64')
        : url,
    );
  }
  return {
    instructions:
      '逐帧核查人物身份、服装、肢体、动作匹配、相机运动与跨镜时间连续性。' +
      '结论必须引用具体帧时间戳；没有帧证据的缺陷不得上报为视觉错误。' +
      '声音与口型连续性仅当评测服务具备音频/多模态能力时核查，否则注明未核查。',
    skillVersion: productionSkills.reviewer.version,
    frames: frames.map((frame) => ({
      timestampSec: frame.timestampSec,
      dataUrl: frame.dataUrl,
    })),
    shot,
    bible: p.plan?.bible,
    previousShot: previous
      ? { id: previous.id, videoUrl: previous.videoUrl ?? null, description: previous.description, endState: previous.endState }
      : null,
    referenceImages,
    performanceWindows: (shot?.performance ?? []).map((line) => ({
      start: line.start,
      end: line.end,
      characterId: line.characterId,
      text: line.text,
      mode: line.mode,
    })),
    soundCues: shot?.soundCues ?? [],
    criteria: [
      'identity',
      'wardrobe',
      'limbs',
      'action_match',
      'camera_motion',
      'temporal_continuity',
      'lip_sync',
    ],
    idempotencyKey: j.id + '-qa-frames',
  };
}

/** Strict parser: at most 10 findings, every one timestamped and actionable. */
export function parseVisualFindings(
  raw: unknown,
  shotDuration: number,
): VisualFinding[] {
  if (!Array.isArray(raw) || raw.length > 10)
    throw new Error('视觉审查结果格式无效。');
  return raw.map((value: unknown, i: number) => {
    const f = (value ?? {}) as Record<string, unknown>;
    const severity = f.severity;
    if (
      !f ||
      !['error', 'warning', 'info'].includes(severity as string) ||
      typeof f.code !== 'string' ||
      !f.code.trim() ||
      f.code.length > 100 ||
      !Number.isFinite(f.timestamp) ||
      Number(f.timestamp) < 0 ||
      Number(f.timestamp) > shotDuration + 0.1 ||
      typeof f.suggestion !== 'string' ||
      !f.suggestion.trim() ||
      f.suggestion.length > 2000
    )
      throw new Error('视觉审查发现第 ' + (i + 1) + ' 项无效：必须包含 code、severity、帧时间戳与修改建议。');
    return {
      code: f.code.trim(),
      severity: severity as VisualFinding['severity'],
      timestamp: Math.round(Number(f.timestamp) * 100) / 100,
      ...(typeof f.evidence === 'string' && f.evidence.trim()
        ? { evidence: text(f.evidence, '证据', 500) }
        : {}),
      suggestion: text(f.suggestion, '修改建议', 2000),
    };
  });
}

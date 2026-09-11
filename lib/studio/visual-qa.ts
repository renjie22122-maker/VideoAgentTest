import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runFFmpeg } from './take-media.ts';
import { text } from './domain.ts';
import type { Project, Job } from './types.ts';
import { productionSkills } from './skills.ts';

/**
 * Visual QA closed loop, frame-sampling half:
 *
 *   generated video → frame sampling (FFmpeg) → multimodal review request
 *   → structured findings → corrective regeneration decision.
 *
 * The review gateway receives frames (data URLs) instead of — or in addition
 * to — the video URL; a text finding without frame evidence can never claim
 * to be a verified visual defect, so every finding references a timestamp.
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
  count = 3,
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
      'scale=480:-2',
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

export function buildVisualReviewRequest(
  p: Project,
  j: Job,
  frames: SampledFrame[],
): Record<string, unknown> {
  const shot = p.plan?.shots.find((s) => s.id === j.shotId);
  const index = p.plan?.shots.findIndex((s) => s.id === j.shotId) ?? -1;
  const previous = index > 0 ? (p.plan?.shots[index - 1] ?? null) : null;
  return {
    instructions:
      '逐帧核查人物身份、服装、肢体、动作匹配、相机运动与跨镜时间连续性。' +
      '结论必须引用具体帧时间戳；没有帧证据的缺陷不得上报为视觉错误。',
    skillVersion: productionSkills.reviewer.version,
    frames: frames.map((frame) => ({
      timestampSec: frame.timestampSec,
      dataUrl: frame.dataUrl,
    })),
    shot,
    bible: p.plan?.bible,
    previousShot: previous,
    criteria: [
      'identity',
      'wardrobe',
      'limbs',
      'action_match',
      'camera_motion',
      'temporal_continuity',
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

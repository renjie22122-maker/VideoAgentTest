import type { Shot, Project, Job } from './types.ts';
import { motionAt } from './motion.ts';
export type TakePart = {
  start: number;
  end: number;
  requestSeconds: number;
  remoteId?: string;
  outputUrl?: string;
  fileId?: string;
  tailId?: string;
  submitted?: boolean;
  failed?: boolean;
  mediaIds?: { fileId: string; tailId: string };
};
export type LongTake = {
  parts: TakePart[];
  provider: string;
  model: string;
  phase: 'rendering' | 'assembling' | 'complete';
};
export function planLongTake(s: Shot, min = 4, max = 15): TakePart[] {
  if (!Number.isFinite(s.duration) || s.duration <= max || s.duration > 3600)
    throw new Error(
      '长镜头须大于单次生成上限，且一次不超过 3600 秒；更长内容请分幕。',
    );
  if (s.dialogue.trim() && !s.performance?.length)
    throw new Error('长镜头对白需先填写表演时间窗，防止每段重复整句对白。');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min)
    throw new Error('供应商分段时长范围无效。');

  // Closed intervals of legal cut times, in milliseconds. Speech interiors
  // are excluded; the shared boundary of consecutive lines remains legal.
  type Interval = [number, number];
  const duration = Math.round(s.duration * 1000),
    minimum = Math.ceil(min * 1000),
    maximum = Math.floor(max * 1000);
  const lines = [...(s.performance ?? [])].sort((a, b) => a.start - b.start);
  const allowed: Interval[] = [];
  let cursor = 0;
  for (const line of lines) {
    if (
      !Number.isFinite(line.start) ||
      !Number.isFinite(line.end) ||
      line.start < 0 ||
      line.end <= line.start ||
      line.end > s.duration
    )
      throw new Error('长镜头表演时间窗须在镜头时长内，且结束晚于开始。');
    const start = Math.floor(line.start * 1000),
      end = Math.ceil(line.end * 1000);
    if (start >= cursor) allowed.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor <= duration) allowed.push([cursor, duration]);

  // Each layer is the set of endpoints reachable with exactly that many
  // requests. Keeping whole intervals lets an earlier cut move when needed,
  // instead of rejecting a valid plan after a locally convenient first cut.
  const layers: Interval[][] = [[[0, 0]]];
  for (let count = 1; count <= Math.floor(duration / minimum); count++) {
    const expanded: Interval[] = [];
    for (const [start, end] of layers[count - 1]) {
      const lo = start + minimum,
        hi = Math.min(duration, end + maximum);
      if (lo > hi) continue;
      const previous = expanded.at(-1);
      if (previous && lo <= previous[1] + 1)
        previous[1] = Math.max(previous[1], hi);
      else expanded.push([lo, hi]);
    }
    const reachable: Interval[] = [];
    let i = 0,
      k = 0;
    while (i < expanded.length && k < allowed.length) {
      const lo = Math.max(expanded[i][0], allowed[k][0]),
        hi = Math.min(expanded[i][1], allowed[k][1]);
      if (lo <= hi) reachable.push([lo, hi]);
      if (expanded[i][1] < allowed[k][1]) i++;
      else k++;
    }
    if (!reachable.length) break;
    layers.push(reachable);
    if (reachable.at(-1)![1] === duration) {
      const cuts = [duration];
      let end = duration;
      for (let level = count; level > 0; level--) {
        const target = (end * (level - 1)) / level;
        let chosen: number | undefined;
        for (const [lo, hi] of layers[level - 1]) {
          const start = Math.max(lo, end - maximum),
            finish = Math.min(hi, end - minimum);
          if (start > finish) continue;
          const candidate = Math.max(
            start,
            Math.min(finish, Math.round(target)),
          );
          if (
            chosen === undefined ||
            Math.abs(candidate - target) < Math.abs(chosen - target)
          )
            chosen = candidate;
        }
        // Reachability guarantees a predecessor for every selected endpoint.
        if (chosen === undefined) throw new Error('长镜头分段回溯失败。');
        cuts.unshift(chosen);
        end = chosen;
      }
      return cuts.slice(1).map((end, index) => ({
        start: cuts[index] / 1000,
        end: index === count - 1 ? s.duration : end / 1000,
        requestSeconds: Math.ceil((end - cuts[index]) / 1000),
      }));
    }
  }
  throw new Error(
    '无法在不截断对白的情况下分段，请缩短单句表演时间窗或将长句按停顿拆开。',
  );
}

export function takeProject(p: Project, job: Job, index: number): Project {
  const original = p.plan!.shots.find((s) => s.id === job.shotId)!;
  const part = job.longTake!.parts[index],
    last = index === job.longTake!.parts.length - 1;
  const point = (time: number) => {
    if (original.motion)
      return motionAt(original, time / original.duration).camera;
    const t = time / original.duration,
      u = original.camera.easing === 'ease-in-out' ? t * t * (3 - 2 * t) : t;
    return {
      x:
        original.camera.start.x +
        (original.camera.end.x - original.camera.start.x) * u,
      y:
        original.camera.start.y +
        (original.camera.end.y - original.camera.start.y) * u,
      z:
        original.camera.start.z +
        (original.camera.end.z - original.camera.start.z) * u,
    };
  };
  const trajectory = Array.from({ length: 5 }, (_, i) => {
    const time = part.start + ((part.end - part.start) * i) / 4;
    return {
      time: time - part.start,
      camera: point(time),
      ...(original.motion
        ? { subject: motionAt(original, time / original.duration).subject }
        : {}),
    };
  });
  const performance = (original.performance ?? [])
    .filter((l) => l.start >= part.start - 0.001 && l.end <= part.end + 0.001)
    .map((l) => ({
      ...l,
      start: Math.max(0, l.start - part.start),
      end: l.end - part.start,
    }));
  const tail = index ? job.longTake!.parts[index - 1].tailId : undefined;
  if (index && !tail)
    throw new Error('上一段尚未提取承接尾帧，不能生成下一段。');
  const shot: Shot = {
    ...original,
    duration:
      job.longTake!.provider === 'fal-kling'
        ? part.requestSeconds
        : part.end - part.start,
    motion: undefined,
    camera: {
      ...original.camera,
      start: point(part.start),
      end: point(part.end),
      easing: 'linear',
    },
    referenceUrl: tail
      ? '/api/studio-images/' + tail + '.png'
      : original.referenceUrl,
    videoInput: index
      ? {
          mode:
            last && original.videoInput?.mode === 'first_last'
              ? 'first_last'
              : 'first',
          ...(last ? { lastFrameUrl: original.videoInput?.lastFrameUrl } : {}),
        }
      : {
          ...original.videoInput,
          mode:
            original.videoInput?.mode === 'first_last'
              ? 'first'
              : (original.videoInput?.mode ?? 'first'),
        },
    description:
      original.description +
      '\n长镜头接续：仅演绎整镜 ' +
      part.start +
      '–' +
      part.end +
      ' 秒这一段，不从头重复事件、不提前完成后续动作。不切镜、不淡入淡出、不重新建立场景；沿用首帧姿态、衣着、持物、光线、轴线和移动方向；接缝不减速或停顿。整镜动作时间表：' +
      (original.intent?.actionTiming ??
        '请按连续事件进度承接，不能重演已发生动作。') +
      '；本段有效 ' +
      Number((part.end - part.start).toFixed(3)) +
      ' 秒，请求 ' +
      part.requestSeconds +
      ' 秒。若请求有取整余量，须在有效时长内到达本段终态（若提供目标尾帧，以该帧为准），随后保持状态，不新增对白或动作；不可把终态留到将被裁去的余量中。本段运镜采样（秒、米）：' +
      JSON.stringify(trajectory),
    startState: index
      ? {
          ...original.startState,
          pose: '严格承接输入尾帧中的实际姿态与位置，不恢复整镜起始姿态',
          wardrobe: '沿用输入尾帧实际服装、外观，不恢复此前状态',
          props: '沿用输入尾帧的实际持物、接触和位置；不得复原已发生的操作',
          light: '沿用输入尾帧的光源方向、曝光及色温，不重置照明',
        }
      : original.startState,
    endState: last
      ? original.endState
      : {
          ...original.startState,
          pose: '保持当前时间点动作进行中，不提前到达整镜结束状态；保留惯性便于下一段接续',
          wardrobe: '保持当前段实际服装，不提前采用整镜结尾造型',
          props: '按本段动作进度保持实际持物和接触，不提前完成后续操作',
          light: '延续本时间窗实际照明，不做淡出',
        },
    dialogue: performance.map((l) => l.text).join('\n'),
    performance,
    soundCues: (original.soundCues ?? [])
      .filter((c) => c.end > part.start && c.start < part.end)
      .map((c) => ({
        ...c,
        start: Math.max(0, c.start - part.start),
        end: Math.min(part.end, c.end) - part.start,
      })),
    sound:
      original.sound +
      '；本段不重复其他时间窗的台词，不重新起奏配乐，不在结尾淡出。',
  };
  return {
    ...p,
    plan: {
      ...p.plan!,
      shots: p.plan!.shots.map((s) => (s.id === shot.id ? shot : s)),
    },
  };
}

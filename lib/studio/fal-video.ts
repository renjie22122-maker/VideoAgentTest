import type { Project, Job } from './types.ts';
import { falCall, queueURL } from './fal.ts';
import { videoProfile, videoPreflight } from './video-profile.ts';
import { videoText } from './video-text.ts';
import { readImage } from './openai-images.ts';
export async function publicImage(url: string) {
  const match = /^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(
    url,
  );
  if (match)
    return (
      'data:image/' +
      (match[2] === 'jpg' ? 'jpeg' : match[2]) +
      ';base64,' +
      (await readImage(match[1], match[2])).toString('base64')
    );
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('参考图必须为本机已存图片或 HTTPS 地址。');
  return url;
}
export function prepareFalVideo(p: Project, j: Job, audio: boolean) {
  if (j.group)
    throw new Error(
      'Kling 适配当前仅支持单镜生成，请单独提交或切回 MiniMax 联合生成。',
    );
  const s = p.plan?.shots.find((s) => s.id === j.shotId);
  if (!s) throw new Error('镜头不存在。');
  if(!Number.isInteger(s.duration)||s.duration<3||s.duration>15)throw new Error('Kling 单次请求需要 3–15 整数秒；长镜头需通过串行调度提交。');
  const errors = videoPreflight(p, s, videoProfile({ provider: 'fal-kling' }));
  if (errors.length) throw new Error(errors.join(' '));
  const mode = s.videoInput?.mode ?? 'first';
  return {
    model:
      'fal-ai/kling-video/v3/pro/' +
      (mode === 'text' ? 'text-to-video' : 'image-to-video'),
    input: {
      prompt: videoText(p, s),
      duration: String(s.duration),
      generate_audio: audio,
      shot_type: 'customize',
      negative_prompt: p.plan?.bible.negative ?? '',
      ...(mode === 'text'
        ? { aspect_ratio: p.ratio }
        : {
            start_image_url: s.referenceUrl!,
            ...(mode === 'first_last'
              ? { end_image_url: s.videoInput!.lastFrameUrl! }
              : {}),
          }),
    },
  };
}
export async function submitFalVideo(
  p: Project,
  j: Job,
  audio: boolean,
  beforeSubmit?: () => Promise<void>,
) {
  const prepared = prepareFalVideo(p, j, audio);
  const input = prepared.input;
  if ('start_image_url' in input && input.start_image_url)
    input.start_image_url = await publicImage(input.start_image_url);
  if ('end_image_url' in input && input.end_image_url)
    input.end_image_url = await publicImage(input.end_image_url);
  const result = await falCall(
    'https://queue.fal.run/' + prepared.model,
    input,
    beforeSubmit,
  );
  if (typeof result.request_id !== 'string' || !result.request_id)
    throw new Error('fal 未返回任务编号，请核查调用记录，不能自动重复提交。');
  return (
    'fal-video:' +
    JSON.stringify({
      id: result.request_id,
      status: queueURL(result.status_url),
      result: queueURL(result.response_url),
    })
  );
}
export async function pollFalVideo(remoteId: string) {
  const task = JSON.parse(remoteId.slice('fal-video:'.length));
  const status = await falCall(queueURL(task.status));
  if (status.error)
    return {
      status: 'failed' as const,
      error: 'fal 视频任务失败，请查看供应商记录。',
    };
  if (['IN_QUEUE', 'IN_PROGRESS'].includes(String(status.status)))
    return { status: 'running' as const };
  if (status.status !== 'COMPLETED') throw new Error('fal 视频任务状态未知。');
  const result = await falCall(queueURL(task.result));
  const url = (result.video as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string' || !url.startsWith('https://'))
    throw new Error('fal 未返回有效视频，请核对原任务。');
  return { status: 'succeeded' as const, outputUrl: url };
}

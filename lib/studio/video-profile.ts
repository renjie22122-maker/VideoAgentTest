import {planLongTake} from './long-take.ts';
import {miniMaxTiming} from './render-timing.ts';
import type { Project, Shot } from './types.ts';
export type VideoProfile = {
  id: 'gateway' | 'minimax' | 'fal-kling';
  label: string;
  model: string;
  modes: NonNullable<Shot['videoInput']>['mode'][];
  minSeconds?: number;
  maxSeconds?: number;
  integerSeconds?: boolean;
  maxReferences?: number;
  nativeAudio: boolean;
  grouped: boolean;
  notes: string[];
};
export function videoProfile(values: {
  provider?: string;
  url?: string;
  model?: string;
}): VideoProfile {
  let native = false;
  try {
    native = ['api.minimax.io', 'api.minimaxi.com'].includes(
      new URL(values.url ?? '').hostname,
    );
  } catch {
    /* Unconfigured URL. */
  }
  if (values.provider === 'fal-kling')
    return {
      id: 'fal-kling',
      label: 'Kling 3.0 Pro · fal.ai',
      model: 'fal-ai/kling-video/v3/pro',
      modes: ['text', 'first', 'first_last'],
      minSeconds: 3,
      maxSeconds: 15,
      integerSeconds: true,
      nativeAudio: true,
      grouped: false,
      notes: [
        '支持文字、首帧与首尾帧；本适配尚未实现美术元素参考及联合生成。',
        '原生语音支持中文和英文；其他语言应使用独立配音。',
      ],
    };
  if (values.provider === 'minimax' || (!values.provider && native)) {
    const max = values.model === 'MiniMax-H3-Max';
    return {
      id: 'minimax',
      label: 'MiniMax 原生',
      model: values.model ?? '',
      modes: max
        ? ['text', 'first', 'first_last']
        : ['text', 'references', 'first', 'first_last'],
      minSeconds: max ? 5 : 4,
      maxSeconds: 15,
      integerSeconds: true,
      maxReferences: max ? 0 : 9,
      nativeAudio: true,
      grouped: !max,
      notes: ['精确路径、角色一致性和声音实现仍需审片确认。'],
    };
  }
  return {
    id: 'gateway',
    label: '自建媒体网关',
    model: values.model ?? '',
    modes: ['first'],
    nativeAudio: false,
    grouped: false,
    notes: [
      '当前网关合同只开放首帧模式；更多输入能力需网关实现后再启用，不假设任意地址都兼容。',
    ],
  };
}
export function videoPreflight(
  p: Project,
  s: Shot,
  profile: VideoProfile,
): string[] {
  if (p.mode === 'demo') return [];
  const errors: string[] = [];
  const mode = s.videoInput?.mode ?? 'first';
  if (!profile.modes.includes(mode))
    errors.push(
      profile.label +
        ' 不支持当前输入方式，请选择 ' +
        profile.modes
          .map(
            (m) =>
              ({
                text: '纯文字',
                first: '首帧',
                first_last: '首尾帧',
                references: '美术参考图',
              })[m],
          )
          .join(' / ') +
        '。',
    );
  const long=!!profile.maxSeconds&&s.duration>profile.maxSeconds;
  if(long){try{planLongTake(s,profile.minSeconds,profile.maxSeconds);}catch(e){errors.push(e instanceof Error?e.message:'长镜头分段无效。');}}
  else if(profile.id==='minimax'){try{miniMaxTiming(s.duration,profile.model);}catch(e){errors.push(e instanceof Error?e.message:'时长无效。');}}
  else if (
    profile.minSeconds !== undefined &&
    (s.duration < profile.minSeconds ||
      s.duration > (profile.maxSeconds ?? Infinity) ||
      (profile.integerSeconds && !Number.isInteger(s.duration)))
  )
    errors.push(
      profile.label +
        ' 需要 ' +
        profile.minSeconds +
        '–' +
        profile.maxSeconds +
        ' 整数秒；当前 ' +
        s.duration +
        ' 秒。请调整时长或使用支持该时长的服务。',
    );
  if (
    profile.id === 'minimax' &&
    !['MiniMax-H3', 'MiniMax-H3-Max'].includes(profile.model)
  )
    errors.push('请选择已适配的 MiniMax-H3 / MiniMax-H3-Max 视频模型。');
  if ((mode === 'first' || mode === 'first_last') && !s.referenceUrl)
    errors.push('本镜缺少首帧；可上传、生成或改为纯文字。');
  if (mode === 'first_last' && !s.videoInput?.lastFrameUrl)
    errors.push('本镜缺少尾帧。');
  if (mode === 'references') {
    const ids = s.videoInput?.assetIds ?? [];
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      (profile.maxReferences !== undefined &&
        ids.length > profile.maxReferences)
    )
      errors.push('请选择数量符合模型要求且不重复的已批准美术图。');
    if (
      ids.some(
        (id) =>
          !p.production?.library?.some(
            (a) =>
              a.id === id &&
              a.approved &&
              !a.retired &&
              a.status === 'ready' &&
              a.url,
          ),
      )
    )
      errors.push('所选参考资产未批准或已失效。');
  }
  return errors;
}

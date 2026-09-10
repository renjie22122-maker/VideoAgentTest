'use client';
import { useState } from 'react';
import { studioRequest } from '@/lib/studio/client';
import type { Project, Shot } from '@/lib/studio/types';
import type { VideoProfile } from '@/lib/studio/video-profile';
import { Button } from './ui/button';
type Preview = {
  timing?:import('@/lib/studio/render-timing').RenderTiming;
  profile: VideoProfile;
  issues: string[];
  prompt?: string;
  configured: boolean;
  note: string;
};
export function VideoPreflight({
  project,
  shot,
  disabled,
}: {
  project: Project;
  shot: Shot;
  disabled: boolean;
}) {
  const [result, setResult] = useState<Preview | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  async function inspect() {
    setLoading(true);
    setError('');
    try {
      setResult(
        (await studioRequest('video_preview', {
          id: project.id,
          shotId: shot.id,
        })) as Preview,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '预检失败');
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="asset-prompt-card">
      <Button
        variant="outline"
        disabled={disabled || loading}
        onClick={() => void inspect()}
      >
        {loading ? '检查中…' : '生成前检查 / 查看视频提示词（不调用模型）'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>
            {result.profile.label} · {result.profile.model} ·{' '}
            {result.configured ? '已配置，尚需真实调用验证' : '未配置完整'}
          </p>
          {result.issues.length ? (
            result.issues.map((issue, i) => (
              <p key={i} role="alert">
                {issue}
              </p>
            ))
          ) : (
            <p>输入检查通过，可按当前模式提交；这不是画面质量结论。</p>
          )}
          {result.profile.notes.map((note) => (
            <p className="help" key={note}>
              {note}
            </p>
          ))}
          {result.timing&&result.timing.tailSeconds>0&&<p>剪辑时长 {result.timing.editSeconds} 秒 → 模型生成 {result.timing.requestSeconds} 秒。保留前 {result.timing.trimEnd} 秒，尾部 {result.timing.tailSeconds} 秒为裁切余量；生成可能按 {result.timing.requestSeconds} 秒计费。不会修改分镜总时长，实际动作与对白仍需审片核对。</p>}
          {result.prompt && (
            <details>
              <summary>
                本镜实际视频提示词 · {result.prompt.length} 字符
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {result.prompt}
              </pre>
            </details>
          )}
          <p className="help">{result.note}</p>
        </>
      )}
    </section>
  );
}

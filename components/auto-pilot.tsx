'use client';
import { useEffect, useState } from 'react';
import type { Project } from '@/lib/studio/types';
import { Button } from './ui/button';
export function AutoPilot({
  project,
  busy,
  act,
}: {
  project: Project;
  busy: boolean;
  act: (action: string, data?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [notes, setNotes] = useState(
    '检查当前制作方案，自动修正有证据的文本问题，不改变创意、已确认对白和时长。',
  );
  const run = project.production?.autoRun;
  useEffect(() => {
    if (busy || run?.status !== 'running') return;
    const timer = setTimeout(() => void act('auto_step'), 1500);
    return () => clearTimeout(timer);
  }, [busy, run?.status, run?.steps, project.revision, act]);
  return (
    <section className="asset-prompt-card">
      <h3>总 Agent 自动协作</h3>
      <label>
        本次任务
        <textarea
          disabled={busy || run?.status === 'running'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <p>
        总 Agent 每步选择岗位和任务，子 Agent
        可会审、修改分镜、生成剧本或资产设计候选。最多 4 步，约最多 8
        次语言模型调用；图片和视频不会自动生成。保持本页面打开以推进任务，离开页面暂停推进。停止按钮在当前步骤完成后可用。
      </p>
      <Button
        disabled={busy || run?.status === 'running' || !notes.trim()}
        onClick={() => void act('auto_start', { notes })}
      >
        开始自动协作{project.mode === 'live' ? '（语言模型计费）' : '（演示）'}
      </Button>
      <Button
        disabled={busy || run?.status !== 'running'}
        variant="outline"
        onClick={() => void act('auto_stop')}
      >
        停止后续步骤
      </Button>
      {run && (
        <>
          <p>
            状态：
            {
              {
                running: '运行中',
                completed: '已结束',
                stopped: '已停止',
                failed: '失败，未应用该步修改',
              }[run.status]
            }{' '}
            · {run.steps} / {run.maxSteps} 步
          </p>
          {run.error && <p role="alert">{run.error}</p>}
          {run.log.map((entry, i) => (
            <p key={i}>
              {i + 1}. {entry.role} · {entry.action}：{entry.message}
            </p>
          ))}
        </>
      )}
      <p className="help">
        改动前的完整作品备份存于本地
        .studio/auto-backups。自动修改剧本后需重新确认；分镜修改后下游素材失效。报告与建议不等于实际画面质量已通过。
      </p>
    </section>
  );
}

'use client';
import { useState } from 'react';
import { ProductionHandoff } from './production-handoff';
import type { NodeId, Project } from '@/lib/studio/types';
import { Button } from './ui/button';
export function AutoPilot({
  project,
  busy,
  act,
  onOpenStage,
}: {
  project: Project;
  busy: boolean;
  act: (
    action: string,
    data?: Record<string, unknown>,
    navigate?: boolean,
  ) => Promise<unknown>;
  onOpenStage: (stage: NodeId) => void;
}) {
  const [notes, setNotes] = useState(
    '检查当前制作方案，自动修正有证据的文本问题，不改变创意、已确认对白和时长。',
  );
  const [maxSteps, setMaxSteps] = useState(4);
  const run = project.production?.autoRun;
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
        可会审、修改分镜、生成剧本或资产设计候选。最多 {maxSteps} 步，约最多{' '}
        {maxSteps * 2}
        次语言模型调用；图片和视频不会自动生成。保持本页面打开以推进任务，关闭工作台暂停推进；切换工作台内页面可继续。停止按钮在当前步骤完成后可用。
      </p>
      <label>
        本轮协作预算
        <select
          disabled={busy || run?.status === 'running'}
          value={maxSteps}
          onChange={(e) => setMaxSteps(Number(e.target.value))}
        >
          <option value={4}>4 步 · 约最多 8 次模型调用</option>
          <option value={8}>8 步 · 约最多 16 次模型调用</option>
          <option value={12}>12 步 · 约最多 24 次模型调用</option>
        </select>
      </label>
      <Button
        disabled={busy || run?.status === 'running' || !notes.trim()}
        onClick={() => void act('auto_start', { notes, maxSteps })}
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
                completed: '本轮文本任务已完成',
                waiting_user: '等待你处理',
                budget_exhausted: '本轮预算已用完',
                stopped: '已停止',
                failed: '失败，未应用该步修改',
              }[run.status]
            }{' '}
            · {run.steps} / {run.maxSteps} 步
          </p>
          {run.summary && <output>{run.summary}</output>}
          {run.error && <p role="alert">{run.error}</p>}
          {run.status !== 'running' && (
            <ProductionHandoff
              key={project.id + ':' + project.revision}
              project={project}
              maxSteps={maxSteps}
              busy={busy}
              act={act}
              onOpenStage={onOpenStage}
            />
          )}
          {run.log.map((entry, i) => (
            <p key={i}>
              {i + 1}. {entry.role} · {entry.action}：
              {entry.action === 'stop' &&
              i === run.log.length - 1 &&
              run.summary
                ? run.summary
                : entry.message}
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

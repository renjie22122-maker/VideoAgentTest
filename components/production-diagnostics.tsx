'use client';
import { useMemo, useState } from 'react';
import { buildQualityReport } from '@/lib/studio/quality-report';
import type { QualityStrictness } from '@/lib/studio/quality-report';
import type { Project } from '@/lib/studio/types';
import { filmTeam } from '@/lib/studio/team';
import { Button } from './ui/button';
import { WorkspaceLink } from './ui/workspace-link';
export function ProductionDiagnostics({
  project,
  busy,
  onShot,
  act,
}: {
  project: Project;
  busy: boolean;
  onShot: (id: string) => void;
  act: (action: string, data?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [strictness, setStrictness] = useState<QualityStrictness>('standard'),
    [selected, setSelected] = useState<string[]>([]);
  const report = useMemo(
    () => buildQualityReport(project, { strictness }),
    [project, strictness],
  );
  const run = project.production?.autoRun;
  const actionable = report.findings.filter(
    (f) => f.owner !== 'writer' && f.shotIds.length && f.severity !== 'info',
  );
  const chosen = selected.filter((id) => actionable.some((f) => f.id === id));
  return (
    <details className="panel" open={undefined}>
      <summary>
        <strong>制作诊断</strong> · {report.blockingCount} 项确定问题 ·{' '}
        {report.warningCount} 项待复核 ·{' '}
        {report.coverage.shots
          ? `${report.coverage.plannedShots}/${report.coverage.shots} 镜已有设计依据`
          : '尚未生成分镜'}
      </summary>
      <p>
        这里检查文字方案与引用，不评价尚未生成的画面。每个问题带有依据、负责岗位和下一步建议。
      </p>
      <label>
        检查深度
        <select
          value={strictness}
          onChange={(e) => setStrictness(e.target.value as QualityStrictness)}
        >
          <option value="compatible">兼容旧作品 · 少提示缺失资料</option>
          <option value="standard">标准 · 优先确定错误</option>
          <option value="strict">深入 · 补查设计资料</option>
        </select>
      </label>
      <div className="queue-actions">
        <Button
          variant="outline"
          disabled={!actionable.length}
          onClick={() => setSelected(actionable.slice(0, 20).map((f) => f.id))}
        >
          选择可修订问题（最多 20 项）
        </Button>
        <Button
          disabled={
            busy ||
            !chosen.length ||
            project.mode === 'demo' ||
            !project.production?.scriptApproved ||
            run?.status === 'running'
          }
          onClick={() => void act('quality_fix', { findingIds: chosen })}
        >
          修订所选问题并复核（语言模型计费，不生成媒体）
        </Button>
      </div>
      <p className="help">
        两步：分镜导演修订 →
        另一岗位复核。修改前备份，保持已确认剧情和对白；成功后旧素材及生成批准失效。剧本原文问题请先返回剧本修改。
      </p>
      {report.findings.length ? (
        report.findings.map((f) => (
          <details key={f.id} className="asset-prompt-card">
            <summary>
              {actionable.some((a) => a.id === f.id) && (
                <input
                  aria-label={'选择 ' + f.message}
                  type="checkbox"
                  disabled={
                    busy || (!chosen.includes(f.id) && chosen.length >= 20)
                  }
                  checked={chosen.includes(f.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...chosen, f.id]
                        : chosen.filter((id) => id !== f.id),
                    )
                  }
                />
              )}{' '}
              {
                (
                  {
                    error: '需修正',
                    warning: '待复核',
                    info: '资料提示',
                  } as const
                )[f.severity]
              }{' '}
              · {f.message}
            </summary>
            <p>
              负责：{filmTeam.find((r) => r.id === f.owner)?.name ?? f.owner} ·{' '}
              {f.shotIds.join('、') || f.sceneId || '全局'}
            </p>
            <p>依据：{f.evidence}</p>
            <p>建议：{f.suggestion}</p>
            {f.shotIds.map((id) => (
              <WorkspaceLink key={id} href={'#'+id} onNavigate={() => onShot(id)}>
                查看 {id}
              </WorkspaceLink>
            ))}
          </details>
        ))
      ) : (
        <p>
          {report.coverage.shots
            ? '当前规则未发现问题，仍需导演内容评审与真实素材审片。'
            : '生成分镜后将自动检查镜头设计与衔接；目前没有镜头可供检查，不代表制作质量已通过。'}
        </p>
      )}
      {run && (
        <output>
          自动协作：
          {run.summary ??
            (
              {
                running: '运行中',
                completed: '本轮已结束',
                waiting_user: '等待确认',
                budget_exhausted: '预算已用完',
                failed: '本步失败',
                stopped: '已停止',
              } as const
            )[run.status]}{' '}
          · {run.steps}/{run.maxSteps} 步
        </output>
      )}
      {run?.status === 'running' && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act('auto_stop')}
        >
          停止后续协作
        </Button>
      )}
      {report.limitations.map((l) => (
        <p key={l} className="help">
          {l}
        </p>
      ))}
    </details>
  );
}

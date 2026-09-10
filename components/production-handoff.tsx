'use client';
import { useState } from 'react';
import type { NodeId, Project } from '@/lib/studio/types';
import { currentAutoFindings } from '@/lib/studio/auto-run-state';
import { checkContinuity } from '@/lib/studio/domain';
import { Button } from './ui/button';

export function ProductionHandoff({
  project,
  busy,
  act,
  onOpenStage,
  maxSteps = 4,
}: {
  project: Project;
  busy: boolean;
  act: (
    action: string,
    data?: Record<string, unknown>,
    navigate?: boolean,
  ) => Promise<unknown>;
  onOpenStage: (stage: NodeId) => void;
  maxSteps?: number;
}) {
  const [feedback, setFeedback] = useState('');
  const g = project.production;
  if (!g) return null;
  const currentReview = g.continuityReview?.revision === project.revision;
  const errors = project.plan
    ? checkContinuity(project.plan, project.duration).filter(
        (f) => f.level === 'error',
      )
    : [];
  const findings = [
    ...currentAutoFindings(project),
    ...(currentReview ? g.continuityReview!.findings : []),
  ];
  const disabled =
    busy ||
    g.autoRun?.status === 'running' ||
    project.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const fee = project.mode === 'live' ? '（语言模型计费）' : '（演示）';
  return (
    <section className="semantic-review" aria-label="生成前的下一步">
      <h4>下一步 · 生成前确认</h4>
      {findings.length > 0 && (
        <details open>
          <summary>当前版本仍有 {findings.length} 项文字意见，请先复核</summary>
          {findings.map((f, i) => (
            <div className="issue" key={i}>
              <div>
                <strong>{f.shotId || '全局'}</strong>
                <p>{f.evidence}</p>
                <p>建议：{f.suggestion}</p>
              </div>
            </div>
          ))}
        </details>
      )}
      {['storyboard', 'continuity', 'prompts'].includes(g.node) && (
        <div className="asset-prompt-card">
          <label>
            我的处理意见（可选）
            <textarea
              value={feedback}
              maxLength={1200}
              disabled={disabled}
              placeholder="例如：shot-15 起始时长刀仍握在手中，再执行甩刀；shot-12 保留剧本中的跑车与红发女人，不改成抽象记忆。也可以注明某条建议不采纳，并说明原因。"
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <Button
            disabled={disabled || (!feedback.trim() && !findings.length)}
            onClick={() =>
              void act('auto_start', {
                notes:
                  '继续处理当前版本的未解决文本问题，逐项对照 unresolvedTextFindings。用户处理意见：\n' +
                  (feedback.trim() || '按当前审查证据继续修订。') +
                  '\n先判断用户意见与已确认剧本是否一致，再选择修订岗位执行；不要只出建议。修订后必须由独立岗位复核。保留已确认剧本、对白和时长，不得用删掉或抽象化已确认动作来消除资产问题。若意见需要修改剧本，生成待确认的剧本候选并停止，不得擅自批准；若不能执行，请明确解释冲突和需要用户裁决的选项。用户认为误报的意见也须结合当前证据复核，不直接伪造通过结论。',
                maxSteps,
              })
            }
          >
            {feedback.trim() ? '按我的意见继续修订' : '继续修订剩余问题'}
            {fee}
          </Button>
          <p className="help">
            开始新一轮最多 {maxSteps}{' '}
            步的文本协作，修改后再次会审；不会生成图片或视频。上一轮协作记录会完整备份。
          </p>
        </div>
      )}
      {errors.map((f, i) => (
        <p role="alert" key={i}>
          {f.shotId}：{f.message}
        </p>
      ))}
      {['clarify', 'script', 'assets'].includes(g.node) && (
        <>
          <p>
            请先确认
            {g.node === 'assets'
              ? '美术资产'
              : g.node === 'script'
                ? '剧本'
                : '创意要求'}
            ，再继续分镜与生成准备。
          </p>
          <Button
            disabled={disabled}
            variant="outline"
            onClick={() => onOpenStage(g.node)}
          >
            前往当前确认步骤
          </Button>
        </>
      )}
      {['storyboard', 'continuity'].includes(g.node) && (
        <>
          <p>
            {currentReview
              ? '请复核场记意见。按当前分镜继续后会编译提示词，再由你批准进入生成。'
              : '当前还在分镜检查阶段。部门会审不会自动完成场记确认；请先运行本版场记检查，再编译提示词。'}
          </p>
          <div className="queue-actions">
            <Button
              disabled={disabled || (currentReview && errors.length > 0)}
              onClick={() =>
                void act(
                  currentReview ? 'compile' : 'continuity_review',
                  {},
                  true,
                )
              }
            >
              {currentReview
                ? '复核后按当前分镜编译提示词'
                : '运行当前版本场记检查'}
              {fee}
            </Button>
            <Button
              disabled={disabled}
              variant="outline"
              onClick={() => onOpenStage('storyboard')}
            >
              查看并修改分镜
            </Button>
          </div>
          <p className="help">
            检查和编译不会生成图片或视频。批准按钮会在提示词编译完成后显示。
          </p>
        </>
      )}
      {g.node === 'prompts' && (
        <>
          <p>
            提示词已编译。打开提示词页，检查后点击“批准当前版本，进入生成”。
          </p>
          <Button disabled={disabled} onClick={() => onOpenStage('prompts')}>
            查看提示词并批准生成
          </Button>
          <p className="help">批准仅解锁生成入口；生成哪些镜头仍由你选择。</p>
        </>
      )}
      {['generation', 'qa', 'assembly', 'complete'].includes(g.node) && (
        <>
          <p>
            当前已进入
            {g.node === 'generation'
              ? '生成阶段，可选择单镜或批量生成'
              : '生成后的审片与组装阶段'}
            。
          </p>
          <Button disabled={busy} onClick={() => onOpenStage(g.node)}>
            前往
            {g.node === 'generation' || g.node === 'qa'
              ? '生成与审片'
              : '后期与组装'}
          </Button>
        </>
      )}
    </section>
  );
}

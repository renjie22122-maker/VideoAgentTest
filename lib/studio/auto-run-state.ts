import type { Project } from './types.ts';

export const autoActions = ['review', 'revise_shots', 'write_script', 'design_assets', 'stop'] as const;
export type AutoAction = (typeof autoActions)[number];
export type AutoStopReason = 'completed' | 'script_approval' | 'asset_approval' | 'review_required' | 'unresolved_findings' | 'no_progress' | 'budget_exhausted' | 'user_stop' | 'failed';
export type AutoLogEntry = {
  at: number;
  role: string;
  action: string;
  message: string;
  /** The supervisor suggestion; the displayed outcome is verified by the state machine. */
  modelReason?: string;
  roleId?: string;
  outcome?: 'reviewed' | 'modified' | 'candidate_created' | 'unchanged' | 'stopped';
  revisionBefore?: number;
  revisionAfter?: number;
  inputFingerprint?: string;
  outputFingerprint?: string;
  artifactIds?: string[];
};
export type PendingAutoReview = {
  revision: number;
  authorRoleId: string;
  reason: string;
  previousFindings: { shotId: string; evidence: string; suggestion: string }[];
};
export type AutoRun = {
  /** Missing only in saved runs from versions before step-token protection. */
  id?: string;
  status: 'running' | 'completed' | 'waiting_user' | 'budget_exhausted' | 'stopped' | 'failed';
  steps: number;
  maxSteps: number;
  instruction: string;
  log: AutoLogEntry[];
  error?: string;
  stopReason?: AutoStopReason;
  summary?: string;
  pendingReview?: PendingAutoReview;
  /** First-class task trail; runs saved before the task model simply have none. */
  tasks?: import('./agent/task.ts').AgentTask[];
};

export const autoTaskContracts = [
  { action: 'review', output: '当前版本文本会审报告', mutatesContent: false, approval: '不代表实际画面通过' },
  { action: 'revise_shots', output: '保留已确认剧本的完整分镜', mutatesContent: true, approval: '后续必须由另一岗位复核，之后仍需用户批准生成' },
  { action: 'write_script', output: '未确认的完整剧本', mutatesContent: true, approval: '停止并等待用户确认剧本' },
  { action: 'design_assets', output: '未批准的文字设计候选', mutatesContent: true, approval: '所有文字候选均可稍后选择；缺少不可或缺主图仅阻断相关媒体生成，不停止文字协作。不替换批准版本，不生成图片' },
  { action: 'stop', output: '停止理由和剩余事项', mutatesContent: false, approval: '存在未复核修改或未解决问题时不能标为成功' },
] as const;

export function createAutoRun(p: Project, instruction: string, maxSteps = 4): AutoRun {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new Error('自动协作步数须为 1–12。');
  const previous = p.production?.autoRun?.pendingReview;
  return {
    id: globalThis.crypto.randomUUID(), status: 'running', steps: 0, maxSteps, instruction, log: [],
    ...(previous?.revision === p.revision ? { pendingReview: structuredClone(previous) } : {}),
  };
}

/**
 * Check under the server mutation lock, before any backup, model call or write.
 * A duplicate request returns the committed run for reconciliation, without advancing it.
 * This is a persisted-step guard, not a provider retry or permission to replay an uncertain call.
 */
export function validateAutoStep(run: AutoRun | undefined, expectedRunId: unknown, expectedStep: unknown): 'execute' | 'refresh' {
  if (!run) throw new Error('自动任务未启动，请重新打开作品后开始协作。');
  if (!run.id) throw new Error('此自动任务来自旧版本，尚无步骤保护标识。请先停止，再重新开始协作。');
  if (typeof expectedRunId !== 'string' || !expectedRunId || !Number.isInteger(expectedStep) || Number(expectedStep) < 0) {
    throw new Error('自动步骤缺少有效的任务标识或步数，请刷新工作台后继续。');
  }
  if (expectedRunId !== run.id) throw new Error('自动任务已更换，旧页面不能推进新任务。请重新打开作品。');
  if (Number(expectedStep) > run.steps) throw new Error('自动步骤超前于已保存进度，请重新打开作品核对状态。');
  if (Number(expectedStep) < run.steps || run.status !== 'running') return 'refresh';
  return 'execute';
}

export function currentAutoFindings(p: Project) {
  const configRevision = p.production?.agentConfigRevision ?? 0;
  return (p.production?.teamReports ?? [])
    .filter(r => r.revision === p.revision && (r.configRevision ?? 0) === configRevision)
    .flatMap(r => r.findings.filter(f => f.severity !== 'note'));
}

export function stopAutoRun(run: AutoRun) {
  run.status = 'stopped';
  run.stopReason = 'user_stop';
  run.summary = run.pendingReview ? '已停止后续任务；已修改的分镜仍需文本复核。' : '用户已停止后续任务，已完成的步骤保留。';
}

export function failAutoRun(run: AutoRun, error: unknown) {
  run.status = 'failed';
  run.stopReason = 'failed';
  run.error = error instanceof Error ? error.message : '自动任务失败';
  run.summary = '本步失败，未应用本步修改；此前已保存的步骤保留。';
}

export function exhaustAutoRun(run: AutoRun) {
  run.status = 'budget_exhausted';
  run.stopReason = run.pendingReview ? 'review_required' : 'budget_exhausted';
  run.summary = run.pendingReview
    ? '本轮步数已用完，分镜已修改但尚未完成独立文本复核。继续协作将先复核，不会重复修改。'
    : '本轮步数已用完，尚未形成完成结论。可查看报告后继续一轮协作。';
}

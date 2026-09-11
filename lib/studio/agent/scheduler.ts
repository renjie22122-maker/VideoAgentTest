import type { AgentDefinition } from '../team-config.ts';
import type { AutoRun } from '../auto-run-state.ts';
import type { AgentTask } from './task.ts';
import type { AutoDecision } from './planner.ts';
import { selectVerifier } from './router.ts';

/**
 * Task Scheduler (sequential kernel). The agent loop serves tasks: before
 * asking the LLM what to do next, the runtime checks whether a pre-planned
 * task has become runnable. Today the only pre-planned task kind is
 * verify_storyboard; the planner still plans the rest.
 *
 * Readiness semantics are strict: every dependency must EXIST and be
 * completed. A missing or non-completed dependency blocks the task — being
 * lenient here would let truncated or buggy task graphs run ahead of their
 * prerequisites.
 */
export type ScheduledDecision = { task: AgentTask; decision: AutoDecision };

export function blockedReason(task: AgentTask, tasks: readonly AgentTask[]): string | undefined {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of task.dependsOn) {
    const dependency = byId.get(id);
    if (!dependency) return '依赖任务不存在：' + id;
    if (dependency.status !== 'completed')
      return '依赖任务未完成：' + id + '（' + dependency.status + '）';
  }
  return undefined;
}

export function runnableTasks(run: AutoRun): AgentTask[] {
  const tasks = run.tasks ?? [];
  return tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'verification') &&
      blockedReason(t, tasks) === undefined,
  );
}

export function nextScheduledTask(
  run: AutoRun,
  roles: readonly AgentDefinition[],
): ScheduledDecision | undefined {
  const runnable = runnableTasks(run).find((t) => t.kind === 'verify_storyboard');
  if (!runnable) return undefined;
  const reviewer = selectVerifier(roles, runnable.verification?.authorRoleId ?? '');
  if (!reviewer) return undefined;
  return {
    task: runnable,
    decision: {
      roleId: reviewer.id,
      action: 'review',
      reason:
        '复核上一轮分镜修改，逐项核对原问题是否解决及是否引入新问题；仅评估当前版本文本。',
    },
  };
}

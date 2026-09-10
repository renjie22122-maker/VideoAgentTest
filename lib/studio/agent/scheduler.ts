import type { AgentDefinition } from '../team-config.ts';
import type { AutoRun } from '../auto-run-state.ts';
import type { AgentTask } from './task.ts';
import type { AutoDecision } from './planner.ts';
import { selectVerifier } from './router.ts';

/**
 * Task Scheduler (sequential kernel). The agent loop serves tasks: before
 * asking the LLM what to do next, the runtime checks whether a pre-planned
 * task has become runnable — dependencies satisfied, verification pending.
 * Today the only pre-planned task kind is verify_storyboard; the planner
 * still plans the rest, and dependsOn is the readiness criterion the
 * scheduler already enforces.
 */
export type ScheduledDecision = { task: AgentTask; decision: AutoDecision };

export function runnableTasks(run: AutoRun): AgentTask[] {
  const tasks = run.tasks ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'verification') &&
      t.dependsOn.every((id) => {
        const dependency = byId.get(id);
        return !dependency || dependency.status === 'completed' || dependency.status === 'cancelled';
      }),
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

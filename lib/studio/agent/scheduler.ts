import type { AgentDefinition } from '../team-config.ts';
import type { AutoRun } from '../auto-run-state.ts';
import type { AgentTask } from './task.ts';
import { actionForTaskKind } from './task.ts';
import type { AutoDecision } from './planner.ts';
import { routeCapability, selectVerifier } from './router.ts';
import { getAgentAction } from './actions/registry.ts';
import { capabilitiesForRole, satisfiesCapabilityRequirement } from './capabilities.ts';

/**
 * Task Scheduler (sequential kernel). The agent loop serves tasks: before
 * asking the LLM what to do next, the runtime checks whether any pre-planned
 * task has become runnable. The planner still proposes new work, but its
 * follow-up plans and the verification gate run purely through this
 * scheduler — dependencies decide, not another LLM call.
 *
 * Readiness semantics are strict: every dependency must EXIST and be
 * completed. A missing or non-completed dependency blocks the task.
 *
 * The scheduler returns a discriminated result so the runtime can never
 * mistake "nothing to do" for "work exists but must not run yet":
 *
 *   ready   → execute this task now
 *   blocked → a task exists but its dependencies forbid it; do NOT replan
 *   waiting → a runnable task has no eligible agent; wait for the user
 *   idle    → no pre-planned work; the planner may propose new work
 */
export type SchedulerResult =
  | { kind: 'ready'; task: AgentTask; decision: AutoDecision }
  | { kind: 'blocked'; task: AgentTask; reason: string }
  | { kind: 'waiting'; task: AgentTask; reason: string }
  | { kind: 'idle' };

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

/** Turn a runnable task into a decision: verify routes a verifier; others prefer the owner role, then route by capability. */
export function decisionForTask(
  task: AgentTask,
  roles: readonly AgentDefinition[],
): AutoDecision | undefined {
  if (task.kind === 'verify_storyboard') {
    const reviewer = selectVerifier(roles, task.verification?.authorRoleId ?? '');
    if (!reviewer) return undefined;
    return {
      roleId: reviewer.id,
      action: 'review',
      reason:
        '复核上一轮分镜修改，逐项核对原问题是否解决及是否引入新问题；仅评估当前版本文本。',
      targets: task.targetShotIds,
    };
  }
  const action = actionForTaskKind[task.kind];
  if (!action) return undefined;
  let role = task.ownerRoleId
    ? roles.find((r) => r.id === task.ownerRoleId)
    : undefined;
  if (!role && task.capability) role = routeCapability(roles, task.capability);
  if (!role) {
    // Plan entries may omit roleId: route by the action's full capability
    // requirement (anyOf/allOf) instead of a drift-prone single-capability map.
    const requirement = getAgentAction(action).capabilityRequirement;
    role = roles.find((r) =>
      satisfiesCapabilityRequirement(capabilitiesForRole(r.id, roles), requirement),
    );
  }
  if (!role) return undefined;
  return { roleId: role.id, action, reason: task.reason, targets: task.targetShotIds };
}

export function nextScheduledTask(
  run: AutoRun,
  roles: readonly AgentDefinition[],
): SchedulerResult {
  const tasks = run.tasks ?? [];
  const open = tasks.filter((t) => t.status === 'pending' || t.status === 'verification');
  // The open verification gate always has priority over other planned work.
  open.sort((a, b) => (a.kind === 'verify_storyboard' ? -1 : b.kind === 'verify_storyboard' ? 1 : 0));
  for (const task of open) {
    const blocked = blockedReason(task, tasks);
    if (blocked) return { kind: 'blocked', task, reason: blocked };
    const decision = decisionForTask(task, roles);
    if (!decision)
      return { kind: 'waiting', task, reason: '缺少具备所需能力的已启用岗位。' };
    return { kind: 'ready', task, decision };
  }
  return { kind: 'idle' };
}

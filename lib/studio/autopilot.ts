import { projectAgents } from './team-config.ts';
import { exhaustAutoRun } from './auto-run-state.ts';
import type { Project } from './types.ts';
import { buildObservation } from './agent/observation.ts';
import { planDecision } from './agent/planner.ts';
import type { AutoDecision, PlanOutcome } from './agent/planner.ts';
import { evaluateAutoDecision } from './agent/policy.ts';
import { beginStep, finishStep } from './agent/run-controller.ts';
import { syncVerificationTask, materializeDecisionTask, materializePlanTasks, reconcileRunTasks, persistTaskRecord } from './agent/task.ts';
import type { AgentTask } from './agent/task.ts';
import { executeReviewBatch } from './agent/batch.ts';
import { getAgentAction, registeredAgentActions, describeAllowedActions } from './agent/actions/registry.ts';
import { nextScheduledTask } from './agent/scheduler.ts';
import { buildQualityReport } from './quality-report.ts';

// Backward-compatible surface: run state primitives keep living here for callers
// (server commands, tests, and the Project type's AutoRun reference).
export { autoActions, createAutoRun, stopAutoRun, failAutoRun } from './auto-run-state.ts';
export type { AutoRun } from './auto-run-state.ts';
export type { AutoDecision } from './agent/planner.ts';
export { validateAutoDecision, planDecision } from './agent/planner.ts';
export { evaluateAutoDecision, assertAutoDecision } from './agent/policy.ts';
export type { PolicyVerdict, PolicyViolation } from './agent/policy.ts';
export { buildObservation, unresolvedFindings } from './agent/observation.ts';
export { getAgentAction, registeredAgentActions, agentActions, describeAllowedActions } from './agent/actions/registry.ts';
export { beginStep, finishStep } from './agent/run-controller.ts';
export { syncVerificationTask, openVerificationTask, taskKindForAction, actionForTaskKind, materializeDecisionTask, materializePlanTasks, reconcileRunTasks, persistTaskRecord } from './agent/task.ts';
export type { AgentTask, AgentTaskKind, AgentTaskStatus, AgentTaskResult } from './agent/task.ts';
export { capabilityForDecision, capabilitiesForRole, defaultRoleCapabilities, capabilityLabels, grantedCapabilities, satisfiesCapabilityRequirement } from './agent/capabilities.ts';
export type { CapabilityId, CapabilityHolder } from './agent/capabilities.ts';
export { routeCapability, selectVerifier } from './agent/router.ts';
export { nextScheduledTask, runnableTasks, blockedReason, REVIEW_BATCH_MAX } from './agent/scheduler.ts';
export { executeReviewBatch } from './agent/batch.ts';

/**
 * One automatic collaboration step.
 *
 * The runtime is split into the layers the planner depends on:
 *
 *   buildObservation  ObservationBuilder  (deterministic context projection)
 *   nextScheduledTask Task Scheduler      (pre-planned tasks first, via dependsOn)
 *   planDecision      Planner             (LLM proposes; runtime disposes)
 *   evaluateAutoDecision  Policy Engine   (single final allow/deny gate)
 *   getAgentAction    ActionRegistry      (whitelisted, bounded mutations)
 *   beginStep/finish  RunController       (audit log, repetition, budget)
 *
 * Every decision path — LLM, assigned, demo, scheduled — converges on the
 * policy gate before beginStep. No path may execute around it.
 */
export async function autoStep(p: Project, assigned?: AutoDecision) {
  const run = p.production?.autoRun;
  if (!run || run.status !== 'running') throw new Error('自动运行未启动。');
  if (run.steps >= run.maxSteps) {
    exhaustAutoRun(run);
    return;
  }
  if (run.pendingReview && run.pendingReview.revision !== p.revision)
    delete run.pendingReview;
  // Reconcile the task list with the durable ledger first: tasks persisted
  // before a crash are restored; interrupted steps surface as failed.
  reconcileRunTasks(run, p);
  // pendingReview is mirrored by an explicit verification task (AUTHOR != VERIFIER).
  // Legacy pendingReview without a task is migrated here; from then on only the
  // scheduler decides whether verification may run.
  syncVerificationTask(run, p);
  const baseObservation = buildObservation(p, run);
  const observation = {
    ...baseObservation,
    // Single data-driven action truth source: capabilities, effects, approval
    // semantics and preconditions — the policy engine is the enforcement twin.
    allowedActions: describeAllowedActions(baseObservation.roles, p),
  };
  const scheduled = nextScheduledTask(run, observation.roles);
  let decision: AutoDecision;
  let requiredReview: AutoDecision | undefined;
  let scheduledTask: AgentTask | undefined;
  if (scheduled.kind === 'ready') {
    // Final authorization even for scheduler-produced decisions: the gate is
    // after ALL paths converge, not inside the planner.
    const { policy } = evaluateAutoDecision(scheduled.decision, p);
    if (!policy.allowed) {
      run.status = 'waiting_user';
      run.stopReason = 'review_required';
      run.summary =
        '分镜已修改，但可用复核岗位缺少执行权限。请在岗位配置中授予相应能力后继续；尚未通过复核。';
      return;
    }
    decision = scheduled.decision;
    // Verification semantics apply ONLY to the verification gate. A plain
    // scheduled review/write/design must never close the whole run.
    requiredReview =
      scheduled.task.kind === 'verify_storyboard' ? scheduled.decision : undefined;
    scheduledTask = scheduled.task;
  } else if (scheduled.kind === 'blocked') {
    // Work exists but its dependency forbids it. Do NOT fall back to the
    // planner: that would rebuild an execution path around the block.
    run.status = 'waiting_user';
    run.stopReason = 'review_required';
    run.summary =
      '分镜复核任务被阻塞：' +
      scheduled.reason +
      '。已停止自动协作，请重新开始一轮协作以重建任务；尚未通过复核。';
    return;
  } else if (scheduled.kind === 'waiting') {
    run.status = 'waiting_user';
    run.stopReason = 'review_required';
    run.summary =
      '分镜已修改，缺少另一名已启用的会审岗位。请启用场记或质量审查后继续；尚未通过复核。';
    return;
  } else if (scheduled.kind === 'batch') {
    // Limited parallelism: independent read-only reviews run concurrently,
    // state merges serially. Mutation tasks never batch.
    await executeReviewBatch(p, run, observation, scheduled.tasks, scheduled.decisions);
    return;
  } else {
    const plan: PlanOutcome = await planDecision(p, run, observation, assigned);
    if (plan.kind === 'pause') return;
    decision = plan.decision;
    requiredReview = plan.requiredReview;
  }
  // The unified execution gate. Planner decisions were checked on entry, this
  // is the one authoritative check shared by every path.
  const { policy } = evaluateAutoDecision(decision, p);
  if (!policy.allowed) throw new Error(policy.violations[0].message);
  // Task-first: the decision becomes a pending task BEFORE it runs, and the
  // executor reuses that exact record — one task id from proposal to result.
  const stepTask = scheduledTask ?? materializeDecisionTask(run, p, decision, assigned ? 'user' : 'system');
  const role = observation.roles.find((r) => r.id === decision.roleId);
  const step = beginStep(run, p, decision, role, assigned ? 'user' : 'system', stepTask);
  if (!step.repeat) {
    const action = getAgentAction(decision.action);
    try {
      await action.execute({
        project: p,
        run,
        observation,
        decision,
        requiredReview,
        role,
        entry: step.entry,
        contentBefore: step.contentBefore,
        taskId: step.taskId,
      });
    } catch (error) {
      const task = run.tasks?.find((t) => t.id === step.taskId);
      if (task && task.status === 'running') {
        task.status = 'failed';
        task.updatedAt = Date.now();
        persistTaskRecord(task, run, p);
      }
      throw error;
    }
  }
  finishStep(run, p, step.entry, step.taskId);
  // The supervisor's follow-up plan becomes a chained pending task sequence;
  // the scheduler owns it from here — no further LLM call needed.
  if (!step.repeat && decision.plan?.length) {
    materializePlanTasks(run, p, decision.plan, step.taskId);
  }
}

export function continuityFixDecision(p: Project): AutoDecision {
  const report = p.production?.continuityReview;
  if (
    !p.plan ||
    !p.production?.scriptApproved ||
    !report ||
    report.revision !== p.revision ||
    !report.findings.length
  )
    throw new Error('请先取得当前版本的场记问题报告，并确认剧本。');
  if (p.mode === 'demo')
    throw new Error('自动修订需要真实语言模型；演示模式请手动调整。');
  const roles = projectAgents(p).filter((r) => r.enabled);
  const role =
    roles.find((r) => r.id === 'storyboard') ??
    roles.find((r) => r.id === 'director') ??
    roles.find((r) => r.stages.includes('storyboard'));
  if (!role) throw new Error('请启用分镜导演或负责分镜的岗位。');
  return {
    roleId: role.id,
    action: 'revise_shots',
    reason:
      '按当前版本专业场记报告逐项修订分镜，保留已确认剧本、全部对白和场次时长；不生成媒体。',
  };
}

export function qualityFixDecision(p: Project, ids: unknown) {
  if (!p.plan || !p.production?.scriptApproved)
    throw new Error('先确认剧本并完成分镜，再修订制作诊断问题。');
  if (p.mode === 'demo')
    throw new Error('自动修订需要真实语言模型；演示可查看诊断并手动修改。');
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20 ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new Error('请选择 1–20 项具体问题。');
  const report = buildQualityReport(p);
  const findings = report.findings.filter((f) => ids.includes(f.id));
  if (findings.length !== ids.length)
    throw new Error('问题列表已变化，请刷新后重新选择。');
  if (findings.some((f) => f.owner === 'writer' || !f.shotIds.length))
    throw new Error('剧本或全局问题需先在对应步骤修改，不能通过改写分镜绕过。');
  const role =
    projectAgents(p).find((r) => r.enabled && r.id === 'storyboard') ??
    projectAgents(p).find((r) => r.enabled && r.id === 'director');
  if (!role) throw new Error('请先启用分镜导演或导演岗位。');
  return {
    roleId: role.id,
    action: 'revise_shots' as const,
    reason:
      '按本次用户选择的制作诊断问题修订分镜，重点问题 ID：' +
      ids.join('、') +
      '。依据当前确定性报告逐项处理，仅修改可证实的问题；保留创意、已确认剧本、对白、每场时长。不要为了消除风险提示而机械改掉有动机的镜头表达。修订后由另一岗位复核。',
  };
}

/** All whitelisted supervisor actions, for tests and diagnostics. */
export function autoActionIds(): readonly string[] {
  return registeredAgentActions();
}

import type { AutoRun } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AgentObservation } from './observation.ts';
import type { AutoDecision } from './planner.ts';
import type { AgentTask } from './task.ts';
import { persistTaskRecord } from './task.ts';
import { evaluateAutoDecision } from './policy.ts';
import { getAgentAction } from './actions/registry.ts';
import { beginStep, finishStep } from './run-controller.ts';

/**
 * Limited parallelism: several independent read-only reviews execute their
 * LLM calls CONCURRENTLY, each against a project clone; the validated
 * reports then merge SERIALLY in batch order. Mutation tasks never batch —
 * they stay strictly serial on the single-task path.
 *
 * Failure semantics match the sequential runtime: a failed review marks its
 * task failed and, after the successful reports merge, the first error is
 * rethrown so the run fails as usual.
 */
export async function executeReviewBatch(
  p: Project,
  run: AutoRun,
  observation: AgentObservation,
  tasks: AgentTask[],
  decisions: AutoDecision[],
): Promise<void> {
  const roleOf = (decision: AutoDecision) =>
    observation.roles.find((r) => r.id === decision.roleId);
  // Every decision passes the unified policy gate BEFORE any model call.
  const steps = tasks.map((task, i) => {
    const decision = decisions[i];
    const { policy } = evaluateAutoDecision(decision, p);
    if (!policy.allowed) throw new Error(policy.violations[0].message);
    return beginStep(run, p, decision, roleOf(decision), 'system', task);
  });
  const action = getAgentAction('review');
  const executions = steps.map((step, i) => {
    if (step.repeat) return null;
    return {
      step,
      clone: structuredClone(p),
      decision: decisions[i],
      role: roleOf(decisions[i]),
    };
  });
  const results = await Promise.allSettled(
    executions.map((execution) =>
      execution
        ? action.execute({
            project: execution.clone,
            run,
            observation,
            decision: execution.decision,
            requiredReview: undefined,
            role: execution.role,
            entry: execution.step.entry,
            contentBefore: execution.step.contentBefore,
            taskId: execution.step.taskId,
          })
        : Promise.resolve(null),
    ),
  );
  let firstError: unknown;
  const configRevision = p.production?.agentConfigRevision ?? 0;
  results.forEach((result, i) => {
    const execution = executions[i];
    if (!execution) return;
    if (result.status === 'rejected') {
      const task = run.tasks?.find((t) => t.id === execution.step.taskId);
      if (task && task.status === 'running') {
        task.status = 'failed';
        task.updatedAt = Date.now();
        persistTaskRecord(task, run, p);
      }
      if (!firstError) firstError = result.reason;
      return;
    }
    const report = (result.value as { report?: import('../team.ts').TeamReport } | null)?.report;
    if (report) {
      // Serial merge in batch order — the same filter+append runTeamReview uses.
      p.production!.teamReports = [
        ...(p.production!.teamReports ?? []).filter(
          (previous) =>
            !(
              previous.roleId === execution.decision.roleId &&
              previous.revision === p.revision &&
              (previous.configRevision ?? 0) === configRevision
            ),
        ),
        report,
      ].slice(-100);
      execution.step.entry.message +=
        '【实际结果：文本会审发现 ' +
        report.findings.filter((f) => f.severity !== 'note').length +
        ' 项待处理问题，不涉及画面检测。】';
    }
  });
  for (const step of steps) finishStep(run, p, step.entry, step.taskId);
  if (firstError) throw firstError;
}

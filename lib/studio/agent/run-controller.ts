import { contentFingerprint } from '../auto-progress.ts';
import { exhaustAutoRun } from '../auto-run-state.ts';
import type { AutoLogEntry, AutoRun } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AutoDecision } from './planner.ts';
import { taskKindForAction, syncVerificationTask } from './task.ts';
import type { AgentTask } from './task.ts';
import { capabilityForDecision } from './capabilities.ts';

export function noProgress(run: AutoRun, message: string) {
  run.status = 'stopped';
  run.stopReason = 'no_progress';
  run.summary = message + '已停止重复调用，原有作品内容保留。';
}

export type StartedStep = {
  entry: AutoLogEntry;
  contentBefore: string;
  /** Same role + same action + same content fingerprint: the step is refused before any model call. */
  repeat: boolean;
  /** Task id of this step; created even for refused steps so the trail is complete. */
  taskId: string;
};

function recordTask(
  run: AutoRun,
  p: Project,
  decision: AutoDecision,
  role: { name?: string; id?: string } | undefined,
  createdBy: 'user' | 'system',
): AgentTask {
  const list = (run.tasks ??= []);
  const task: AgentTask = {
    id: globalThis.crypto.randomUUID(),
    kind: taskKindForAction[decision.action],
    status: 'running',
    ownerRoleId: role?.id ?? 'producer',
    capability: capabilityForDecision(role, decision.action),
    createdBy,
    dependsOn: [],
    targetShotIds: [],
    reason: decision.reason,
    inputVersions: {
      revision: p.revision,
      configRevision: p.production?.agentConfigRevision ?? 0,
    },
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(task);
  if (list.length > 200) list.splice(0, list.length - 200);
  return task;
}

/** Opens the step: fingerprints the world, records the log entry, detects repetition. */
export function beginStep(
  run: AutoRun,
  p: Project,
  decision: AutoDecision,
  role: { name?: string; id?: string } | undefined,
  createdBy: 'user' | 'system' = 'system',
): StartedStep {
  const before = contentFingerprint(p);
  const revisionBefore = p.revision;
  const entry: AutoLogEntry = {
    at: Date.now(),
    role: role?.name ?? '总 Agent',
    roleId: role?.id,
    action: decision.action,
    message: decision.reason,
    revisionBefore,
    inputFingerprint: before,
  };
  const task = recordTask(run, p, decision, role, createdBy);
  run.steps++;
  const repeat =
    decision.action !== 'stop' &&
    run.log.some(
      (log) =>
        log.action === decision.action &&
        log.roleId === decision.roleId &&
        log.inputFingerprint === before,
    );
  if (repeat) {
    noProgress(run, '同一岗位对未改变内容重复执行同一任务。');
    entry.outcome = 'unchanged';
    task.status = 'cancelled';
    task.result = { outcome: 'unchanged' };
    task.updatedAt = Date.now();
  }
  return { entry, contentBefore: before, repeat, taskId: task.id };
}

/** Commits the step: final fingerprints, audit log, verification sync, budget exhaustion. */
export function finishStep(run: AutoRun, p: Project, entry: AutoLogEntry, taskId?: string) {
  entry.revisionAfter = p.revision;
  entry.outputFingerprint = contentFingerprint(p);
  run.log.push(entry);
  const task = taskId ? run.tasks?.find((t) => t.id === taskId) : undefined;
  if (task && task.status === 'running') {
    task.status = 'completed';
    task.result = {
      outcome: entry.outcome ?? 'stopped',
      ...(entry.artifactIds ? { artifactIds: entry.artifactIds } : {}),
    };
    task.updatedAt = Date.now();
  }
  // A step may have set pendingReview (storyboard revision): mirror it into an
  // open verification task within the same step so the gate is visible now.
  syncVerificationTask(run, p);
  if (run.status === 'running' && run.steps >= run.maxSteps) exhaustAutoRun(run);
}

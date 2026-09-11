import type { AutoRun, PendingAutoReview } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AutoDecision } from './planner.ts';
import type { CapabilityId } from './capabilities.ts';
import { safely } from '../durable/ledger.ts';

/** Persist a task at creation time: pending work is durable before it runs. */
export function persistTaskRecord(task: AgentTask, run: AutoRun, p: Project) {
  const committedNow = safely((ledger) => ledger.runCommitCount(run.id ?? '')) ?? 0;
  safely((ledger) =>
    ledger.upsertAgentTask({
      taskId: task.id,
      runId: run.id ?? '',
      projectId: p.id,
      kind: task.kind,
      status: task.status,
      ownerRoleId: task.ownerRoleId,
      capability: task.capability ?? '',
      dependsOn: task.dependsOn.join(','),
      inputRevision: task.inputVersions.revision,
      outcome: task.result?.outcome ?? '',
      reason: task.reason,
      verificationAuthor: task.verification?.authorRoleId ?? '',
      commitCount: committedNow + 1,
      updatedAt: task.updatedAt,
    }),
  );
}

/**
 * AgentTask: first-class unit of agent work.
 *
 * Tasks give the runtime an explicit record of what the supervisor asked for,
 * who owned it, what it depended on and how it ended. They are additive
 * today: the supervisor loop still runs sequentially, but every decision now
 * leaves a task trail, and pendingReview has an explicit verification task.
 */
export type AgentTaskKind =
  | 'review'
  | 'revise_storyboard'
  | 'write_script'
  | 'design_assets'
  | 'verify_storyboard'
  | 'stop';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'verification'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTaskResult = {
  outcome: 'reviewed' | 'modified' | 'candidate_created' | 'unchanged' | 'stopped';
  artifactIds?: string[];
};

export type AgentTask = {
  id: string;
  kind: AgentTaskKind;
  status: AgentTaskStatus;
  ownerRoleId: string;
  /** The capability this task exercises; derived by the runtime from role+action. */
  capability?: CapabilityId;
  createdBy: 'user' | 'system';
  dependsOn: string[];
  /** Structured shot targets arrive with the capability planner; empty for now. */
  targetShotIds: string[];
  reason: string;
  inputVersions: { revision: number; configRevision: number };
  attempts: number;
  createdAt: number;
  updatedAt: number;
  result?: AgentTaskResult;
  verification?: {
    required: boolean;
    authorRoleId: string;
    previousFindings: PendingAutoReview['previousFindings'];
  };
};

export const taskKindForAction: Record<AutoDecision['action'], AgentTaskKind> = {
  review: 'review',
  revise_shots: 'revise_storyboard',
  write_script: 'write_script',
  design_assets: 'design_assets',
  stop: 'stop',
};

/** Reverse mapping for the scheduler: a pending task of this kind runs which action. */
export const actionForTaskKind: Partial<Record<AgentTaskKind, AutoDecision['action']>> = {
  review: 'review',
  revise_storyboard: 'revise_shots',
  write_script: 'write_script',
  design_assets: 'design_assets',
  stop: 'stop',
  verify_storyboard: 'review',
};

/**
 * Task-first materialization: every decision becomes a pending task BEFORE it
 * runs, and the executor reuses that exact task record. Proposal → task →
 * scheduler → policy → executor → completed, one id end to end.
 */
export function materializeDecisionTask(
  run: AutoRun,
  p: Project,
  decision: AutoDecision,
  createdBy: 'user' | 'system',
): AgentTask {
  const list = (run.tasks ??= []);
  const task: AgentTask = {
    id: globalThis.crypto.randomUUID(),
    kind: taskKindForAction[decision.action],
    status: 'pending',
    ownerRoleId: decision.roleId,
    createdBy,
    dependsOn: [],
    targetShotIds: decision.targets ?? [],
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
  persistTaskRecord(task, run, p);
  return task;
}

/**
 * Reconcile the run's task list with the durable ledger: hydrate tasks the
 * ledger knows but the project lost (crash between ledger write and project
 * save). Existing task records win; a task that died mid-step ('running' in
 * the ledger) is restored as failed — the run must never resume an
 * interrupted step silently.
 */
export function reconcileRunTasks(run: AutoRun, p: Project): number {
  const rows = safely((ledger) => ledger.agentTasks(run.id ?? '')) ?? [];
  if (!rows.length) return 0;
  const committed = safely((ledger) => ledger.runCommitCount(run.id ?? '')) ?? 0;
  const tasks = (run.tasks ??= []);
  const known = new Set(tasks.map((t) => t.id));
  let added = 0;
  for (const row of rows) {
    const kind = row.kind as AgentTaskKind;
    // Conflict rules: a task that died mid-step ('running' in the ledger) OR
    // whose completion was never followed by a committed project save
    // (predicted commit number beyond the run's committed count) is an
    // interrupted task — never silently re-executable.
    const interrupted = row.status === 'running' || row.commitCount > committed;
    const existing = tasks.find((t) => t.id === row.taskId);
    if (existing) {
      // Project-side conflict: a stale open status must not let an
      // interrupted or already-terminal task run again.
      const open = existing.status === 'pending' || existing.status === 'verification';
      if (open && row.status !== existing.status) {
        if (interrupted) {
          existing.status = 'failed';
          existing.attempts = Math.max(existing.attempts, 1);
          existing.updatedAt = Date.now();
        } else if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
          existing.status = row.status as AgentTaskStatus;
          if (row.outcome)
            existing.result = { outcome: row.outcome as AgentTaskResult['outcome'] };
          existing.updatedAt = row.updatedAt;
        }
      }
      continue;
    }
    const status = interrupted ? 'failed' : (row.status as AgentTaskStatus);
    tasks.push({
      id: row.taskId,
      kind,
      status,
      ownerRoleId: row.ownerRoleId,
      ...(row.capability ? { capability: row.capability as CapabilityId } : {}),
      createdBy: 'system',
      dependsOn: row.dependsOn ? row.dependsOn.split(',') : [],
      targetShotIds: [],
      reason: row.reason,
      inputVersions: {
        revision: row.inputRevision,
        configRevision: p.production?.agentConfigRevision ?? 0,
      },
      attempts: interrupted ? 1 : 0,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
      ...(row.outcome && !interrupted
        ? { result: { outcome: row.outcome as AgentTaskResult['outcome'] } }
        : {}),
      ...(kind === 'verify_storyboard' && !interrupted
        ? {
            verification: {
              required: true,
              authorRoleId: row.verificationAuthor || row.ownerRoleId,
              previousFindings: [],
            },
          }
        : {}),
    });
    known.add(row.taskId);
    added++;
  }
  return added;
}

/**
 * Materialize the supervisor's follow-up plan as a chained pending task
 * sequence: each entry depends on the previous one, so the scheduler runs
 * them in order without re-asking the LLM.
 */
export function materializePlanTasks(
  run: AutoRun,
  p: Project,
  plan: NonNullable<AutoDecision['plan']>,
  afterTaskId: string,
): AgentTask[] {
  const list = (run.tasks ??= []);
  let previous = afterTaskId;
  const created: AgentTask[] = [];
  for (const entry of plan) {
    const task: AgentTask = {
      id: globalThis.crypto.randomUUID(),
      kind: taskKindForAction[entry.action],
      status: 'pending',
      ownerRoleId: entry.roleId ?? '',
      createdBy: 'system',
      dependsOn: [previous],
      targetShotIds: [],
      reason: entry.reason,
      inputVersions: {
        revision: p.revision,
        configRevision: p.production?.agentConfigRevision ?? 0,
      },
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(task);
    created.push(task);
    persistTaskRecord(task, run, p);
    previous = task.id;
  }
  if (list.length > 200) list.splice(0, list.length - 200);
  return created;
}

/** The open verification gate for the current pendingReview, if any. */
export function openVerificationTask(run: AutoRun): AgentTask | undefined {
  return run.tasks?.find(
    (t) =>
      t.kind === 'verify_storyboard' &&
      (t.status === 'verification' || t.status === 'pending'),
  );
}

/**
 * Mirror pendingReview into an explicit verification task (AUTHOR != VERIFIER
 * as a task, not a special run field). Idempotent: called at the start of
 * every step, including runs that inherited a pending review.
 */
export function syncVerificationTask(run: AutoRun, p: Project): AgentTask | undefined {
  if (!run.pendingReview) return undefined;
  const existing = openVerificationTask(run);
  if (existing) return existing;
  const list = (run.tasks ??= []);
  const revise = [...list].reverse().find((t) => t.kind === 'revise_storyboard');
  const task: AgentTask = {
    id: globalThis.crypto.randomUUID(),
    kind: 'verify_storyboard',
    status: 'verification',
    ownerRoleId: run.pendingReview.authorRoleId,
    capability: 'verify_storyboard',
    createdBy: 'system',
    dependsOn: revise ? [revise.id] : [],
    targetShotIds: [],
    reason: run.pendingReview.reason,
    inputVersions: {
      revision: run.pendingReview.revision,
      configRevision: p.production?.agentConfigRevision ?? 0,
    },
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    verification: {
      required: true,
      authorRoleId: run.pendingReview.authorRoleId,
      previousFindings: run.pendingReview.previousFindings,
    },
  };
  list.push(task);
  if (list.length > 200) list.splice(0, list.length - 200);
  persistTaskRecord(task, run, p);
  return task;
}

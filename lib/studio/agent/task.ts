import type { AutoRun, PendingAutoReview } from '../auto-run-state.ts';
import type { Project } from '../types.ts';
import type { AutoDecision } from './planner.ts';
import type { CapabilityId } from './capabilities.ts';

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
  return task;
}

import type { Project } from './types.ts';

/**
 * Approval domain events (additive, bounded). The boolean gates
 * (scriptApproved / renderApprovedRevision / asset.approved) stay the
 * authoritative enforcement; these events give approvals an identity, a
 * target and a revision, so status can be computed instead of inferred.
 */
export type ApprovalType = 'script' | 'assets' | 'render' | 'asset' | 'qa_shot' | 'final';
export type ApprovalEvent = {
  id: string;
  type: ApprovalType;
  target: string;
  /** 'user' for direct human approvals, otherwise the granting agent role id. */
  approvedBy: string;
  revision: number;
  at: number;
};

export function recordApproval(
  p: Project,
  type: ApprovalType,
  target: string,
  approvedBy = 'user',
): ApprovalEvent {
  const events = (p.production!.approvalEvents ??= []);
  const event: ApprovalEvent = {
    id: globalThis.crypto.randomUUID(),
    type,
    target,
    approvedBy,
    revision: p.revision,
    at: Date.now(),
  };
  events.push(event);
  if (events.length > 200) events.splice(0, events.length - 200);
  return event;
}

/** An approval is only current while the project revision it granted still holds. */
export function approvalStatus(event: ApprovalEvent, currentRevision: number): 'approved' | 'expired' {
  return event.revision === currentRevision ? 'approved' : 'expired';
}

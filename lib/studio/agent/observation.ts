import { ASSET_POLICY_GUIDE, assetRequirementManifest } from '../asset-policy.ts';
import { projectAgents } from '../team-config.ts';
import { currentAutoFindings } from '../auto-run-state.ts';
import type { AutoRun } from '../auto-run-state.ts';
import { buildQualityReport } from '../quality-report.ts';
import { capabilitiesForRole, capabilityLabels } from './capabilities.ts';
import type { Project } from '../types.ts';

/**
 * Deterministic context projection for the supervisor.
 *
 * This is the ObservationBuilder of the agent runtime: it decides what the
 * planner is allowed to see. Only the current text revision is projected;
 * stale reports, retired assets and transport metadata stay out.
 */
export function buildObservation(p: Project, run: AutoRun) {
  const roles = projectAgents(p).filter((r) => r.enabled);
  return {
    assetPolicy: ASSET_POLICY_GUIDE,
    assetReadiness: assetRequirementManifest(p),
    instruction: run.instruction,
    storyContext: p.storyContext,
    stage: p.production!.node,
    roles,
    // allowedActions is injected by the runtime facade from the action
    // registry — a single, data-driven truth source (see describeAllowedActions).
    // Capability dimension: roles stay the UI identity; the runtime routes by
    // capability. Declared grants win; known roles fall back to defaults.
    roleCapabilities: Object.fromEntries(
      roles.map((r) => [
        r.id,
        capabilitiesForRole(r.id, roles).map((c) => ({ id: c, label: capabilityLabels[c] })),
      ]),
    ),
    remaining: run.maxSteps - run.steps,
    idea: p.idea,
    answers: p.answers,
    brief: p.brief,
    duration: p.duration,
    scriptApproved: p.production!.scriptApproved,
    assets: p.production!.assets,
    library: p.production!.library?.map((a) => ({
      id: a.id,
      familyId: a.parentId ?? a.id,
      version: a.version,
      viewId: a.viewId,
      costumeOf: a.costumeOf,
      status: a.status,
      name: a.name,
      design: a.design,
      approved: a.approved,
      retired: a.retired,
    })),
    script: p.production!.script,
    plan: p.plan,
    reports: p.production!.teamReports?.filter(
      (r) =>
        r.revision === p.revision &&
        (r.configRevision ?? 0) === (p.production?.agentConfigRevision ?? 0),
    ),
    continuityReview:
      p.production?.continuityReview?.revision === p.revision
        ? p.production.continuityReview
        : undefined,
    pendingReview: run.pendingReview,
    history: run.log,
    qualityReport: buildQualityReport(p),
    unresolvedTextFindings: unresolvedFindings(p),
  };
}

export type AgentObservation = ReturnType<typeof buildObservation>;

/** Findings that still block a successful completion claim, across all text sources. */
export function unresolvedFindings(p: Project) {
  return [
    ...currentAutoFindings(p),
    ...buildQualityReport(p)
      .findings.filter((f) => f.severity === 'error')
      .map((f) => ({
        shotId: f.shotIds[0] ?? '',
        evidence: f.evidence,
        suggestion: f.suggestion,
      })),
    ...(p.production?.continuityReview?.revision === p.revision
      ? p.production.continuityReview.findings
      : []),
  ];
}

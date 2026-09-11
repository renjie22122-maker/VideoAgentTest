import { validateAutoStep } from '../auto-run-state.ts';
import { buildQualityReport } from '../quality-report.ts';
import { requireFFmpeg } from '../take-media.ts';
import { mediaInput, videoPreview } from '../providers.ts';
import { costSummary } from '../agent/observation.ts';
import { artifactManifest } from '../artifact-graph.ts';
import { blockedReason } from '../agent/scheduler.ts';
import { approvalStatus } from '../approvals.ts';
import { NEXT_HANDLER, newJob } from './shared.ts';
import type { CommandHandler } from './shared.ts';

/**
 * Read-only project commands run before the revision and auto-run guards,
 * so stale tabs and paused auto runs can still read the last committed state.
 */
export const readonlyProjectHandlers = [
  {
    action: 'shot_image_prompt',
    matches: (input) => input.action === 'shot_image_prompt',
    async run(ctx) {
      const { project: p, input } = ctx;
      if (!p!.plan?.shots.some((s) => s.id === input.shotId))
        throw new Error('镜头不存在。');
      const j = newJob(p!, input.shotId!, 'image');
      const prepared = mediaInput(p!, j) as {
        prompt: string;
        referenceImages: string[];
        model: string;
        referenceSelectionOmitted?: string[];
      };
      return {
        referenceSelectionOmitted: prepared.referenceSelectionOmitted,
        prompt: prepared.prompt,
        referenceImages: prepared.referenceImages,
        model: prepared.model,
        compiled: !!p!.production?.prompts?.some((v) => v.shotId === input.shotId),
      };
    },
  },
  {
    action: 'quality_report',
    matches: (input) => input.action === 'quality_report',
    async run({ project }) {
      return buildQualityReport(project!);
    },
  },
  {
    action: 'runtime_report',
    matches: (input) => input.action === 'runtime_report',
    async run({ project }) {
      // Agent observability: why/what/who/cost/state in one read-only view.
      const p = project!;
      const run = p.production?.autoRun;
      const tasks = run?.tasks ?? [];
      return {
        projectId: p.id,
        revision: p.revision,
        node: p.production?.node,
        run: run
          ? {
              id: run.id,
              status: run.status,
              steps: run.steps,
              maxSteps: run.maxSteps,
              stopReason: run.stopReason ?? null,
              summary: run.summary ?? null,
              pendingReview: run.pendingReview
                ? { authorRoleId: run.pendingReview.authorRoleId, revision: run.pendingReview.revision }
                : null,
            }
          : null,
        tasks: tasks.map((t) => ({
          id: t.id,
          kind: t.kind,
          status: t.status,
          ownerRoleId: t.ownerRoleId,
          capability: t.capability ?? null,
          dependsOn: t.dependsOn,
          attempts: t.attempts,
          blockedBy:
            t.status === 'pending' || t.status === 'verification'
              ? (blockedReason(t, tasks) ?? null)
              : null,
          result: t.result?.outcome ?? null,
          verification: t.verification
            ? { required: true, authorRoleId: t.verification.authorRoleId }
            : undefined,
        })),
        cost: costSummary(p),
        artifacts: artifactManifest(p).map((n) => ({
          kind: n.ref.kind,
          id: n.ref.id,
          status: n.status,
          version: n.version ?? null,
          producedAt: n.producedAt ?? null,
        })),
        approvals: (p.production?.approvalEvents ?? []).map((e) => ({
          type: e.type,
          target: e.target,
          approvedBy: e.approvedBy,
          at: e.at,
          status: approvalStatus(e, p.revision),
        })),
      };
    },
  },
  {
    action: 'video_preview',
    matches: (input) => input.action === 'video_preview',
    async run(ctx) {
      const { project: p, input } = ctx;
      const preview = videoPreview(p!, newJob(p!, input.shotId ?? '', 'video'));
      const shot = p!.plan?.shots.find((s) => s.id === input.shotId);
      if (
        p!.mode === 'live' &&
        shot &&
        shot.duration > (preview.profile.maxSeconds ?? Infinity)
      )
        try {
          await requireFFmpeg();
        } catch (e) {
          preview.issues.push(e instanceof Error ? e.message : '本地视频处理工具未就绪');
        }
      return preview;
    },
  },
  {
    action: 'get',
    matches: (input) => input.action === 'get',
    async run({ project }) {
      return project;
    },
  },
  {
    action: 'auto_step_refresh',
    matches: (input) => input.action === 'auto_step',
    async run(ctx) {
      const { project: p, input } = ctx;
      const verdict = validateAutoStep(
        p!.production?.autoRun,
        input.expectedRunId,
        input.expectedStep,
      );
      // 'refresh' reconciles a duplicate/stale request against the committed run;
      // 'execute' falls through to the autopilot command handler below the guards.
      return verdict === 'refresh' ? p : NEXT_HANDLER;
    },
  },
] as const satisfies readonly CommandHandler[];

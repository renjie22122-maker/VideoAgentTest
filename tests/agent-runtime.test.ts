import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// File-level isolation: demo tests must never touch the real .studio ledger.
process.env.STUDIO_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'agent-runtime-isolated-'));
import {
  getAgentAction,
  registeredAgentActions,
  agentActions,
  buildObservation,
  describeAllowedActions,
  syncVerificationTask,
  nextScheduledTask,
  beginStep,
  finishStep,
} from '../lib/studio/autopilot.ts';
import { createAutoRun, autoActions } from '../lib/studio/auto-run-state.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';

const project = () =>
  ({
    id: 'runtime-test',
    revision: 1,
    idea: '雨夜等车。',
    title: '雨夜',
    duration: 30,
    ratio: '16:9',
    mode: 'demo',
    phase: 'clarify',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  }) as Project;

void test('action registry exposes exactly the whitelisted supervisor actions', () => {
  assert.deepEqual([...registeredAgentActions()].sort(), [...autoActions].sort());
  assert.equal(agentActions.length, autoActions.length);
  for (const id of autoActions) {
    assert.equal(getAgentAction(id).id, id);
    assert.equal(typeof getAgentAction(id).execute, 'function');
  }
  assert.throws(() => getAgentAction('generate_video'), /未注册/);
  assert.throws(() => getAgentAction('approve_script'), /未注册/);
  const ids = new Set(registeredAgentActions());
  assert.equal(ids.size, registeredAgentActions().length, 'actions must be unique');
});

void test('observation projects only current-revision text and never transport metadata', () => {
  const p = project();
  p.plan = demoPlan(p);
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  p.production!.teamReports = [
    {
      roleId: 'reviewer',
      revision: p.revision,
      configRevision: 0,
      at: 0,
      role: '审查',
      summary: '当前版本',
      findings: [],
    },
    {
      roleId: 'reviewer',
      revision: p.revision - 1,
      configRevision: 0,
      at: 0,
      role: '审查',
      summary: '过期版本',
      findings: [],
    },
  ] as never;
  const run = createAutoRun(p, '检查文本');
  const observation = buildObservation(p, run);
  assert.equal((observation.reports ?? []).length, 1);
  assert.equal((observation.reports ?? [])[0].summary, '当前版本');
  assert.equal(observation.remaining, run.maxSteps);
  assert.equal(observation.roles.length > 0, true);
  assert.equal(typeof observation.qualityReport.version, 'number');
  // Context projection must not leak job/media transport state.
  assert.equal(JSON.stringify(observation).includes('videoUrl'), false);
});

void test('planner observation carries the data-driven action catalog', () => {
  const p = project();
  p.plan = demoPlan(p);
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  const run = createAutoRun(p, '检查文本');
  const base = buildObservation(p, run);
  const observation = {
    ...base,
    allowedActions: describeAllowedActions(base.roles, p),
  };
  const catalog = observation.allowedActions;
  assert.equal(catalog.length, 5);
  const revise = catalog.find((a) => a.action === 'revise_shots')!;
  assert.equal(revise.allowed, true);
  assert.equal(revise.requiresVerification, true);
  assert.ok(revise.effects.includes('approvals'));
  assert.ok(revise.approval.trim());
  assert.deepEqual(revise.capabilityRequirement.anyOf, ['revise_storyboard']);
  // roleCapabilities reflects declared-or-default grants per role.
  assert.ok(observation.roleCapabilities.writer.some((c) => c.id === 'write_screenplay'));
});

void test('the scheduler owns the pending review gate: no verifier means waiting, never a step', () => {
  const p = project();
  p.production!.agentConfig = {
    version: 1,
    agents: [
      {
        id: 'storyboard',
        name: '分镜导演',
        stages: ['storyboard'],
        deliverable: '分镜',
        checks: '检查',
        enabled: true,
      },
    ],
  };
  const run = createAutoRun(p, '继续');
  run.pendingReview = {
    revision: p.revision,
    authorRoleId: 'storyboard',
    reason: '修订',
    previousFindings: [],
  };
  // pendingReview migrates to an explicit verification task…
  syncVerificationTask(run, p);
  const scheduled = nextScheduledTask(run, p.production!.agentConfig.agents);
  assert.equal(scheduled.kind, 'waiting');
  // …and the scheduler, not the planner, owns the gate.
  assert.equal(run.status, 'running');
  assert.equal(run.steps, 0);
});

void test('run controller detects repetition, records outcomes and exhausts the budget', async () => {
  const p = project();
  const run = createAutoRun(p, '检查文本');
  run.maxSteps = 2;
  const decision = { roleId: 'reviewer', action: 'review' as const, reason: '审查' };
  const first = beginStep(run, p, decision, { id: 'reviewer', name: '审查' });
  assert.equal(first.repeat, false);
  assert.equal(run.steps, 1);
  assert.equal(first.entry.inputFingerprint!.length, 64);
  finishStep(run, p, first.entry);
  assert.equal(first.entry.revisionAfter, p.revision);
  assert.equal(first.entry.outputFingerprint, first.entry.inputFingerprint);
  assert.equal(run.log.length, 1);
  const second = beginStep(run, p, decision, { id: 'reviewer', name: '审查' });
  assert.equal(second.repeat, true, 'same content + same role must be refused');
  assert.equal(second.entry.outcome, 'unchanged');
  assert.equal(run.status, 'stopped');
  assert.equal(run.stopReason, 'no_progress');
  finishStep(run, p, second.entry);
  assert.equal(run.log.length, 2);
  // Budget exhaustion path: fresh run at the cap.
  const full = createAutoRun(p, '任务');
  full.maxSteps = 1;
  const third = beginStep(full, p, { roleId: 'producer', action: 'stop', reason: '完成' }, undefined);
  finishStep(full, p, third.entry);
  assert.equal(full.status, 'budget_exhausted');
});

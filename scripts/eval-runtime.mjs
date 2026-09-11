import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Fixed-scenario runtime evaluation (mocked providers, zero spend):
 *   node scripts/eval-runtime.mjs
 *
 * Measures, under identical model settings: how many LLM calls a goal takes,
 * whether the independent verification gate actually runs, whether accepted
 * follow-up plans execute, and the estimated cost. Text-review metrics only —
 * actual picture quality needs separate human/vision evaluation.
 */

process.env.STUDIO_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'frame-eval-'));
process.env.LLM_BASE_URL = 'https://eval.invalid/v1';
process.env.LLM_API_KEY = 'eval';
process.env.LLM_MODEL = 'eval-model';

const { autoStep, createAutoRun, syncVerificationTask } = await import(
  '../lib/studio/autopilot.ts'
);
const { costSummary } = await import('../lib/studio/agent/observation.ts');
const { demoPlan } = await import('../lib/studio/domain.ts');
const { demoScreenplay } = await import('../lib/studio/screenplay.ts');
const { initialProduction } = await import('../lib/studio/graph.ts');
const { withIntent } = await import('../tests/intent-fixture.ts');

const project = () => ({
  id: 'eval-' + Math.random().toString(36).slice(2, 8),
  revision: 1,
  idea: '雨中等车。',
  title: '雨',
  duration: 24,
  ratio: '16:9',
  mode: 'live',
  phase: 'clarify',
  createdAt: 0,
  updatedAt: 0,
  questions: [],
  answers: {},
  jobs: [],
  production: initialProduction(),
});

let calls = 0;
const respond = (content) => {
  calls++;
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  );
};

const results = [];

// Scenario 1: revise → forced independent verification, one worker call each.
{
  const p = project();
  p.plan = demoPlan(p);
  p.production.node = 'storyboard';
  p.production.script = demoScreenplay(p);
  p.production.scriptApproved = true;
  p.production.assets = { bible: p.plan.bible, seed: 42, locked: true };
  const changed = withIntent(p.plan.shots, p.production.script);
  changed[0].description += ' 主角先站稳，再转身。';
  calls = 0;
  globalThis.fetch = async () =>
    respond(calls === 0 ? { shots: changed } : { summary: '复核未见待修问题', findings: [] });
  p.production.autoRun = createAutoRun(p, '修订分镜', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  p.production.autoRun = createAutoRun(p, '继续复核');
  syncVerificationTask(p.production.autoRun, p);
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  const finalTasks = p.production.autoRun.tasks ?? [];
  results.push({
    scenario: 'revise-verify-gate',
    llmCalls: calls,
    reviseCompleted: finalTasks.some((t) => t.kind === 'revise_storyboard' && t.status === 'completed'),
    // Derived from the task RESULT, not mere existence.
    verificationCompleted: finalTasks.some((t) => t.kind === 'verify_storyboard' && t.status === 'completed'),
    gateClosed: p.production.autoRun.pendingReview === undefined,
    finalStatus: p.production.autoRun.status,
    costEstimatedUsd: costSummary(p).spentEstimated,
  });
}

// Scenario 2: supervisor plans two follow-up reviews; the scheduler executes
// them with no additional supervisor call.
{
  const p = project();
  p.plan = demoPlan(p);
  p.production.script = demoScreenplay(p);
  p.production.scriptApproved = true;
  p.production.assets = { bible: p.plan.bible, seed: 42, locked: false };
  calls = 0;
  let supervisorCalls = 0;
  globalThis.fetch = async () => {
    const isSupervisor = calls === 0;
    if (isSupervisor) supervisorCalls++;
    return respond(
      isSupervisor
        ? {
            roleId: 'reviewer',
            action: 'review',
            reason: '初审',
            plan: [
              { action: 'review', roleId: 'continuity', reason: '场记复审' },
              { action: 'review', reason: '终审' },
            ],
          }
        : { summary: '未见新增问题', findings: [] },
    );
  };
  p.production.autoRun = createAutoRun(p, '会审计划', 4);
  await autoStep(p);
  await autoStep(p);
  await autoStep(p);
  const tasks = p.production.autoRun.tasks ?? [];
  results.push({
    scenario: 'planned-follow-ups',
    llmCalls: calls,
    supervisorCalls,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    roleIdlessRouted: tasks.some((t) => t.status === 'completed' && t.ownerRoleId === 'producer'),
    finalStatus: p.production.autoRun.status,
    costEstimatedUsd: costSummary(p).spentEstimated,
  });
}

// Scenario 3: a blocked verification must cost zero calls and stay open.
{
  const p = project();
  const run = createAutoRun(p, '复核');
  run.pendingReview = { revision: p.revision, authorRoleId: 'storyboard', reason: '修订', previousFindings: [] };
  run.tasks = [
    { id: 't1', kind: 'revise_storyboard', status: 'cancelled', ownerRoleId: 'storyboard', createdBy: 'system', dependsOn: [], targetShotIds: [], reason: '修订', inputVersions: { revision: 1, configRevision: 0 }, attempts: 1, createdAt: 0, updatedAt: 0 },
    { id: 't2', kind: 'verify_storyboard', status: 'verification', ownerRoleId: 'storyboard', capability: 'verify_storyboard', createdBy: 'system', dependsOn: ['t1'], targetShotIds: [], reason: '复核', inputVersions: { revision: 1, configRevision: 0 }, attempts: 0, createdAt: 0, updatedAt: 0, verification: { required: true, authorRoleId: 'storyboard', previousFindings: [] } },
  ];
  p.production.autoRun = run;
  calls = 0;
  globalThis.fetch = async () => respond({});
  await autoStep(p, { roleId: 'producer', action: 'stop', reason: '想直接结束' });
  results.push({
    scenario: 'blocked-verification',
    llmCalls: calls,
    gateStayedOpen: run.tasks.some((t) => t.id === 't2' && t.status === 'verification'),
    finalStatus: run.status,
    costEstimatedUsd: costSummary(p).spentEstimated,
  });
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

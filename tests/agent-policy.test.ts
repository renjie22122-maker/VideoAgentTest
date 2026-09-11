import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAutoDecision,
  validateAutoDecision,
  describeAllowedActions,
  agentActions,
} from '../lib/studio/autopilot.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { defaultAgents, validateAgentConfig } from '../lib/studio/team-config.ts';
import type { Project } from '../lib/studio/types.ts';

const project = (withPlan = false, withAssets = false) => {
  const p: Project = {
    id: 'policy-test',
    revision: 1,
    idea: '雨中等车。',
    title: '雨',
    duration: 24,
    ratio: '16:9',
    mode: 'demo',
    phase: 'clarify',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  };
  if (withPlan) p.plan = demoPlan(p);
  if (withAssets) p.production!.assets = { bible: p.plan!.bible, seed: 42, locked: false };
  return p;
};

void test('policy verdicts keep the historical violation order and messages', () => {
  const p = project();
  assert.deepEqual(
    evaluateAutoDecision({ action: 'enqueue', roleId: 'x', reason: 'x' }, p).policy.violations.map((v) => v.code),
    ['invalid_decision'],
  );
  assert.throws(() => validateAutoDecision({ action: 'enqueue', roleId: 'x', reason: 'x' }, p), /不允许的动作/);
  assert.throws(() => validateAutoDecision({ action: 'review', roleId: 'missing', reason: 'x' }, p), /未启用岗位/);
  assert.throws(() => validateAutoDecision({ action: 'revise_shots', roleId: 'producer', reason: 'x' }, p), /没有分镜可修改/);
});

void test('capability authority: role grants are checked before any executor runs', () => {
  const p = project(true, true);
  // Producer is enabled and can review, but cannot revise storyboards.
  const producer = evaluateAutoDecision({ action: 'revise_shots', roleId: 'producer', reason: '修订' }, p);
  assert.equal(producer.policy.allowed, false);
  assert.equal(producer.policy.violations[0].code, 'capability_missing');
  assert.ok(producer.policy.capabilityRequirement.anyOf!.includes('revise_storyboard'));
  assert.deepEqual(producer.policy.grantedCapabilities, ['plan_work', 'review_story']);
  const storyboard = evaluateAutoDecision({ action: 'revise_shots', roleId: 'storyboard', reason: '修订' }, p);
  assert.equal(storyboard.policy.allowed, true);
  assert.equal(storyboard.policy.requiresVerification, true);
  assert.ok(storyboard.policy.effects.includes('media'));
  // stop needs no capability and never mutates.
  const stop = evaluateAutoDecision({ action: 'stop', roleId: 'anything', reason: '结束' }, p);
  assert.equal(stop.policy.allowed, true);
  assert.deepEqual(stop.policy.capabilityRequirement, {});
  // Preconditions are checked before capability grants (historical order).
  const noAssets = evaluateAutoDecision({ action: 'design_assets', roleId: 'missing', reason: 'x' }, project(true, false));
  assert.equal(noAssets.policy.violations[0].code, 'role_disabled');
});

void test('availableActions is the data-driven twin of the policy', () => {
  const p = project(true, true);
  const roles = defaultAgents();
  const catalog = describeAllowedActions(roles, p);
  assert.equal(catalog.length, agentActions.length);
  for (const entry of catalog) {
    assert.ok(entry.description.trim());
    assert.equal(typeof entry.allowed, 'boolean');
  }
  const revise = catalog.find((e) => e.action === 'revise_shots')!;
  assert.equal(revise.allowed, true);
  assert.deepEqual(revise.capabilityRequirement.anyOf, ['revise_storyboard']);
  assert.equal(revise.requiresVerification, true);
  assert.ok(revise.approval.trim());
  // Without any capable role the same action is reported blocked with a reason.
  const customOnly: Project = project(true, true);
  customOnly.production!.agentConfig = {
    version: 1,
    agents: [
      {
        id: 'custom_x',
        name: '自定义',
        stages: ['storyboard'],
        deliverable: '分镜',
        checks: '检查',
        enabled: true,
      },
    ],
  };
  const blocked = describeAllowedActions(
    customOnly.production!.agentConfig.agents,
    customOnly,
  ).find((e) => e.action === 'revise_shots')!;
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reasons[0], /所需能力/);
});

void test('agent config validates declared capabilities strictly', () => {
  const good = {
    version: 1,
    agents: [
      ...defaultAgents(),
      {
        id: 'custom_y',
        name: '自定义',
        stages: ['storyboard'],
        deliverable: '分镜',
        checks: '检查',
        enabled: true,
        capabilities: ['revise_storyboard', 'review_camera'],
      },
    ],
  };
  const parsed = validateAgentConfig(JSON.parse(JSON.stringify(good)));
  assert.deepEqual(
    parsed.agents.find((a) => a.id === 'custom_y')!.capabilities,
    ['revise_storyboard', 'review_camera'],
  );
  assert.throws(
    () =>
      validateAgentConfig({
        ...good,
        agents: [{ ...good.agents[0], capabilities: ['not_a_capability'] }],
      }),
    /能力/,
  );
  assert.throws(
    () =>
      validateAgentConfig({
        ...good,
        agents: [{ ...good.agents[0], capabilities: ['review_camera', 'review_camera'] }],
      }),
    /能力/,
  );
});

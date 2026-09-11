import test from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  autoStep,
  createAutoRun,
  validateAutoDecision,
  capabilityForDecision,
  capabilitiesForRole,
  defaultRoleCapabilities,
} from '../lib/studio/autopilot.ts';
import { filmTeam } from '../lib/studio/team.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { withIntent } from './intent-fixture.ts';
import type { Project } from '../lib/studio/types.ts';

const project = () =>
  ({
    id: 'capability-test',
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
  }) as Project;

void test('every built-in role has a unique capability grant and known roles route by capability', () => {
  for (const role of filmTeam) {
    const caps = capabilitiesForRole(role.id);
    assert.ok(caps.length >= 1, role.id + ' needs at least one capability');
    assert.equal(new Set(caps).size, caps.length, role.id + ' capabilities must be unique');
  }
  assert.deepEqual(capabilityForDecision('storyboard', 'revise_shots'), 'revise_storyboard');
  assert.equal(capabilityForDecision('camera', 'review'), 'review_camera');
  assert.equal(capabilityForDecision('writer', 'write_script'), 'write_screenplay');
  assert.equal(capabilityForDecision('character_art', 'design_assets'), 'design_character');
  assert.equal(capabilityForDecision('environment_art', 'design_assets'), 'design_environment');
  assert.equal(capabilityForDecision('reviewer', 'review'), 'review_qa');
  assert.equal(capabilityForDecision('producer', 'stop'), 'plan_work');
});

void test('custom roles never gain permission by fallback; declared capabilities are honored', () => {
  // Descriptive metadata still falls back (task records stay informative)…
  assert.equal(capabilityForDecision('custom_role', 'revise_shots'), 'revise_storyboard');
  // …but authorization does not: an enabled custom role without declared
  // capabilities is refused by the policy engine.
  const p = project();
  p.plan = demoPlan(p);
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  p.production!.agentConfig = {
    version: 1,
    agents: [
      {
        id: 'custom_role',
        name: '自定义岗位',
        stages: ['storyboard'],
        deliverable: '分镜',
        checks: '检查',
        enabled: true,
      },
    ],
  };
  assert.throws(
    () =>
      validateAutoDecision(
        { action: 'revise_shots', roleId: 'custom_role', reason: '修订' },
        p,
      ),
    /未授予/,
  );
  // Declaring the capability in the agent config grants the authority.
  p.production!.agentConfig.agents[0].capabilities = ['revise_storyboard'];
  assert.doesNotThrow(() =>
    validateAutoDecision(
      { action: 'revise_shots', roleId: 'custom_role', reason: '修订' },
      p,
    ),
  );
  assert.deepEqual(capabilitiesForRole('custom_role', p.production!.agentConfig.agents), [
    'revise_storyboard',
  ]);
  // Known built-in roles keep their default grants even when configured without capabilities.
  p.production!.agentConfig.agents.push({
    id: 'writer',
    name: '编剧',
    stages: ['script'],
    deliverable: '剧本',
    checks: '检查',
    enabled: true,
  });
  assert.ok(capabilitiesForRole('writer', p.production!.agentConfig.agents).includes('write_screenplay'));
});

void test('task records carry the derived capability and the verification task its own', async (t) => {
  const p = project();
  p.mode = 'live';
  p.plan = demoPlan(p);
  p.production!.node = 'storyboard';
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: path.join(tmpdir(), 'capability-test-' + Date.now()),
    LLM_BASE_URL: 'https://capability-test.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const changed = withIntent(p.plan.shots, p.production!.script);
  changed[0].description += ' 主角先站稳，再转身。';
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots: changed }) } }] }),
    ),
  );
  p.production!.autoRun = createAutoRun(p, '修订分镜', 1);
  await autoStep(p, { roleId: 'storyboard', action: 'revise_shots', reason: '补充动作过渡' });
  const tasks = p.production!.autoRun!.tasks ?? [];
  const revise = tasks.find((task) => task.kind === 'revise_storyboard')!;
  const verify = tasks.find((task) => task.kind === 'verify_storyboard')!;
  assert.equal(revise.capability, 'revise_storyboard');
  assert.equal(revise.ownerRoleId, 'storyboard');
  assert.equal(verify.capability, 'verify_storyboard');
  assert.ok(defaultRoleCapabilities.continuity.includes('verify_storyboard'));
});

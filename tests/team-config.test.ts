import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAgents,
  validateAgentConfig,
} from '../lib/studio/team-config.ts';
import { runTeamReview } from '../lib/studio/team-runtime.ts';
import { skillGuide } from '../lib/studio/skills.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';
void test('custom configuration rejects duplicates, unknown stages and empty active teams', () => {
  const agents = defaultAgents();
  assert.equal(agents.length, 17);
  assert.throws(
    () => validateAgentConfig({ version: 1, agents: [agents[0], agents[0]] }),
    /唯一/,
  );
  assert.throws(
    () =>
      validateAgentConfig({
        version: 1,
        agents: [{ ...agents[0], stages: ['missing'] }],
      }),
    /阶段/,
  );
  assert.throws(
    () =>
      validateAgentConfig({
        version: 1,
        agents: agents.map((a) => ({ ...a, enabled: false })),
      }),
    /至少/,
  );
  agents[0].name = 'changed';
  assert.notEqual(defaultAgents()[0].name, 'changed');
});
void test('custom agents participate in stage instructions and independent reviews', async () => {
  const p = {
    id: 'custom',
    revision: 2,
    mode: 'demo',
    idea: 'test',
    production: initialProduction(),
  } as Project;
  p.production!.agentConfig = validateAgentConfig({
    version: 1,
    agents: [
      {
        id: 'costume',
        name: '服装设计',
        stages: ['assets'],
        deliverable: '独立服装规范',
        checks: '检查袖口和纽扣',
        enabled: true,
      },
    ],
  });
  p.production!.agentConfigRevision = 3;
  assert.match(skillGuide('assets', p), /独立服装规范/);
  const result = await runTeamReview(p, 'costume');
  assert.equal(result.report.configRevision, 3);
  assert.equal(p.production!.teamReports!.length, 1);
  await runTeamReview(p, 'costume');
  assert.equal(p.production!.teamReports!.length, 1);
  p.production!.agentConfig.agents[0].enabled = false;
  assert.throws(() => skillGuide('assets', p), /至少/);
  await assert.rejects(runTeamReview(p, 'missing'));
});

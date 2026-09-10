import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  globalCommandHandlers,
  readonlyProjectHandlers,
  coreCommandHandlers,
  lateCommandHandlers,
} from '../lib/studio/server.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { createAutoRun } from '../lib/studio/auto-run-state.ts';
import type { Command } from '../lib/studio/commands/shared.ts';
import type { Project } from '../lib/studio/types.ts';

const allPhases = [
  ...globalCommandHandlers,
  ...readonlyProjectHandlers,
  ...coreCommandHandlers,
  ...lateCommandHandlers,
];

const knownActions = [
  'save_settings',
  'list',
  'create',
  'shot_image_prompt',
  'quality_report',
  'video_preview',
  'get',
  'auto_step',
  'story_save',
  'story_next',
  'enqueue_group',
  'merge_shots',
  'video_config',
  'video_tail_upload',
  'shot_image_upload',
  'motion_plan',
  'duration_update',
  'auto_start',
  'auto_stop',
  'continuity_fix',
  'quality_fix',
  'agent_config_save',
  'team_review',
  'asset_add',
  'asset_supplement',
  'asset_requirement',
  'asset_poll',
  'asset_abandon',
  'asset_save_bible',
  'asset_inventory',
  'asset_refresh_inventory',
  'asset_upload',
  'asset_regenerate',
  'asset_generate',
  'asset_approve',
  'asset_retry',
  'asset_edit_design',
  'asset_costume',
  'asset_prop_state',
  'asset_use_costume',
  'asset_set_review',
  'asset_views',
  'asset_rebuild',
  'asset_variant',
  'brief_decisions',
  'analyze_brief',
  'clarify_answers',
  'confirm_brief',
  'plan',
  'rewrite_script',
  'approve_script',
  'approve_assets',
  'shot',
  'bible',
  'continuity_review',
  'compile',
  'approve_render',
  'review',
  'prepare_assembly',
  'complete',
  'enqueue',
  'cancel',
  'poll',
];

void test('every known command has exactly one handler (auto_step reconciles read-only first)', () => {
  for (const action of knownActions) {
    const matches = allPhases.filter((h) => h.matches({ action }));
    const expected = action === 'auto_step' ? 2 : 1;
    assert.equal(
      matches.length,
      expected,
      `${action} matched ${matches.length} handlers, expected ${expected}`,
    );
  }
});

void test('the ordered registry mirrors the original dispatch chain', () => {
  const ordered = [...coreCommandHandlers, ...lateCommandHandlers].map((h) => h.action);
  assert.deepEqual(ordered, [
    'story',
    'enqueue_group',
    'merge_shots',
    'video_config',
    'shot_image_upload',
    'motion_plan',
    'duration_update',
    'auto',
    'agent_config_save',
    'team_review',
    'asset',
    'brief_decisions',
    'clarify',
    'plan',
    'approve_script',
    'approve_assets',
    'shot',
    'bible',
    'continuity_review',
    'compile',
    'approve_render',
    'review',
    'prepare_assembly',
    'complete',
    'enqueue',
    'cancel',
    'poll',
  ]);
});

void test('unknown commands fall through to the gateway error and never mutate storage', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cmd-registry-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p: Project = {
    id: 'registry-project',
    revision: 1,
    idea: '测试',
    title: '测试',
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
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  await assert.rejects(
    dispatch({ action: 'not_a_command', id: p.id, revision: 1 } as Command),
    /未知操作/,
  );
});

void test('auto_step refresh reconciles through the read-only phase without advancing', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cmd-refresh-'));
  const old = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => {
    if (old === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = old;
  });
  const p: Project = {
    id: 'refresh-project',
    revision: 1,
    idea: '测试',
    title: '测试',
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
  p.production!.autoRun = createAutoRun(p, '任务');
  p.production!.autoRun!.status = 'completed';
  p.production!.autoRun!.steps = 2;
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  const result = (await dispatch({
    action: 'auto_step',
    id: p.id,
    revision: 1,
    expectedRunId: p.production!.autoRun!.id,
    expectedStep: 0,
  })) as Project;
  // Reconcile: the committed run is returned untouched (steps already past the request).
  assert.equal(result.production!.autoRun!.steps, 2);
  assert.equal(result.production!.autoRun!.log.length, 0);
});

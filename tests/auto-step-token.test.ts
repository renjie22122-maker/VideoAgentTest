import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRun, validateAutoStep, type AutoRun } from '../lib/studio/auto-run-state.ts';
import type { Project } from '../lib/studio/types.ts';

const project = { revision: 1 } as Project;

void test('automatic steps require a run token and never replay a committed step', () => {
  const run = createAutoRun(project, '检查文本');
  assert.match(run.id!, /^[a-f0-9-]{36}$/);
  assert.equal(validateAutoStep(run, run.id, 0), 'execute');
  run.steps = 1;
  const saved = structuredClone(run);
  assert.equal(validateAutoStep(run, run.id, 0), 'refresh');
  assert.equal(validateAutoStep(run, run.id, 1), 'execute');
  assert.throws(() => validateAutoStep(run, run.id, 2), /超前/);
  assert.deepEqual(run, saved);
});

void test('restarted runs reject stale tabs even when their step numbers match', () => {
  const first = createAutoRun(project, '第一轮');
  const second = createAutoRun(project, '第二轮');
  assert.notEqual(first.id, second.id);
  assert.throws(() => validateAutoStep(second, first.id, 0), /已更换/);
  assert.equal(validateAutoStep(second, second.id, 0), 'execute');
});

void test('legacy runs require an explicit restart and malformed tokens cannot advance work', () => {
  const legacy: AutoRun = { status: 'running', steps: 0, maxSteps: 4, instruction: '旧任务', log: [] };
  assert.throws(() => validateAutoStep(legacy, undefined, 0), /旧版本.*先停止/);
  assert.equal(legacy.id, undefined);
  const run = createAutoRun(project, '新任务');
  for (const step of [undefined, null, '0', -1, 0.5, NaN, Infinity]) {
    assert.throws(() => validateAutoStep(run, run.id, step), /缺少有效/);
  }
  assert.throws(() => validateAutoStep(run, undefined, 0), /缺少有效/);
  assert.throws(() => validateAutoStep(undefined, run.id, 0), /未启动/);
});

void test('terminal runs reconcile duplicate responses without restarting or clearing approval gates', () => {
  for (const status of ['completed', 'waiting_user', 'budget_exhausted', 'stopped', 'failed'] as const) {
    const run = createAutoRun(project, '任务');
    run.status = status;
    run.pendingReview = { revision: 1, authorRoleId: 'storyboard', reason: '待复核', previousFindings: [] };
    const saved = structuredClone(run);
    assert.equal(validateAutoStep(run, run.id, 0), 'refresh');
    assert.deepEqual(run, saved);
  }
});

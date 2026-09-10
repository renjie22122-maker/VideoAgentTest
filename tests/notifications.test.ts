import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectNotices,
  languageNotice,
  requestAttention,
} from '../lib/studio/notification-events.ts';
import { nextMediaPoll } from '../lib/studio/media-poll-state.ts';
import type { Project, Job, Asset } from '../lib/studio/types.ts';
import { initialProduction } from '../lib/studio/graph.ts';
function project(): Project {
  return {
    id: 'notices',
    title: '测试作品',
    idea: '一个人走向车站',
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    duration: 30,
    ratio: '16:9',
    mode: 'live',
    phase: 'planned',
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  };
}
function job(): Job {
  return {
    id: 'j1',
    shotId: 'shot-1',
    kind: 'video',
    status: 'running',
    revision: 1,
    mode: 'live',
    createdAt: 101,
  };
}
function asset(): Asset {
  return {
    id: 'a1',
    name: '主角设定',
    kind: 'character',
    referenceIds: [],
    prompt: 'test',
    version: 1,
    approved: false,
    status: 'running',
    createdAt: 101,
  };
}
void test('initial load, queue submission, and an incomplete live output never announce completion', () => {
  const before = project(),
    next = structuredClone(before);
  next.jobs = [job()];
  next.production!.library = [asset()];
  assert.deepEqual(projectNotices(undefined, next), []);
  assert.deepEqual(projectNotices(before, next), []);
  const incomplete = structuredClone(next);
  incomplete.jobs[0].status = 'succeeded';
  incomplete.production!.library![0].status = 'ready';
  assert.deepEqual(projectNotices(next, incomplete), []);
  const received = structuredClone(incomplete);
  received.jobs[0].outputUrl = 'https://example.com/late.mp4';
  received.production!.library![0].url = 'https://example.com/late.png';
  assert.equal(projectNotices(incomplete, received).length, 2);
  assert.equal(languageNotice('enqueue', next), undefined);
  assert.equal(languageNotice('auto_start', next), undefined);
});
void test('ready media notifies once with a result target; uploads and manual abandonment do not', () => {
  const before = project();
  before.jobs = [job()];
  before.production!.library = [asset()];
  const next = structuredClone(before);
  next.updatedAt = 200;
  next.jobs[0].status = 'succeeded';
  next.jobs[0].outputUrl = 'https://example.com/clip.mp4';
  next.jobs[0].finishedAt = 200;
  Object.assign(next.production!.library![0], {
    status: 'ready',
    url: 'https://example.com/ref.png',
    error: 'stale provider error',
  });
  const notices = projectNotices(before, next);
  assert.equal(notices.length, 2);
  assert.ok(notices.every((n) => n.outcome === 'ready'));
  assert.equal(notices[0].target?.shotId, 'shot-1');
  assert.equal(notices[1].target?.view, 'assets');
  assert.deepEqual(projectNotices(next, structuredClone(next)), []);
  next.jobs[0].status = 'cancelled';
  next.production!.library![0].origin = 'upload';
  assert.deepEqual(projectNotices(before, next), []);
  next.production!.library![0].origin = undefined;
  next.production!.library![0].status = 'failed';
  next.production!.library![0].error = '已停止本地跟踪，供应商仍在执行';
  assert.deepEqual(projectNotices(before, next), []);
});
void test('long take notifies only after final assembly, and a retried job can report its new completion', () => {
  const before = project();
  before.jobs = [
    {
      ...job(),
      longTake: {
        provider: 'minimax',
        model: 'test',
        phase: 'rendering',
        parts: [
          {
            start: 0,
            end: 15,
            requestSeconds: 15,
            outputUrl: 'https://example.com/part.mp4',
          },
        ],
      },
    },
  ];
  const next = structuredClone(before);
  next.jobs[0].status = 'succeeded';
  next.jobs[0].outputUrl = 'https://example.com/whole.mp4';
  next.jobs[0].longTake!.phase = 'assembling';
  assert.deepEqual(projectNotices(before, next), []);
  next.jobs[0].longTake!.phase = 'complete';
  assert.equal(projectNotices(before, next).length, 1);
  const retry = structuredClone(next);
  retry.jobs[0].status = 'running';
  retry.jobs[0].retries = 1;
  const returned = structuredClone(retry);
  returned.jobs[0].status = 'succeeded';
  returned.jobs[0].finishedAt = 300;
  assert.notEqual(
    projectNotices(retry, returned)[0].id,
    projectNotices(before, next)[0].id,
  );
});
void test('HTTP-success auto failures and waiting states are attention notices, not successful film completion', () => {
  const before = project();
  before.production!.autoRun = {
    id: 'run-1',
    steps: 0,
    maxSteps: 12,
    status: 'running',
    instruction: 'test',
    log: [],
  };
  for (const status of [
    'failed',
    'waiting_user',
    'budget_exhausted',
  ] as const) {
    const next = structuredClone(before);
    next.production!.autoRun!.status = status;
    next.production!.autoRun!.steps = 0;
    const notices = projectNotices(before, next);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].outcome, 'attention');
    assert.match(notices[0].body, /不代表画面质量通过/);
  }
  const next = structuredClone(before);
  next.production!.autoRun!.steps = 1;
  assert.match(projectNotices(before, next)[0].title, /第 1 步已返回/);
  assert.deepEqual(projectNotices(next, structuredClone(next)), []);
});
void test('errors preserve uncertainty and clarification response actions are covered', () => {
  const p = project();
  const notice = requestAttention(
    'asset_poll',
    { id: p.id, assetId: 'a' },
    p,
    '等待超时',
  );
  assert.equal(notice?.outcome, 'attention');
  assert.match(notice!.body, /可能仍在处理/);
  assert.equal(notice?.target?.view, 'assets');
  p.jobs = [{ ...job(), kind: 'image' }];
  assert.equal(
    requestAttention('poll', { id: p.id }, p, 'timeout')?.category,
    'image',
  );
  assert.equal(
    requestAttention(
      'poll',
      { id: p.id },
      p,
      '工作台正在处理上一项操作，请等待完成后再提交。',
    ),
    undefined,
  );
  assert.equal(requestAttention('get', { id: p.id }, p, 'error'), undefined);
  assert.ok(languageNotice('clarify_answers', p));
  assert.ok(languageNotice('analyze_brief', p));
  assert.equal(languageNotice('confirm_brief', p), undefined);
});
void test('one media lane alternates existing asset queries and authorized queue work across views', () => {
  const p = project();
  p.production!.library = [asset()];
  p.jobs = [job()];
  assert.deepEqual(nextMediaPoll(p, false), { action: 'poll' });
  assert.deepEqual(nextMediaPoll(p, true), {
    action: 'asset_poll',
    assetId: 'a1',
  });
  p.jobs[0].status = 'succeeded';
  assert.equal(nextMediaPoll(p, false)?.action, 'asset_poll');
  p.production!.library![0].status = 'ready';
  assert.equal(nextMediaPoll(p, false), undefined);
});
void test('browser observer deduplicates results, honors mute and survives denied desktop permission', async (t) => {
  const browser = new EventTarget() as EventTarget & {
    isSecureContext: boolean;
    Notification: unknown;
    focus: () => void;
  };
  browser.isSecureContext = true;
  browser.focus = () => {};
  const records = new Map<string, string>();
  let desktop = 0;
  class FakeNotification {
    static permission = 'granted';
    onclick?: () => void;
    constructor() {
      desktop++;
    }
    close() {}
  }
  browser.Notification = FakeNotification;
  const replace = (key: string, value: unknown) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else Reflect.deleteProperty(globalThis, key);
    });
  };
  replace('window', browser);
  replace('Notification', FakeNotification);
  replace('localStorage', {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  });
  const {
    recordStudioResult,
    saveNotificationPreferences,
    NOTICE_EVENT,
    recordStudioFailure,
  } = await import('../lib/studio/notification-client.ts');
  const seen: unknown[] = [];
  browser.addEventListener(NOTICE_EVENT, (e) =>
    seen.push((e as CustomEvent).detail),
  );
  saveNotificationPreferences({
    enabled: true,
    language: true,
    image: true,
    video: true,
  });
  const before = project();
  before.id = 'browser-observer';
  before.jobs = [job()];
  recordStudioResult('get', before);
  const next = structuredClone(before);
  next.updatedAt = 200;
  next.jobs[0].status = 'succeeded';
  next.jobs[0].outputUrl = 'https://example.com/a.mp4';
  recordStudioResult('poll', next);
  recordStudioResult('poll', next);
  const drain = async () => {
    for (let i = 0; i < 20 && seen.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
  };
  await drain();
  assert.equal(seen.length, 1);
  assert.equal(desktop, 1);
  saveNotificationPreferences({
    enabled: false,
    language: true,
    image: true,
    video: true,
  });
  const old = seen.length;
  recordStudioFailure(
    'asset_generate',
    { id: before.id, assetId: 'a1' },
    next.title + ' timeout',
  );
  for (let i = 0; i < 20 && seen.length === old; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(seen.length, 2);
  assert.equal(desktop, 1);
  const secondTab = await import(
    new URL('../lib/studio/notification-client.ts?second-tab', import.meta.url)
      .href
  );
  saveNotificationPreferences({
    enabled: true,
    language: true,
    image: true,
    video: true,
  });
  secondTab.recordStudioResult('get', before);
  secondTab.recordStudioResult('poll', next);
  for (let i = 0; i < 20 && seen.length === 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    seen.length,
    3,
    'other tab still receives its page notification',
  );
  assert.equal(desktop, 1, 'desktop result is not repeated across tabs');
  FakeNotification.permission = 'denied';
  saveNotificationPreferences({
    enabled: true,
    language: true,
    image: true,
    video: true,
  });
  next.updatedAt = 300;
  recordStudioResult('plan', next);
  for (let i = 0; i < 20 && seen.length === 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(seen.length, 4);
  assert.equal(desktop, 1);
  assert.doesNotThrow(() =>
    recordStudioResult('status', { runtimeBusy: false }),
  );
});

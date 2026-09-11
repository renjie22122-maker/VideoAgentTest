import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifactGraph, downstreamClosure, recordInvalidation, artifactManifest } from '../lib/studio/artifact-graph.ts';
import { invalidateFrom, demoPlan } from '../lib/studio/domain.ts';
import { invalidateAssetMedia } from '../lib/studio/asset-catalog.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Asset, Project } from '../lib/studio/types.ts';

const asset = (id: string, approved = true): Asset => ({
  id,
  name: '人物 ' + id,
  kind: 'character',
  prompt: '设计',
  referenceIds: [],
  version: 1,
  approved,
  status: 'ready',
  url: '/api/studio-images/00000000-0000-4000-8000-00000000000' + id.slice(-2) + '.png',
  createdAt: 0,
});

function project(): Project {
  const p: Project = {
    id: 'graph-test',
    revision: 1,
    idea: '雨中等车。',
    title: '雨',
    duration: 30,
    ratio: '16:9',
    mode: 'demo',
    phase: 'planned',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  };
  p.plan = demoPlan(p);
  p.production!.script = demoScreenplay(p);
  p.production!.scriptApproved = true;
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: false };
  const oldAsset = asset('asset-old', false);
  oldAsset.retired = true;
  p.production!.library = [asset('asset-renata', true), oldAsset];
  p.plan.shots[0].videoInput = { mode: 'references', assetIds: ['asset-renata'] };
  p.production!.prompts = p.plan.shots.slice(0, 2).map((s) => ({ shotId: s.id, prompt: '编译提示词' }));
  p.plan.shots[0].videoUrl = '/api/media/v1.mp4';
  p.plan.shots[0].videoMode = 'demo';
  p.production!.qa = [{ shotId: p.plan.shots[0].id, verdict: 'needs_review', source: 'demo', notes: '待审', attempt: 0 }];
  return p;
}

void test('the artifact graph links script → shots → prompts → videos → qa and archives retired assets', () => {
  const graph = buildArtifactGraph(project());
  const edges = (from: string, to: string, reason: string) =>
    graph.dependencies.some(
      (d) =>
        d.from.id === from &&
        d.from.kind === 'shot' &&
        d.to.id === to &&
        d.reason === reason,
    );
  assert.ok(graph.dependencies.some((d) => d.from.id === 'shot-1' && d.from.kind === 'shot' && d.to.id === 'script' && d.reason === 'depicts'));
  assert.ok(graph.dependencies.some((d) => d.from.id === 'shot-1' && d.from.kind === 'shot' && d.to.id === 'asset-renata' && d.reason === 'uses_reference'));
  assert.ok(graph.dependencies.some((d) => d.from.id === 'shot-1' && d.from.kind === 'prompt' && d.to.kind === 'shot' && d.reason === 'compiled_from'));
  assert.ok(graph.dependencies.some((d) => d.from.id === 'shot-1' && d.from.kind === 'video' && d.to.kind === 'prompt' && d.reason === 'generated_from'));
  assert.ok(graph.dependencies.some((d) => d.from.id === 'shot-1' && d.from.kind === 'qa' && d.to.kind === 'video' && d.reason === 'reviewed_by'));
  const nodes = new Map(graph.nodes.map((n) => [n.ref.kind + ':' + n.ref.id, n.status]));
  assert.equal(nodes.get('asset:asset-old'), 'archived');
  assert.equal(nodes.get('asset:asset-renata'), 'current');
  assert.ok(edges('shot-1', 'script', 'depicts'));
});

void test('downstream closure is transitive: asset → shot → prompt → video → qa', () => {
  const graph = buildArtifactGraph(project());
  const affected = downstreamClosure(graph, [{ id: 'asset-renata', kind: 'asset' }]);
  const keys = affected.map((r) => r.kind + ':' + r.id).sort();
  assert.deepEqual(keys, [
    'prompt:shot-1',
    'qa:shot-1',
    'shot:shot-1',
    'video:shot-1',
  ]);
});

void test('invalidateFrom records lineage without changing what it clears', () => {
  const p = project();
  const before = structuredClone(p);
  const mediaShot = p.plan!.shots[0];
  assert.ok(mediaShot.videoUrl);
  invalidateFrom(p, 0);
  assert.equal(p.revision, before.revision + 1);
  for (const shot of p.plan!.shots) {
    assert.equal(shot.videoUrl, undefined);
    assert.equal(shot.referenceUrl, undefined);
  }
  assert.equal(p.jobs.length, 0);
  const events = p.production!.artifactEvents!;
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changed.map((r) => r.id).slice(0, 1), ['shot-1']);
  const affected = events[0].affected.map((r) => r.kind + ':' + r.id);
  assert.ok(affected.includes('prompt:shot-1'));
  assert.ok(affected.includes('video:shot-1'));
  assert.ok(affected.includes('qa:shot-1'));
});

void test('invalidateAssetMedia keeps its guards and records the asset lineage', () => {
  const p = project();
  const p2 = project();
  const approved = p.production!.library![0];
  assert.equal(approved.approved, true);
  const ids = invalidateAssetMedia(p, approved);
  // Same-scene continuation propagation: every downstream shot in the scene is affected.
  assert.deepEqual(ids, p.plan!.shots.map((s) => s.id));
  assert.equal(p.plan!.shots[0].videoUrl, undefined);
  assert.ok(p.jobs.length === 0);
  const events = p.production!.artifactEvents!;
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changed, [{ id: 'asset-renata', kind: 'asset' }]);
  const affected = events[0].affected.map((r) => r.kind + ':' + r.id);
  assert.ok(affected.includes('shot:shot-1'));
  assert.ok(affected.includes('video:shot-1'));
  // Asset that no shot references: nothing to invalidate.
  p2.plan!.shots[0].videoInput = undefined;
  assert.deepEqual(invalidateAssetMedia(p2, p2.production!.library![0]), []);
});

void test('the invalidation ledger is append-only and bounded', () => {
  const p = project();
  for (let i = 0; i < 105; i++) recordInvalidation(p, [{ id: 'x' + i, kind: 'asset' }], []);
  assert.equal(p.production!.artifactEvents!.length, 100);
  assert.equal(p.production!.artifactEvents![0].changed[0].id, 'x5');
});

void test('the artifact manifest marks surviving downstream artifacts stale without deleting history', () => {
  const p = project();
  const before = buildArtifactGraph(p);
  const status = (kind: string, id: string) =>
    before.nodes.find((n) => n.ref.kind === kind && n.ref.id === id)!.status;
  assert.equal(status('video', 'shot-1'), 'current');
  // A recorded asset change makes every surviving downstream artifact stale.
  recordInvalidation(p, [{ id: 'asset-renata', kind: 'asset' }], []);
  const manifest = artifactManifest(p);
  const byKey = new Map(manifest.map((n) => [n.ref.kind + ':' + n.ref.id, n.status]));
  assert.equal(byKey.get('shot:shot-1'), 'stale');
  assert.equal(byKey.get('prompt:shot-1'), 'stale');
  assert.equal(byKey.get('video:shot-1'), 'stale');
  assert.equal(byKey.get('qa:shot-1'), 'stale');
  assert.equal(byKey.get('shot:shot-2'), 'current');
  assert.equal(byKey.get('asset:asset-old'), 'archived');
});

void test('artifact nodes carry version identity where evidence exists', () => {
  const p = project();
  p.production!.prompts![0].revision = 7;
  p.jobs.push({
    id: 'job-v1',
    shotId: 'shot-1',
    kind: 'video',
    status: 'succeeded',
    mode: 'demo',
    revision: 1,
    createdAt: 10,
    finishedAt: 2000,
  });
  const graph = buildArtifactGraph(p);
  const node = (kind: string, id: string) =>
    graph.nodes.find((n) => n.ref.kind === kind && n.ref.id === id)!;
  assert.equal(node('asset', 'asset-renata').version, 1);
  assert.equal(node('prompt', 'shot-1').version, 7);
  const video = node('video', 'shot-1');
  assert.equal(video.version, 1);
  assert.equal(video.producedAt, 2000, 'video producedAt comes from the succeeded job');
  assert.equal(node('qa', 'shot-1').version, 1);
});

void test('a video regenerated after the affecting event is current, not stale', () => {
  const p = project();
  const eventAt = 1000;
  recordInvalidation(p, [{ id: 'asset-renata', kind: 'asset' }], []);
  p.production!.artifactEvents![0].at = eventAt;
  // A succeeded regeneration job finished after the event: the new output
  // was produced from the new inputs.
  p.jobs.push({
    id: 'job-regenerated',
    shotId: 'shot-1',
    kind: 'video',
    status: 'succeeded',
    mode: 'demo',
    revision: p.revision,
    createdAt: 0,
    finishedAt: eventAt + 500,
  });
  const manifest = artifactManifest(p);
  const byKey = new Map(manifest.map((n) => [n.ref.kind + ':' + n.ref.id, n.status]));
  assert.equal(byKey.get('video:shot-1'), 'current');
  // Other surviving artifacts are still stale; history is untouched.
  assert.equal(byKey.get('prompt:shot-1'), 'stale');
  // An OLD finished job does not rescue the artifact.
  p.jobs[0].finishedAt = eventAt - 500;
  const again = artifactManifest(p);
  const byKey2 = new Map(again.map((n) => [n.ref.kind + ':' + n.ref.id, n.status]));
  assert.equal(byKey2.get('video:shot-1'), 'stale');
});

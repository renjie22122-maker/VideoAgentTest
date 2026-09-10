import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { uniqueAssetCandidates } from '../lib/studio/auto-progress.ts';
import { videoText } from '../lib/studio/video-text.ts';
import {
  assetReadiness,
  requireReadyAssets,
  usableAssets,
} from '../lib/studio/asset-policy.ts';
import {
  createUserAsset,
  appendNewAssets,
  updateAssetRequirement,
  invalidateAssetMedia,
} from '../lib/studio/asset-catalog.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Asset, Project, Job } from '../lib/studio/types.ts';
function project() {
  const p: Project = {
    id: 'policy-test',
    revision: 1,
    title: '资产测试',
    idea: '女孩先走过车站，再回到屋里。',
    duration: 24,
    ratio: '16:9',
    mode: 'live',
    phase: 'planned',
    createdAt: 0,
    updatedAt: 0,
    questions: [],
    answers: {},
    jobs: [],
    production: initialProduction(),
  };
  p.plan = demoPlan(p);
  p.plan.shots = p.plan.shots.slice(0, 3);
  p.plan.shots.forEach((s, i) => (s.scene = 'scene-' + (i + 1)));
  p.production!.script = demoScreenplay(p);
  p.production!.assets = { bible: p.plan.bible, seed: 42, locked: true };
  p.production!.node = 'generation';
  p.production!.scriptApproved = true;
  p.production!.renderApprovedRevision = 1;
  return p;
}
function asset(
  id: string,
  requirement: Asset['requirement'] = 'required',
  sceneIds = ['scene-1'],
): Asset {
  return {
    id,
    name: id,
    kind: 'prop',
    requirement,
    sceneIds,
    referenceIds: [],
    prompt: 'test',
    version: 1,
    approved: false,
    status: 'draft',
    createdAt: 0,
  };
}
function ready(a: Asset) {
  return Object.assign(a, {
    status: 'ready' as const,
    approved: true,
    url: 'https://example.com/' + a.id + '.png',
  });
}
function job(p: Project, shotId: string, more: Partial<Job> = {}): Job {
  return {
    id: 'j-' + shotId,
    shotId,
    kind: 'video',
    status: 'succeeded',
    mode: 'live',
    revision: p.revision,
    createdAt: 0,
    outputUrl: 'https://example.com/' + shotId + '.mp4',
    ...more,
  };
}
void test('only missing required families used in the shot block; optional details and candidates do not', () => {
  const p = project(),
    main = ready(asset('main')),
    later = asset('later', 'required', ['scene-2']);
  const draft = {
    ...main,
    id: 'v2',
    parentId: main.id,
    approved: false,
    status: 'draft' as const,
    url: undefined,
  };
  const detail = {
    ...draft,
    id: 'detail',
    viewId: 'side',
    sourceAssetId: main.id,
  };
  p.production!.library = [
    main,
    draft,
    detail,
    later,
    asset('street', 'recommended'),
    asset('decoration', 'optional'),
  ];
  assert.doesNotThrow(() => requireReadyAssets(p, ['shot-1']));
  assert.throws(() => requireReadyAssets(p, ['shot-2']), /later/);
  assert.deepEqual(
    usableAssets(p, 'shot-1').map((a) => a.id),
    ['main'],
  );
  assert.equal(assetReadiness(p).length, 4);
  updateAssetRequirement(p, later, { requirement: 'optional' });
  assert.doesNotThrow(() => requireReadyAssets(p, ['shot-2']));
});
void test('manual assets accept user provenance and new backgrounds without touching approved versions', () => {
  const p = project(),
    old = ready(asset('old'));
  p.production!.library = [old];
  const candidate = createUserAsset(p, {
    name: '梦中车库',
    kind: 'background',
    description: '无人地下空间，混凝土墙面，固定灯带',
    renderStyle: 'photographic',
    requirement: 'optional',
    sceneIds: [],
  });
  assert.equal(candidate.designOrigin, 'user');
  assert.ok(candidate.design);
  assert.equal(candidate.approved, false);
  assert.equal(candidate.url, undefined);
  appendNewAssets(p, [candidate, { ...candidate, id: 'duplicate' }]);
  assert.equal(p.production!.library.length, 2);
  assert.equal(p.production!.library[0], old);
  assert.throws(
    () =>
      createUserAsset(p, {
        name: 'bad',
        kind: 'prop',
        description: '银色扣环',
        renderStyle: 'photographic',
        requirement: 'optional',
        sceneIds: ['missing'],
      }),
    /场次/,
  );
  assert.equal(p.production!.node, 'generation');
  assert.equal(p.production!.renderApprovedRevision, 1);
});
void test('explicit cross-scene references invalidate linked media and QA, preserve uploads and unrelated recovery', () => {
  const p = project(),
    old = ready(asset('key')),
    next = ready({ ...old, id: 'new-key', parentId: old.id, version: 2 });
  old.approved = false;
  p.production!.library = [old, next];
  const [first, second, third] = p.plan!.shots;
  for (const s of p.plan!.shots) {
    s.referenceUrl = 'https://example.com/' + s.id + '.png';
    s.videoUrl = 'https://example.com/' + s.id + '.mp4';
    s.videoMode = 'live';
  }
  second.videoInput = { mode: 'references', assetIds: [old.id] };
  second.referenceOrigin = 'upload';
  p.production!.qa = [
    {
      shotId: second.id,
      verdict: 'passed',
      source: 'human',
      notes: 'ok',
      attempt: 0,
    },
  ];
  const pending = job(p, third.id, {
    status: 'failed',
    remoteId: 'fal-pending',
    outputUrl: undefined,
  });
  p.jobs = [job(p, first.id), job(p, second.id), pending];
  const affected = invalidateAssetMedia(p, next);
  assert.ok(affected.includes(second.id));
  assert.equal(second.videoUrl, undefined);
  assert.ok(second.referenceUrl);
  assert.deepEqual(second.videoInput.assetIds, [next.id]);
  assert.ok(third.videoUrl);
  assert.deepEqual(p.jobs[2], pending);
  assert.equal(p.revision, 1);
  assert.equal(p.production!.renderApprovedRevision, 1);
  assert.equal(p.production!.qa.length, 0);
  assert.equal(p.jobs[0].assetSuperseded, true);
});
void test('unknown paid submissions block replacing linked references before changing media state', () => {
  for (const extra of [
    { remoteId: 'fal-pending' },
    { remoteId: 'remote-known' },
    {
      longTake: {
        provider: 'minimax',
        model: 'test',
        phase: 'rendering',
        parts: [{ start: 0, end: 8, requestSeconds: 8, submitted: true }],
      },
    },
  ] as Partial<Job>[]) {
    const p = project(),
      a = ready(asset('key'));
    p.production!.library = [a];
    p.jobs = [
      job(p, 'shot-1', { ...extra, status: 'cancelled', outputUrl: undefined }),
    ];
    const before = JSON.stringify(p);
    assert.throws(() => invalidateAssetMedia(p, a), /提交结果未知或未收回/);
    assert.equal(JSON.stringify(p), before);
  }
});
void test('reference replacement invalidates a shared group and keeps unrelated scenes', () => {
  const p = project(),
    a = ready(asset('key'));
  p.production!.library = [a];
  p.production!.node = 'assembly';
  p.plan!.shots.forEach(
    (s) => (s.videoUrl = 'https://example.com/' + s.id + '.mp4'),
  );
  p.jobs = [
    job(p, 'shot-1', {
      group: {
        shots: structuredClone(p.plan!.shots.slice(0, 2)),
        assetIds: [a.id],
        duration: 12,
      },
    }),
  ];
  invalidateAssetMedia(p, a);
  assert.equal(p.plan!.shots[1].videoUrl, undefined);
  assert.ok(p.plan!.shots[2].videoUrl);
  assert.equal(p.production!.node, 'generation');
  assert.equal(p.production!.scriptApproved, true);
});
void test('asset API appends during later production and supplemental design never retires approved references', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-policy-'));
  const old = {
    STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    STUDIO_DATA_DIR: dir,
    LLM_BASE_URL: 'https://asset-policy.invalid/v1',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'test',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const p = project(),
    a = ready(asset('existing'));
  p.production!.library = [a];
  p.plan!.shots[0].description += ' 银色指环';
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([p]));
  const { dispatch } = await import('../lib/studio/server.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                assets:
                  calls === 1
                    ? [
                        {
                          kind: 'prop',
                          name: '银色指环',
                          evidence: '银色指环',
                          description: '银色窄环，光滑金属',
                          renderStyle: 'photographic',
                          colors: [],
                          lighting: '',
                          requirement: 'optional',
                          sceneIds: [],
                        },
                      ]
                    : [],
              }),
            },
          },
        ],
      }),
    );
  });
  let updated = (await dispatch({
    action: 'asset_add',
    id: p.id,
    revision: 1,
    asset: {
      kind: 'background',
      name: '走廊',
      description: '空旷长廊，石灰墙面',
      renderStyle: 'photographic',
      requirement: 'recommended',
      sceneIds: [],
    },
  })) as Project;
  assert.equal(calls, 0);
  assert.equal(updated.production!.node, 'generation');
  assert.deepEqual(updated.production!.library![0], a);
  updated = (await dispatch({
    action: 'asset_supplement',
    id: p.id,
    revision: 1,
  })) as Project;
  assert.equal(calls, 1);
  assert.equal(updated.production!.library!.length, 3);
  assert.equal(updated.production!.library![0].approved, true);
  assert.ok(!updated.production!.library![0].retired);
  assert.equal(updated.production!.renderApprovedRevision, 1);
  updated = (await dispatch({
    action: 'asset_supplement',
    id: p.id,
    revision: 1,
  })) as Project;
  assert.equal(updated.production!.library!.length, 3);
  const snapshot = await readFile(path.join(dir, 'projects.json'), 'utf8');
  await assert.rejects(
    dispatch({
      action: 'asset_add',
      id: p.id,
      revision: 1,
      asset: {
        kind: 'prop',
        name: 'bad',
        description: '测试',
        renderStyle: 'photographic',
        requirement: 'illegal',
      },
    }),
    /等级/,
  );
  assert.equal(
    await readFile(path.join(dir, 'projects.json'), 'utf8'),
    snapshot,
  );
});

void test('new art designs keep the same family and respect the existing user requirement', () => {
  const p = project(),
    original = ready({
      ...asset('main', 'optional'),
      design: {
        description: '金色手镯',
        renderStyle: 'photographic' as const,
        colors: [],
        lighting: '',
      },
    });
  const change = {
    ...original,
    id: 'new-design',
    requirement: 'required' as const,
    design: { ...original.design!, description: '金色手镯，圆形接扣' },
  };
  const candidates = uniqueAssetCandidates([change], [original]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].parentId, original.id);
  assert.equal(candidates[0].requirement, 'optional');
  p.production!.library = [original, ...candidates];
  assert.equal(assetReadiness(p).length, 1);
  assert.equal(assetReadiness(p)[0].chosen?.id, original.id);
});
void test('nonessential missing references still contribute their design to native video prompts', () => {
  const p = project();
  const missing = {
    ...asset('梦中车辆', 'recommended'),
    design: {
      description: '暗红色复古双门跑车，湿润漆面',
      renderStyle: 'photographic' as const,
      colors: ['#882222'],
      lighting: '',
    },
  };
  p.production!.library = [missing];
  const prompt = JSON.parse(videoText(p, p.plan!.shots[0]));
  assert.equal(
    prompt.未附图资产的文字设定[0].可见设计,
    missing.design.description,
  );
  assert.equal(prompt.未附图资产的文字设定[0].参考图等级, 'recommended');
  assert.doesNotThrow(() => requireReadyAssets(p, ['shot-1']));
});

void test('inherited approved variants retain family requirements without reviving archived images', () => {
  const p=project(), root={...asset('金属扣环'), retired:true}, chosen=ready({...asset('chosen'),kind:'variant' as const,parentId:root.id});
  const dead={...asset('archived'), retired:true};
  p.production!.library=[root,chosen,dead];
  assert.equal(assetReadiness(p).length,1);
  assert.deepEqual(usableAssets(p).map(a=>a.id),[chosen.id]);
  assert.doesNotThrow(()=>requireReadyAssets(p,['shot-1']));
  assert.equal(appendNewAssets(p,[{...root,id:'duplicate',retired:false}]).length,0);
  assert.throws(()=>createUserAsset(p,{kind:'prop',name:root.name,description:'圆形金属扣环',renderStyle:'photographic',requirement:'required'}),/同名资产/);
  updateAssetRequirement(p,chosen,{requirement:'optional'});
  assert.equal(assetReadiness(p)[0].requirement,'optional');
  assert.equal(root.retired,true);
  const replacement=uniqueAssetCandidates([{...asset(root.name),id:'new-design',prompt:'changed'}],p.production!.library);
  assert.equal(replacement[0].parentId,root.id);
  assert.equal(replacement[0].requirement,'optional');
});

void test('replacing references starts a fresh clip job without resuming superseded long takes or resetting unrelated recovery', async t => {
  const oldDir=process.env.STUDIO_DATA_DIR, dir=await mkdtemp(path.join(tmpdir(),'asset-recovery-'));
  process.env.STUDIO_DATA_DIR=dir;
  t.after(()=>{if(oldDir===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=oldDir;});
  const p=project();p.mode='demo';
  p.plan!.shots.forEach(s=>s.videoInput={mode:'text'});
  const count=p.production!.maxRetries+1;
  p.jobs=Array.from({length:count},(_,i)=>job(p,'shot-1',{
    id:'old-'+i,status:'cancelled',assetSuperseded:true,
    longTake:{provider:'minimax',model:'test',phase:'rendering',parts:[{start:0,end:8,requestSeconds:8,submitted:true,remoteId:'old-id',outputUrl:'https://example.com/old.mp4'}]},
  }));
  const unresolved=job(p,'shot-2',{status:'failed',remoteId:'fal-pending',outputUrl:undefined});
  p.jobs.push(unresolved);
  await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));
  const {dispatch}=await import(new URL('../lib/studio/server.ts?asset-recovery-test',import.meta.url).href);
  const updated=await dispatch({action:'enqueue',id:p.id,revision:1,kind:'video',shotId:'shot-1'}) as Project;
  const fresh=updated.jobs.at(-1)!;
  assert.equal(fresh.status,'queued');
  assert.equal(fresh.longTake,undefined);
  assert.equal(fresh.assetSuperseded,undefined);
  assert.equal(updated.revision,1);
  assert.equal(updated.jobs.length,count+2);
  const before=await readFile(path.join(dir,'projects.json'),'utf8');
  await assert.rejects(dispatch({action:'enqueue',id:p.id,revision:1,kind:'video',shotId:'shot-2'}),/提交结果未知/);
  assert.equal(await readFile(path.join(dir,'projects.json'),'utf8'),before);
});
void test('next act inherits chosen variants and resets previous act scene restrictions', async t=>{
  const oldDir=process.env.STUDIO_DATA_DIR,dir=await mkdtemp(path.join(tmpdir(),'asset-act-'));
  process.env.STUDIO_DATA_DIR=dir;
  t.after(()=>{if(oldDir===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=oldDir;});
  const p=project();p.mode='demo';
  const root=asset('女主角','required',['scene-3']);root.kind='character';
  const main=ready({...root,id:'selected',kind:'variant' as const,parentId:root.id});
  p.production!.library=[root,main];
  await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));
  const {dispatch}=await import(new URL('../lib/studio/server.ts?asset-next-act-test',import.meta.url).href);
  const next=await dispatch({action:'story_next',id:p.id,revision:1,idea:'女主角来到新车站',duration:24}) as Project;
  assert.notEqual(next.id,p.id);
  assert.equal(next.production!.library![0].retired,true);
  assert.equal(next.production!.library![0].sceneIds,undefined);
  assert.deepEqual(usableAssets(next).map(a=>a.id),[main.id]);
  const persisted=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8')) as Project[];
  assert.deepEqual(persisted.find(item=>item.id===p.id)!.production!.library![0].sceneIds,['scene-3']);
});

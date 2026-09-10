import { createHash } from 'node:crypto';
import type { Asset, Project } from './types.ts';
import { activeAssetRoots, assetRequirementManifest, assetRoot } from './asset-policy.ts';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

/** Content identity deliberately excludes timestamps, revision numbers, reports and media outputs. */
export function contentFingerprint(p: Project) {
  const production = p.production;
  const shots = p.plan?.shots.map(({ referenceOrigin: _origin, referenceFilename: _filename, referenceUrl: _reference, videoUrl: _video, referenceMode: _referenceMode, videoMode: _videoMode, ...shot }) => shot);
  const content = {
    idea: p.idea, answers: p.answers, brief: p.brief, duration: p.duration,
    ratio: p.ratio, storyContext: p.storyContext, script: production?.script,
    scriptApproved: production?.scriptApproved, bible: production?.assets?.bible,
    shots, assetPolicy: assetRequirementManifest(p).map(({id,requirement,reason,sceneIds})=>({id,requirement,reason,sceneIds})), library: production?.library?.filter(a => !a.retired).map(a => ({
      id: a.id, kind: a.kind, name: a.name, design: a.design, prompt: a.prompt,
      requirement:a.requirement,requirementReason:a.requirementReason,sceneIds:a.sceneIds,approved: a.approved, parentId: a.parentId, viewId: a.viewId, costumeOf: a.costumeOf,
    })),
  };
  return createHash('sha256').update(JSON.stringify(stable(content))).digest('hex');
}

export function sameScript(a: unknown, b: unknown) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function uniqueAssetCandidates(assets: Asset[], library: Asset[]) {
  const key = (a: Asset) => JSON.stringify(stable({ kind: assetRoot(a,library).kind, name: a.name.trim(), design: a.design ?? a.prompt, viewId: a.viewId, costumeOf: a.costumeOf }));
  const seen = new Set(library.filter(a => !a.retired).map(key));
  return assets.filter(a => {
    const value = key(a);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map(a => {
    const family=activeAssetRoots(library).find(v=>v.kind===a.kind&&v.name.trim()===a.name.trim());
    return { ...a,...(family?{parentId:family.id,requirement:family.requirement,requirementReason:family.requirementReason,sceneIds:family.sceneIds,version:Math.max(...library.filter(v=>v.id===family.id||v.parentId===family.id).map(v=>v.version))+1}:{}),approved: false, status: 'draft' as const, url: undefined, remoteId: undefined };
  });
}

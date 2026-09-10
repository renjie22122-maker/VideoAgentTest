import { validateAssetDesigns } from './asset-design.ts';
import {
  activeAssetRoots,
  assetAppliesToShot,
  assetReadiness,
  assetRoot,
  assetRequirementLabels,
} from './asset-policy.ts';
import { text } from './domain.ts';
import { transition } from './graph.ts';
import { referencePredecessor } from './narrative.ts';
import { buildArtifactGraph, downstreamClosure, recordInvalidation } from './artifact-graph.ts';
import type { Asset, Project } from './types.ts';
const identity = (a: Pick<Asset, 'kind' | 'name'>) =>
  a.kind + ':' + a.name.normalize('NFKC').trim().toLowerCase();
export function appendNewAssets(p: Project, additions: Asset[]) {
  const library = (p.production!.library ??= []);
  const seen = new Set(
    activeAssetRoots(library).map(identity),
  );
  const fresh = additions.filter((a) => {
    const id = identity(a);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (library.length + fresh.length > 160)
    throw new Error('资产版本已达到 160 个上限。');
  library.push(...fresh);
  return fresh;
}
export function createUserAsset(p: Project, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('请填写资产信息。');
  const data = raw as Record<string, unknown>,
    description = text(data.description, '可见设计', 1600);
  const a = validateAssetDesigns(
    {
      assets: [
        {
          ...data,
          evidence: description.slice(0, 300),
          colors: [],
          lighting:
            data.lighting ?? '沿用本片环境光源、色温与方向，空间均匀照明',
        },
      ],
    },
    p,
    { sources: [description] },
  )[0];
  a.designOrigin = 'user';
  const library = p.production?.library ?? [];
  if (
    activeAssetRoots(library).some(v => identity(v) === identity(a))
  )
    throw new Error('同名资产已存在，请在原资产上创建新候选。');
  return a;
}
export function updateAssetRequirement(p: Project, asset: Asset, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('资产等级设置无效。');
  const data = raw as Record<string, unknown>;
  if (
    typeof data.requirement !== 'string' ||
    !Object.hasOwn(assetRequirementLabels, data.requirement)
  )
    throw new Error('资产等级无效。');
  if (
    data.sceneIds !== undefined &&
    (!Array.isArray(data.sceneIds) ||
      data.sceneIds.some(
        (id) =>
          typeof id !== 'string' ||
          !p.production?.script?.scenes?.some((s) => s.id === id),
      ))
  )
    throw new Error('资产关联了不存在的场次。');
  const root = assetRoot(asset, p.production!.library!);
  root.requirement = data.requirement as Asset['requirement'];
  if (data.sceneIds !== undefined)
    root.sceneIds = [...new Set(data.sceneIds as string[])];
  if (data.requirementReason !== undefined)
    root.requirementReason = text(data.requirementReason, '等级说明', 400);
}
/** An approved reference changes media dependencies, not the confirmed screenplay. */
export function invalidateAssetMedia(p: Project, asset: Asset) {
  if (!p.plan || asset.viewId) return [];
  // Lineage snapshot before media is cleared below.
  const beforeGraph = buildArtifactGraph(p);
  const root = assetRoot(asset, p.production?.library ?? []);
  if (!assetReadiness(p).some((a) => a.root.id === root.id)) return [];
  const ids = new Set(
    p.plan.shots.filter((s) => assetAppliesToShot(p, root, s)).map((s) => s.id),
  );
  if (!ids.size) return [];
  // Grouped outputs and explicit image predecessors are shared dependencies.
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of p.jobs)
      if (j.group?.shots.some((s) => ids.has(s.id)))
        for (const s of j.group.shots)
          if (!ids.has(s.id)) {
            ids.add(s.id);
            changed = true;
          }
    p.plan.shots.forEach((s, i) => {
      const prev = referencePredecessor(p.plan!.shots, i);
      if (
        prev &&
        prev.scene === s.scene &&
        ids.has(prev.id) &&
        !ids.has(s.id) &&
        s.referenceOrigin !== 'upload'
      ) {
        ids.add(s.id);
        changed = true;
      }
    });
  }
  const pending = p.jobs.find(
    (j) =>
      (ids.has(j.shotId) || j.group?.shots.some((s) => ids.has(s.id))) &&
      (j.remoteId === 'fal-pending' ||
        (j.remoteId && !j.outputUrl && j.status !== 'succeeded') ||
        j.longTake?.parts.some(
          (part) =>
            (part.submitted && !part.remoteId) ||
            (part.remoteId && !part.outputUrl && !part.failed),
        )),
  );
  if (pending)
    throw new Error(
      '关联镜头仍有提交结果未知或未收回的任务，请先恢复查询并核对结果，再替换参考资产。停止本地跟踪不代表供应商已取消。',
    );
  for (const s of p.plan.shots) {
    if (
      s.videoInput?.assetIds?.some((id) =>
        (p.production?.library ?? []).some(
          (a) =>
            a.id === id && assetRoot(a, p.production!.library!).id === root.id,
        ),
      )
    ) {
      s.videoInput.assetIds = [
        ...new Set(
          s.videoInput.assetIds.map((id) => {
            const a = p.production!.library!.find((a) => a.id === id);
            return a && assetRoot(a, p.production!.library!).id === root.id
              ? asset.id
              : id;
          }),
        ),
      ];
    }
  }
  for (const s of p.plan.shots)
    if (ids.has(s.id)) {
      if (s.referenceOrigin !== 'upload') {
        delete s.referenceUrl;
        delete s.referenceMode;
      }
      delete s.videoUrl;
      delete s.videoMode;
    }
  p.jobs = p.jobs.map((j) =>
    ids.has(j.shotId) || j.group?.shots.some((s) => ids.has(s.id))
      ? {
          ...j,
          assetSuperseded: true,
          status: 'cancelled' as const,
          error: '关联参考资产已更新，旧生成记录保留，请重新生成本镜。',
        }
      : j,
  );
  const g = p.production!; // Reference changes keep the text revision and unrelated recovery records intact.
  g.qa = g.qa.filter((q) => !ids.has(q.shotId));
  delete g.editPlan;
  if (['qa', 'assembly', 'complete'].includes(g.node))
    transition(
      p,
      'generation',
      '参考资产已更新，返回相关镜头生成；已确认剧本和分镜保留。',
    );
  g.events.push({
    at: Date.now(),
    node: g.node,
    role: '美术',
    message:
      '已更新 ' +
      root.name +
      '，' +
      ids.size +
      ' 个关联/接续镜头的旧媒体已归档；其他镜头保留。',
  });
  // Lineage: the graph-derived downstream closure plus the operational shot set.
  const changedRefs = [{ id: asset.id, kind: 'asset' as const }];
  const affectedRefs = [
    ...downstreamClosure(beforeGraph, changedRefs),
    ...[...ids].map((id) => ({ id, kind: 'shot' as const })),
  ].filter(
    (ref, i, all) => all.findIndex((r) => r.id === ref.id && r.kind === ref.kind) === i,
  );
  recordInvalidation(p, changedRefs, affectedRefs);
  return [...ids];
}

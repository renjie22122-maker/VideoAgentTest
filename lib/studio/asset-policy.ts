import type { Asset, Project, Shot } from './types.ts';
export type AssetRequirement = 'required' | 'recommended' | 'optional';
export const assetRequirementLabels = {
  required: '不可或缺',
  recommended: '建议增加',
  optional: '可选',
} as const;
export const ASSET_POLICY_GUIDE =
  '资产 requirement 表示参考图依赖等级：required=不可或缺，缺已确认主图仅阻断涉及场次的媒体生成；recommended=建议增加；optional=可选。推荐或可选缺图仅记 note，不阻止分镜、提示词或生成，不得为了避开缺图删改已确认剧情。文字设计与图像就绪分开；未出图不得声称外观已经核验。可按最新分镜增量补充资产，旧批准版本保留；独立细节图和整套审核是可选完善项。';
export function assetRoot(asset: Asset, library: Asset[]) {
  return library.find((a) => a.id === (asset.parentId ?? asset.id)) ?? asset;
}
/** Retired root records still describe active approved variants inherited by another act. */
export function activeAssetRoots(library: Asset[]) {
  return library.filter(root => !root.parentId && !root.viewId && root.kind !== 'variant' &&
    (!root.retired || library.some(a => a.parentId === root.id && !a.retired && !a.viewId)));
}
export function assetRequirement(
  asset: Asset,
  library: Asset[] = [],
): AssetRequirement {
  const root = assetRoot(asset, library);
  return (
    root.requirement ?? (root.kind === 'character' ? 'required' : 'recommended')
  );
}
export function assetAppliesToShot(p: Project, asset: Asset, shot: Shot) {
  const library = p.production?.library ?? [],
    root = assetRoot(asset, library);
  const identity = library.find((a) => a.id === root.costumeOf) ?? root;
  const scene = p.production?.script?.scenes?.find((s) => s.id === shot.scene);
  const visible = JSON.stringify({
    description: shot.description,
    start: shot.startState,
    end: shot.endState,
    design: shot.intent,
  });
  if (
    shot.videoInput?.assetIds?.some((id) => {
      const ref = library.find((a) => a.id === id);
      return ref && assetRoot(ref, library).id === root.id;
    })
  )
    return true;
  if (root.sceneIds !== undefined)
    return !root.sceneIds.length || root.sceneIds.includes(shot.scene);
  if (!scene && root.kind !== 'prop') return true; // Legacy projects lack scene membership; keep their approved references available.
  if (root.kind === 'background')
    return (
      root.name === scene?.location ||
      root.evidence === scene?.location ||
      visible.includes(root.name)
    );
  if (root.kind === 'character')
    return (
      visible.includes(identity.name) ||
      (p.production?.script?.characters ?? []).some(
        (c) => c.name === identity.name && scene?.characters.includes(c.id),
      )
    );
  return visible.includes(root.name);
}
export function assetReadiness(p: Project, shotIds?: string[]) {
  const library = p.production?.library ?? [];
  const shots =
    p.plan?.shots.filter((s) => !shotIds || shotIds.includes(s.id)) ?? [];
  return activeAssetRoots(library)
    .filter((root) => {
      const selected =
        p.production?.costumeSelections?.[root.costumeOf ?? root.id];
      return root.costumeOf
        ? selected === root.id
        : !selected || selected === root.id;
    })
    .filter(
      (root) => !shotIds || shots.some((s) => assetAppliesToShot(p, root, s)),
    )
    .map((root) => {
      const chosen = library.findLast(
        (a) =>
          !a.retired &&
          !a.viewId &&
          (a.id === root.id || a.parentId === root.id) &&
          a.approved &&
          a.status === 'ready' &&
          !!a.url,
      );
      return {
        root,
        chosen,
        requirement: assetRequirement(root),
        ready: !!chosen,
        shotIds: shots
          .filter((s) => assetAppliesToShot(p, root, s))
          .map((s) => s.id),
      };
    });
}
export function assetRequirementManifest(p: Project, shotIds?: string[]) {
  return assetReadiness(p, shotIds).map(
    ({ root, chosen, requirement, ready, shotIds }) => ({
      id: root.id,
      name: root.name,
      kind: root.kind,
      requirement,
      reason: root.requirementReason,
      sceneIds: root.sceneIds,
      shotIds,
      ready,
      selectedVersion: chosen?.version,
      design: chosen?.design ?? root.design,
    }),
  );
}
export function requiredAssetIssues(p: Project, shotIds?: string[]) {
  return assetReadiness(p, shotIds)
    .filter((a) => a.requirement === 'required' && !a.ready)
    .map(
      (a) =>
        '不可或缺的参考资产尚未确认：' +
        a.root.name +
        '。请补图并确认，或由用户调整该资产等级。',
    );
}
export function requireReadyAssets(p: Project, shotIds?: string[]) {
  const issues = requiredAssetIssues(p, shotIds);
  if (issues.length) throw new Error(issues.join(' '));
}
export function usableAssets(p: Project, shotId?: string) {
  return assetReadiness(p, shotId ? [shotId] : undefined).flatMap((a) =>
    a.chosen ? [a.chosen] : [],
  );
}

/** Text fallback is explicit; it never pretends an absent reference image exists. */
export function assetFallbackDesigns(p: Project, shotIds: string[]) {
  return assetReadiness(p, shotIds)
    .filter((a) => !a.ready && a.requirement !== 'required')
    .map(({ root, requirement }) => ({
      名称: root.name,
      类型: root.kind,
      参考图等级: requirement,
      可见设计: root.design?.description ?? root.name,
      表现方式: root.design?.renderStyle,
      配色: root.design?.colors,
      环境光照: root.kind === 'background' ? root.design?.lighting : undefined,
      执行: '暂无已确认参考图，按文字设计与全片风格生成，不省略已确认剧情中的实体。',
    }));
}

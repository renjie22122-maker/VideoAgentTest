'use client';
import { useState } from 'react';
import type { Asset, Project } from '@/lib/studio/types';
import {
  assetReadiness,
  assetRequirement,
  assetRoot,
  assetRequirementLabels,
  type AssetRequirement,
} from '@/lib/studio/asset-policy';
import { Button } from './ui/button';
type Act = (action: string, data?: Record<string, unknown>) => Promise<unknown>;
export function AssetReadinessNotice({
  project,
  shotId,
}: {
  project: Project;
  shotId?: string;
}) {
  const rows = assetReadiness(project, shotId ? [shotId] : undefined),
    missing = rows.filter((r) => !r.ready),
    required = missing.filter((r) => r.requirement === 'required');
  return (
    <div className="asset-prompt-card">
      <strong>参考资产准备</strong>
      <p>
        {Object.entries(assetRequirementLabels)
          .map(([level, label]) => {
            const group = rows.filter((r) => r.requirement === level);
            return (
              label +
              ' ' +
              group.filter((r) => r.ready).length +
              '/' +
              group.length
            );
          })
          .join(' · ')}
      </p>
      {missing.length > 0 && (
        <p>
          {required.length
            ? '缺少不可或缺参考图：' +
              required.map((r) => r.root.name).join('、') +
              '。仅涉及这些资产的镜头生成受限。'
            : '不可或缺的参考资产已就绪。'}
          {missing.some((r) => r.requirement !== 'required')
            ? ' 未准备的建议/可选资产不会阻止继续，可按文字设定生成。'
            : ''}
        </p>
      )}
      {shotId &&
        missing.filter((r) => r.requirement !== 'required').length > 0 && (
          <p>
            本镜可后补：
            {missing
              .filter((r) => r.requirement !== 'required')
              .map((r) => r.root.name)
              .join('、')}
          </p>
        )}
    </div>
  );
}
export function AssetCatalogControls({
  project,
  busy,
  act,
}: {
  project: Project;
  busy: boolean;
  act: Act;
}) {
  const [name, setName] = useState(''),
    [kind, setKind] = useState('prop'),
    [description, setDescription] = useState(''),
    [requirement, setRequirement] = useState<AssetRequirement>('recommended'),
    [scene, setScene] = useState(''),
    [style, setStyle] = useState(
      /动画|三维/.test(project.production?.assets?.bible.style ?? '')
        ? 'animation'
        : /插画|绘画/.test(project.production?.assets?.bible.style ?? '')
          ? 'illustration'
          : 'photographic',
    );
  return (
    <>
      <AssetReadinessNotice project={project} />
      <p className="help">
        不可或缺：涉及它的镜头生成前须有已确认主图。建议增加 /
        可选：缺图仍可继续。文字分镜不要求先把图片做齐；细节视角和整套审核可按需补充。旧资产未分级时，人物默认不可或缺，场景和道具默认建议增加。
      </p>
      <details className="asset-prompt-card">
        <summary>快速补充一个资产（不调用模型）</summary>
        <div className="form-grid">
          <label>
            资产名称
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            类型
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="character">人物</option>
              <option value="background">场景</option>
              <option value="prop">道具</option>
            </select>
          </label>
          <label>
            参考图等级
            <select
              value={requirement}
              onChange={(e) =>
                setRequirement(e.target.value as AssetRequirement)
              }
            >
              {Object.entries(assetRequirementLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            用于哪一场
            <select value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">全片</option>
              {project.production?.script?.scenes?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.location}
                </option>
              ))}
            </select>
          </label>
          <label>
            表现风格
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="photographic">写实摄影</option>
              <option value="animation">三维动画</option>
              <option value="illustration">绘画插图</option>
            </select>
          </label>
        </div>
        <label>
          可见设计
          <textarea
            value={description}
            maxLength={1600}
            placeholder="只描述这个资产的外观、结构和材质。人物或道具不混入背景、天气或剧情动作。"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <Button
          disabled={busy || !name.trim() || !description.trim()}
          onClick={async () => {
            const result = await act('asset_add', {
              asset: {
                name,
                kind,
                description,
                requirement,
                sceneIds: scene ? [scene] : [],
                renderStyle: style,
              },
            });
            if (result) {
              setName('');
              setDescription('');
            }
          }}
        >
          新增资产并编译设定图提示词
        </Button>
        <p className="help">
          只建立文字候选；随后可上传自己的图或点击生成。已有分镜和批准版本保留。
        </p>
      </details>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void act('asset_supplement')}
      >
        从最新分镜查漏补缺
        {project.mode === 'live' ? '（语言模型计费，不生图）' : '（演示）'}
      </Button>
      <p className="help">只追加尚未登记的资产，已有同名资产和批准版本保留。</p>
    </>
  );
}
export function AssetRequirementControl({
  asset,
  project,
  busy,
  act,
}: {
  asset: Asset;
  project: Project;
  busy: boolean;
  act: Act;
}) {
  const library = project.production?.library ?? [],
    root = assetRoot(asset, library);
  if (asset.viewId)
    return <p className="help">可选细节参考，缺少不影响已确认主图的使用。</p>;
  return (
    <div className="form-grid">
      <label>
        参考图等级
        <select
          disabled={busy}
          value={assetRequirement(asset, library)}
          onChange={(e) =>
            void act('asset_requirement', {
              assetId: asset.id,
              asset: { requirement: e.target.value },
            })
          }
        >
          {Object.entries(assetRequirementLabels).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        适用范围
        <select
          disabled={busy}
          value={
            root.sceneIds === undefined
              ? 'auto'
              : root.sceneIds.length === 1
                ? root.sceneIds[0]
                : root.sceneIds.length
                  ? 'multiple'
                  : 'all'
          }
          onChange={(e) =>
            void act('asset_requirement', {
              assetId: asset.id,
              asset: {
                requirement: assetRequirement(asset, library),
                sceneIds: e.target.value === 'all' ? [] : [e.target.value],
              },
            })
          }
        >
          {root.sceneIds === undefined && (
            <option value="auto" disabled>
              按姓名 / 场次自动匹配
            </option>
          )}
          {root.sceneIds && root.sceneIds.length > 1 && (
            <option value="multiple" disabled>
              {root.sceneIds.join('、')}
            </option>
          )}
          <option value="all">全片</option>
          {project.production?.script?.scenes?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} · {s.location}
            </option>
          ))}
        </select>
      </label>
      {root.requirementReason && (
        <p className="help">等级依据：{root.requirementReason}</p>
      )}
    </div>
  );
}

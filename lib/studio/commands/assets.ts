import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appendNewAssets,
  createUserAsset,
  updateAssetRequirement,
  invalidateAssetMedia,
} from '../asset-catalog.ts';
import { validateBible, invalidateFrom } from '../domain.ts';
import { reopenStoryboard } from '../graph.ts';
import { saveAssetUpload } from '../asset-upload.ts';
import { validateAssetDesigns } from '../asset-design.ts';
import {
  createAssetViews,
  createCostumeSet,
  createPropState,
  reviewAssetSet,
  selectCostume,
  rebuildAsset,
  variant,
  startAsset,
  updateAsset,
} from '../assets.ts';
import { planAssetLibrary } from '../providers.ts';
import { recordApproval } from '../approvals.ts';
import { bump, studioRoot } from './shared.ts';
import type { CommandHandler } from './shared.ts';

/** Asset library: append-only candidates, generation tracking, approval and sets. */
export const assetHandler: CommandHandler = {
  action: 'asset',
  matches: (input) => input.action?.startsWith('asset_') ?? false,
    async run(ctx) {
      const { project: p, input, save } = ctx;
      if (!p!.production?.assets) throw new Error('请先确认剧本与美术设定。');
      const appendOnly = [
        'asset_add',
        'asset_supplement',
        'asset_requirement',
        'asset_poll',
        'asset_abandon',
      ].includes(input.action!);
      if (!appendOnly && p!.jobs.some((j) => j.status === 'running' || j.status === 'queued'))
        throw new Error('请先完成或停止分镜生成队列。');
      const library = p!.production.library ?? [];
      if (
        !appendOnly &&
        library.some((a) => a.status === 'running') &&
        !['asset_poll', 'asset_abandon'].includes(input.action!)
      )
        throw new Error('请先完成或停止正在生成的资产。');
      if (input.action === 'asset_add') {
        appendNewAssets(p!, [createUserAsset(p!, input.asset)]);
        p!.production.events.push({
          at: Date.now(),
          node: p!.production.node,
          role: '用户',
          message: '快速补充文字资产，已保留原分镜、参考图和批准状态。',
        });
      } else if (input.action === 'asset_supplement') {
        const additions = await planAssetLibrary(p!, { supplement: true });
        const fresh = appendNewAssets(p!, additions);
        p!.production.events.push({
          at: Date.now(),
          node: p!.production.node,
          role: '美术',
          message:
            '按最新剧本与分镜补充 ' +
            fresh.length +
            ' 项新资产候选，旧版本保留；未生成图片。',
        });
      } else if (input.action === 'asset_save_bible') {
        const bible = validateBible(input.bible);
        const additions = await planAssetLibrary({
          ...p!,
          production: { ...p!.production, assets: { ...p!.production.assets, bible } },
        });
        if (library.length + additions.length > 160)
          throw new Error('资产版本已达到 160 个上限，请新建作品。');
        p!.production.assets.bible = bible;
        for (const a of library) {
          a.approved = false;
          a.retired = true;
        }
        if (p!.plan) {
          p!.plan.bible = bible;
          invalidateFrom(p!, 0);
          reopenStoryboard(p!);
        } else p!.revision++;
        p!.production.library = [...library, ...additions];
      } else if (input.action === 'asset_inventory' || input.action === 'asset_refresh_inventory') {
        if (!library.length || input.action === 'asset_refresh_inventory') {
          const additions = await planAssetLibrary(p!);
          if (library.length + additions.length > 160)
            throw new Error('资产版本已达到 160 个上限。');
          for (const a of library) {
            a.retired = true;
            a.approved = false;
          }
          p!.production.library = [...library, ...additions];
          if (p!.plan) {
            invalidateFrom(p!, 0);
            reopenStoryboard(p!);
          } else p!.revision++;
        }
      } else {
        const asset = library.find((a) => a.id === input.assetId);
        if (!asset) throw new Error('资产不存在。');
        if (asset.retired) throw new Error('这是旧设定下的归档资产，请使用新候选。');
        if (input.action === 'asset_requirement') {
          updateAssetRequirement(p!, asset, input.asset);
        } else if (input.action === 'asset_upload') {
          if (asset.status !== 'draft')
            throw new Error('请先创建新候选，再上传替换图，原图会保留。');
          const upload = await saveAssetUpload(input.imageBase64);
          asset.url = upload.url;
          asset.status = 'ready';
          asset.approved = false;
          asset.origin = 'upload';
          asset.uploadedFilename =
            typeof input.filename === 'string'
              ? input.filename.replace(/[\\/]/g, '_').slice(0,150)
              : '本地图片';
          asset.model = '本地上传';
          asset.error = undefined;
        } else if (input.action === 'asset_regenerate') {
          if (!['ready', 'failed'].includes(asset.status))
            throw new Error('请等待本次生成完成后再重新生成。');
          if (library.length >= 160) throw new Error('资产版本已达到上限。');
          const root = asset.parentId ?? asset.id;
          const family = library.filter(
            (a) =>
              (a.id === root || a.parentId === root) &&
              (a.viewId ?? 'master') === (asset.viewId ?? 'master'),
          );
          if (family.length >= 4)
            throw new Error('同一设计已保留 4 个候选，请修改设计要求后再建立新候选。');
          const next = {
            ...asset,
            id: randomUUID(),
            parentId: root,
            version: Math.max(...family.map((a) => a.version)) + 1,
            status: 'running' as const,
            approved: false,
            url: undefined,
            remoteId: undefined,
            error: undefined,
            model: undefined,
            origin: undefined,
            uploadedFilename: undefined,
            setReview: undefined,
            createdAt: Date.now(),
          };
          library.push(next);
          await save();
          try {
            await startAsset(p!, next);
          } catch (e) {
            const candidate = library.find((a) => a.id === next.id)!;
            candidate.status = 'failed';
            candidate.error = e instanceof Error ? e.message : '重新生成失败';
          }
        } else if (input.action === 'asset_generate') {
          if (asset.status !== 'draft')
            throw new Error('此候选已提交，请跟踪结果或创建新候选。');
          asset.status = 'running';
          await save();
          try {
            await startAsset(p!, asset);
          } catch (e) {
            asset.status = 'failed';
            asset.error = e instanceof Error ? e.message : '资产生成失败';
          }
        } else if (input.action === 'asset_poll') {
          if (asset.status === 'running')
            try {
              await updateAsset(asset);
            } catch (e) {
              asset.error = e instanceof Error ? e.message : '资产跟踪失败';
              if (!asset.remoteId) asset.status = 'failed';
            }
        } else if (input.action === 'asset_approve') {
          if (
            asset.status !== 'ready' ||
            (p!.mode === 'live' && (!asset.url || asset.promptVersion !== '3.0.0'))
          )
            throw new Error('请等待图片生成完成再确认。');
          const backupDir = path.join(studioRoot(), 'auto-backups');
          await mkdir(backupDir, { recursive: true });
          await writeFile(
            path.join(backupDir, p!.id + '-asset-' + Date.now() + '.json'),
            JSON.stringify(p, null, 2),
          );
          if (asset.sourceAssetId) {
            const source = library.find((a) => a.id === asset.sourceAssetId);
            if (source) source.setReview = undefined;
          }
          const root = asset.parentId ?? asset.id;
          for (const a of library)
            if (
              (a.id === root || a.parentId === root) &&
              (a.viewId ?? 'master') === (asset.viewId ?? 'master')
            )
              a.approved = false;
          if (!asset.viewId)
            for (const a of library)
              if (a.viewId && a.parentId === root && a.sourceAssetId !== asset.id) {
                a.approved = false;
                a.retired = true;
              }
          asset.approved = true;
          asset.setReview = undefined;
          if (p!.plan) invalidateAssetMedia(p!, asset);
          else p!.revision++;
          recordApproval(p!, 'asset', asset.id);
        } else if (input.action === 'asset_abandon') {
          if (asset.status !== 'running') throw new Error('该资产未在生成中。');
          asset.status = 'failed';
          asset.error = '已停止本地跟踪，供应商任务可能仍在执行并计费。';
        } else if (input.action === 'asset_retry') {
          if (asset.status !== 'failed' || library.length >= 160)
            throw new Error('只允许重试失败任务，每个作品最多 160 个资产版本。');
          if (asset.remoteId) {
            asset.status = 'running';
            asset.error = undefined;
          } else
            library.push({
              ...asset,
              id: randomUUID(),
              version: asset.version + 1,
              status: 'draft',
              error: undefined,
              createdAt: Date.now(),
            });
        } else if (input.action === 'asset_edit_design') {
          if (asset.status !== 'draft' || !asset.design || asset.viewId || asset.kind === 'variant')
            throw new Error('只能修改尚未生成的独立资产设计。');
          const revised = validateAssetDesigns(
            {
              assets: [
                {
                  ...asset.design,
                  description: input.notes,
                  kind: asset.kind,
                  name: asset.name,
                  evidence: asset.evidence,
                  requirement: asset.requirement,
                  sceneIds: asset.sceneIds,
                },
              ],
            },
            p!,
            { sources: asset.designOrigin === 'user' ? [asset.evidence ?? ''] : undefined },
          )[0];
          asset.design = revised.design;
          asset.prompt = revised.prompt;
          asset.promptVersion = revised.promptVersion;
        } else if (input.action === 'asset_costume' || input.action === 'asset_prop_state') {
          if (library.length >= 160) throw new Error('资产版本达到上限。');
          library.push(
            input.action === 'asset_costume'
              ? createCostumeSet(p!, input.assetId, input.notes)
              : createPropState(p!, input.assetId, input.notes),
          );
          // New costume/prop candidates do not change the selected reference.
        } else if (input.action === 'asset_use_costume') {
          selectCostume(p!, input.assetId);
          if (p!.plan) invalidateAssetMedia(p!, asset);
        } else if (input.action === 'asset_set_review') {
          reviewAssetSet(p!, input.assetId, input.notes);
        } else if (input.action === 'asset_views') {
          const views = createAssetViews(p!, input.assetId);
          if (library.length + views.length > 160)
            throw new Error('资产版本已达到 160 个上限。');
          library.push(...views);
        } else if (input.action === 'asset_rebuild') {
          if (library.length >= 160) throw new Error('每个作品最多 160 个资产版本。');
          library.push(rebuildAsset(p!, input.assetId));
        } else if (input.action === 'asset_variant') {
          if (library.length >= 160) throw new Error('每个作品最多保留 160 个资产版本。');
          library.push(variant(p!, input.assetId, input.notes, input.referenceIds ?? []));
        } else throw new Error('未知资产操作。');
      }
      bump(p!);
      await save();
      return p;
    },
};

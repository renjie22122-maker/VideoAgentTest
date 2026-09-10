import { planAssetLibrary } from '../../providers.ts';
import { uniqueAssetCandidates } from '../../auto-progress.ts';
import { noProgress } from '../run-controller.ts';
import type { AgentAction } from './types.ts';

/**
 * Asset text design: append-only, unapproved candidates. It can never merge,
 * delete, select versions or generate images; approved versions stay current.
 */
export const designAssetsAction: AgentAction = {
  id: 'design_assets',
  async execute(ctx) {
    const { project: p, run, decision, role, entry } = ctx;
    const assets = await planAssetLibrary(p, {
      model: role!.model,
      role: role!.name,
      checks: role!.checks,
      task: decision.reason,
      repair: false,
    });
    const library = p.production!.library ?? [];
    const candidates = uniqueAssetCandidates(assets, library);
    if (!candidates.length) {
      noProgress(run, '生成的资产设计与已有候选或批准版本相同。');
      entry.outcome = 'unchanged';
    } else {
      if (library.length + candidates.length > 160)
        throw new Error('资产候选数量达到上限。');
      p.production!.library = [...library, ...candidates];
      run.summary =
        '已新增 ' +
        candidates.length +
        ' 个未批准的文字设计候选。请在角色与场景中查看、生成或上传参考图并选择版本；原批准版本保留。继续文字协作，候选可稍后选择；不可或缺主图仅在相关镜头生成前检查。';
      entry.outcome = 'candidate_created';
      entry.artifactIds = candidates.map((a) => a.id);
      entry.message +=
        '【实际结果：仅新增未批准的文字设计候选，未合并资产、未改变原批准版本、未生成图片。】';
    }
  },
};

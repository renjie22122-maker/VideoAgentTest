import { loadProjects, saveProjects } from './shared.ts';
import { tick } from './jobs.ts';
import { updateAsset } from '../assets.ts';

/**
 * Background worker payload: advances approved media work without any page
 * request — the user may close the tab and the server keeps going.
 *
 * It only touches work the user already submitted: running asset generation,
 * queued/running media jobs (including long-take parts). It never starts
 * media, never runs agent steps and never calls an LLM. The caller (server
 * gateway) owns the mutation lock around it.
 */
let working = false;

export async function backgroundTick(): Promise<boolean> {
  if (working) return false;
  working = true;
  try {
    const all = await loadProjects();
    let advanced = false;
    for (const p of all) {
      for (const asset of p.production?.library ?? []) {
        if (asset.status !== 'running') continue;
        try {
          await updateAsset(asset);
          advanced = true;
        } catch (e) {
          asset.error = e instanceof Error ? e.message : '资产跟踪失败';
          if (!asset.remoteId) asset.status = 'failed';
        }
      }
      if (p.jobs.some((j) => j.status === 'queued' || j.status === 'running')) {
        await tick(p, async () => {
          p.updatedAt = Date.now();
          await saveProjects(all);
        });
        advanced = true;
      }
    }
    if (advanced) await saveProjects(all);
    return advanced;
  } finally {
    working = false;
  }
}

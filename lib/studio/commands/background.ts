import { loadProjects, saveProjectEntry, tryAcquireProjectLock, releaseProjectLock } from './shared.ts';
import { tick } from './jobs.ts';
import { updateAsset } from '../assets.ts';

/**
 * Background worker payload: advances approved media work without any page
 * request — the user may close the tab and the server keeps going.
 *
 * It only touches work the user already submitted: running asset generation,
 * queued/running media jobs (including long-take parts). It never starts
 * media, never runs agent steps and never calls an LLM. Each project is
 * processed under its own lock, and each save merges only that project's
 * entry — concurrent requests and other projects are never clobbered.
 */
let working = false;

export async function backgroundTick(): Promise<boolean> {
  if (working) return false;
  working = true;
  try {
    const all = await loadProjects();
    let advanced = false;
    for (const p of all) {
      if (!tryAcquireProjectLock(p.id)) continue;
      try {
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
            await saveProjectEntry(p);
          });
          advanced = true;
        }
        if (advanced) await saveProjectEntry(p);
      } finally {
        releaseProjectLock(p.id);
      }
    }
    return advanced;
  } finally {
    working = false;
  }
}

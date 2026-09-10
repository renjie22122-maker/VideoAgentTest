import type { Project } from './types.ts';
/** One polling lane alternates queue and asset queries, so they cannot contend with each other. */
export function nextMediaPoll(
  p: Project,
  assetTurn: boolean,
): { action: 'poll' | 'asset_poll'; assetId?: string } | undefined {
  const asset = p.production?.library?.find(
    (a) => !a.retired && a.status === 'running',
  );
  const queue = p.jobs.some(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  if (asset && (assetTurn || !queue))
    return { action: 'asset_poll', assetId: asset.id };
  if (queue) return { action: 'poll' };
}

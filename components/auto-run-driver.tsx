'use client';
import { useEffect } from 'react';
import type { Project } from '@/lib/studio/types';
export function AutoRunDriver({
  project,
  busy,
  paused,
  act,
}: {
  project: Project | null;
  busy: boolean;
  paused: boolean;
  act: (action: string, data?: Record<string, unknown>) => Promise<unknown>;
}) {
  const run = project?.production?.autoRun;
  useEffect(() => {
    if (busy || paused || run?.status !== 'running') return;
    const timer = setTimeout(
      () =>
        void act('auto_step', {
          expectedRunId: run.id,
          expectedStep: run.steps,
        }),
      1500,
    );
    return () => clearTimeout(timer);
  }, [busy, paused, run, act]);
  return null;
}

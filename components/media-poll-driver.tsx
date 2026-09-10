'use client';
import { useEffect, useRef } from 'react';
import { studioRequest } from '@/lib/studio/client';
import { nextMediaPoll } from '@/lib/studio/media-poll-state';
import type { Project } from '@/lib/studio/types';
/** Mounted outside view panels; only advances already authorized queue work and existing asset tracking. */
export function MediaPollDriver({
  project,
  paused,
  onUpdate,
  onError,
}: {
  project: Project | null;
  paused: boolean;
  onUpdate: (project: Project) => void;
  onError: (message: string) => void;
}) {
  const latest = useRef({ project, paused, onUpdate, onError });
  useEffect(() => {
    latest.current = { project, paused, onUpdate, onError };
  }, [project, paused, onUpdate, onError]);
  const id = project?.id;
  useEffect(() => {
    if (!id) return;
    let stopped = false,
      assetTurn = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = latest.current,
          p = state.project;
        if (state.paused || !p || p.id !== id) return;
        const command = nextMediaPoll(p, assetTurn);
        if (!command) return;
        assetTurn = command.action !== 'asset_poll';
        const next = await studioRequest<Project>(command.action, {
          id,
          revision: p.revision,
          ...(command.assetId ? { assetId: command.assetId } : {}),
        });
        if (!stopped) latest.current.onUpdate(next);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '素材结果暂时无法读取。';
        if (!stopped && !message.startsWith('工作台正在处理上一项操作'))
          latest.current.onError(message);
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 2000);
      }
    };
    timer = setTimeout(() => void poll(), 700);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);
  return null;
}

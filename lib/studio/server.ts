import { isReadOnlyCommand } from './command-policy.ts';
import { capabilities } from './providers.ts';
import { publicSettings } from './settings.ts';
import { skillCatalog } from './skills.ts';
import { readImage } from './openai-images.ts';
import { serveTakeVideo } from './take-media.ts';
import {
  loadProjects,
  saveProjects,
  NEXT_HANDLER,
  tryAcquireProjectLock,
  tryAcquireGlobalLock,
  releaseProjectLock,
  anyProjectLock,
} from './commands/shared.ts';
import type { Command, CommandContext, CommandHandler } from './commands/shared.ts';
import { globalCommandHandlers } from './commands/global.ts';
import { readonlyProjectHandlers } from './commands/readonly.ts';
import { coreCommandHandlers, lateCommandHandlers } from './commands/registry.ts';
import { backgroundTick } from './commands/background.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Registry surface for tests and future extensions.
export type { Command } from './commands/shared.ts';
export { globalCommandHandlers, readonlyProjectHandlers, coreCommandHandlers, lateCommandHandlers };

/**
 * Command gateway.
 *
 * dispatch keeps only: locking, load, revision guard, ordered registry
 * dispatch, persistence and the error boundary. Locks are project-scoped:
 * mutations of different projects run concurrently, and each save merges only
 * its own entry back into the shared file.
 */
export async function dispatch(input: Command): Promise<unknown> {
  // Atomic file replacement lets readers see the last committed state during generation.
  if (isReadOnlyCommand(input.action ?? '')) return handle(input);
  const busy = () =>
    new Error('工作台正在处理上一项操作，请等待完成后再提交。可重新打开作品查看已保存结果。');
  if (input.action === 'create' || input.action === 'save_settings' || !input.id) {
    if (!tryAcquireGlobalLock()) throw busy();
    try {
      return await handle(input);
    } finally {
      releaseProjectLock('*');
    }
  }
  if (!tryAcquireProjectLock(input.id)) throw busy();
  try {
    return await handle(input);
  } finally {
    releaseProjectLock(input.id);
  }
}

async function runHandlers(
  handlers: readonly CommandHandler[],
  ctx: CommandContext,
): Promise<unknown> {
  for (const handler of handlers) {
    if (!handler.matches(ctx.input)) continue;
    const result = await handler.run(ctx);
    if (result !== NEXT_HANDLER) return result;
  }
  return NEXT_HANDLER;
}

async function handle(input: Command): Promise<unknown> {
  if (input.action === 'status') return { ...capabilities(), runtimeBusy: anyProjectLock() };
  if (input.action === 'settings') return publicSettings();
  if (input.action === 'skills') return skillCatalog();
  const all = await loadProjects();
  const globalCtx: CommandContext = { input, all, save: () => saveProjects(all) };
  const globalResult = await runHandlers(globalCommandHandlers, globalCtx);
  if (globalResult !== NEXT_HANDLER) return globalResult;
  const p = all.find((x) => x.id === input.id);
  if (!p) throw new Error('项目不存在。');
  // Project-scoped save: merge only this project's entry (plus new projects
  // created during the command) back into the shared file, preserving any
  // concurrent changes to other projects.
  const ctx: CommandContext = {
    input,
    all,
    project: p,
    save: async () => {
      const disk = await loadProjects();
      const byId = new Map(disk.map((x) => [x.id, x]));
      byId.set(p.id, p);
      for (const entry of all) if (!byId.has(entry.id)) byId.set(entry.id, entry);
      await saveProjects([...byId.values()]);
    },
  };
  // Read-only project commands run before the guards: stale tabs can reconcile.
  const readResult = await runHandlers(readonlyProjectHandlers, ctx);
  if (readResult !== NEXT_HANDLER) return readResult;
  if (
    input.action !== 'poll' &&
    input.action !== 'cancel' &&
    input.revision !== p.revision
  )
    throw new Error('项目已在其他窗口更改，请重新打开项目后再编辑。');
  if (
    p.production?.autoRun?.status === 'running' &&
    !['auto_start', 'auto_step', 'auto_stop'].includes(input.action ?? '')
  )
    throw new Error('请先停止自动任务，再手动修改作品。');
  const coreResult = await runHandlers(coreCommandHandlers, ctx);
  if (coreResult !== NEXT_HANDLER) return coreResult;
  if (
    ![
      'approve_assets',
      'continuity_review',
      'compile',
      'approve_render',
      'enqueue',
      'poll',
      'review',
      'prepare_assembly',
      'complete',
    ].includes(input.action ?? '') &&
    p.production?.library?.some((a) => a.status === 'running')
  )
    throw new Error('请先完成或停止资产生成，再修改作品的核心设定。');
  const lateResult = await runHandlers(lateCommandHandlers, ctx);
  if (lateResult !== NEXT_HANDLER) return lateResult;
  throw new Error('未知操作。');
}

export function studioMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {  if (req.url?.startsWith('/api/studio-videos/')) {
    const match = /^\/api\/studio-videos\/([a-f0-9-]{36})\.mp4$/.exec(req.url);
    if (
      !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method !== 'GET' || !match) {
      res.writeHead(404);
      res.end();
      return;
    }
    void serveTakeVideo(match[1], req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(404);
        res.end();
      } else res.destroy();
    });
    return;
  }

  if (req.url?.startsWith('/api/studio-images/')) {
    const match = /^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(req.url);
    if (
      !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method !== 'GET' || !match) {
      res.writeHead(404);
      res.end();
      return;
    }
    void readImage(match[1], match[2])
      .then((bytes) => {
        res.writeHead(200, {
          'Content-Type': match[2] === 'jpg' ? 'image/jpeg' : 'image/' + match[2],
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        res.end(bytes);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
    return;
  }
  if (req.url?.split('?')[0] !== '/api/studio') return next();
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
    return send(403, { error: '仅允许本机访问。' });
  if (req.headers.origin && req.headers.origin !== 'http://' + host)
    return send(403, { error: '请求来源不被允许。' });
  if (req.method !== 'POST' || req.headers['x-frame-local'] !== '1')
    return send(405, { error: '请使用工作台发起请求。' });
  let body = '';
  let oversize = false;
  req.on('data', (chunk) => {
    if (oversize) return;
    body += chunk;
    if (Buffer.byteLength(body) > 12_000_000) {
      oversize = true;
      body = '';
    }
  });
  req.on('end', () => {
    if (oversize) return send(413, { error: '请求过大。' });
    let input;
    try {
      input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    } catch {
      return send(400, { error: '请求 JSON 无效。' });
    }
    void dispatch(input)
      .then((result) => send(200, { data: result }))
      .catch((e) => send(400, { error: e instanceof Error ? e.message : '请求失败' }));
  });
}

/**
 * Server-side media worker: advances approved generation and asset tracking
 * while the tab is closed. It takes per-project locks like any mutation —
 * a busy project skips one beat; other projects keep progressing. Set
 * STUDIO_BACKGROUND_WORKER=0 to disable. It never starts new work, never runs
 * agent steps, never spends beyond what the user already enqueued.
 */
export function startBackgroundWorker(intervalMs = 3000): () => void {
  if (process.env.STUDIO_BACKGROUND_WORKER === '0') return () => {};
  const timer = setInterval(() => {
    void backgroundTick().catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

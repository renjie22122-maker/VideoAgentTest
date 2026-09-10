import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Job, Shot } from '../types.ts';

/**
 * Command registry shared contract.
 *
 * `server.ts` keeps load / lock / revision guard / commit / error boundary.
 * Every project command is a registered handler that receives a bounded
 * context and either resolves a result or returns NEXT_HANDLER so the
 * dispatcher continues down the ordered registry.
 */

export type Command = {
  asset?: unknown;
  decisions?: unknown;
  expectedRunId?: string;
  expectedStep?: number;
  findingIds?: string[];
  maxSteps?: number;
  storyGuide?: unknown;
  neighborId?: string;
  videoInput?: Shot['videoInput'];
  regenerate?: boolean;
  agentConfig?: unknown;
  roleId?: string;
  action?: string;
  id?: string;
  revision?: number;
  idea?: unknown;
  duration?: unknown;
  ratio?: Project['ratio'];
  mode?: Project['mode'];
  answers?: Record<string, unknown>;
  script?: Record<string, unknown>;
  seed?: unknown;
  bible?: unknown;
  shot?: Shot;
  kind?: 'image' | 'video';
  verdict?: 'passed' | 'rejected';
  shotId?: string;
  notes?: unknown;
  settings?: unknown;
  assetId?: unknown;
  referenceIds?: unknown;
  imageBase64?: unknown;
  filename?: unknown;
};

/** Bounded command context: handlers mutate projects, never storage layout or locking. */
export type CommandContext = {
  input: Command;
  all: Project[];
  /** Set for every project-scoped command; global commands run without it. */
  project?: Project;
  save: () => Promise<void>;
};

export interface CommandHandler {
  /** Primary action this handler serves; used for registry introspection. */
  readonly action: string;
  matches(input: Command): boolean;
  run(ctx: CommandContext): Promise<unknown>;
}

/** Return this to fall through to the next handler in the ordered registry. */
export const NEXT_HANDLER: unique symbol = Symbol('studio.command.next');

/**
 * Storage location resolves from the environment at call time, not module
 * load: tests (and future multi-project hosts) may switch STUDIO_DATA_DIR
 * between requests, and cached modules must not pin an old directory.
 */
export function studioRoot() {
  return path.resolve(process.env.STUDIO_DATA_DIR || '.studio');
}

function projectsFile() {
  return path.join(studioRoot(), 'projects.json');
}

export async function loadProjects(): Promise<Project[]> {
  try {
    return JSON.parse(await readFile(projectsFile(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('项目存储无法读取，请检查 .studio/projects.json。');
  }
}

/** Atomic file replacement: readers see the last committed state during generation. */
export async function saveProjects(data: Project[]) {
  const root = studioRoot();
  await mkdir(root, { recursive: true });
  const tmp = projectsFile() + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, projectsFile());
}

export function bump(p: Project) {
  p.updatedAt = Date.now();
}

export function newJob(p: Project, shotId: string, kind: 'image' | 'video'): Job {
  return {
    id: randomUUID(),
    shotId,
    kind,
    status: 'queued',
    mode: p.mode,
    revision: p.revision,
    createdAt: Date.now(),
  };
}

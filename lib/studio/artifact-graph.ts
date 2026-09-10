import type { Project } from './types.ts';

/**
 * Artifact dependency graph (incremental adoption).
 *
 * Production FSM (graph.ts), the agent Task Graph (agent/task.ts) and this
 * Artifact Graph are three separate models. This module is the pure core:
 * it derives, from the project, which artifacts exist and what depends on
 * what, so downstream invalidation becomes computable instead of hand-written.
 */
export type ArtifactKind = 'script' | 'asset' | 'shot' | 'prompt' | 'video' | 'qa';
export type ArtifactRef = { id: string; kind: ArtifactKind };
export type ArtifactNode = {
  ref: ArtifactRef;
  /** current = usable; archived = superseded asset versions. */
  status: 'current' | 'archived';
};
export type DependencyType =
  | 'depicts'
  | 'uses_reference'
  | 'compiled_from'
  | 'generated_from'
  | 'reviewed_by';
export type ArtifactDependency = { from: ArtifactRef; to: ArtifactRef; reason: DependencyType };
export type ArtifactGraph = { nodes: ArtifactNode[]; dependencies: ArtifactDependency[] };
export type ArtifactEvent = { at: number; changed: ArtifactRef[]; affected: ArtifactRef[] };

const same = (a: ArtifactRef, b: ArtifactRef) => a.id === b.id && a.kind === b.kind;
const key = (ref: ArtifactRef) => ref.kind + ':' + ref.id;

export function buildArtifactGraph(p: Project): ArtifactGraph {
  const nodes: ArtifactNode[] = [];
  const dependencies: ArtifactDependency[] = [];
  const addNode = (ref: ArtifactRef, status: ArtifactNode['status']) => {
    if (nodes.some((n) => same(n.ref, ref))) return;
    nodes.push({ ref, status });
  };
  const addDep = (from: ArtifactRef, to: ArtifactRef, reason: DependencyType) => {
    if (dependencies.some((d) => same(d.from, from) && same(d.to, to) && d.reason === reason)) return;
    dependencies.push({ from, to, reason });
  };
  if (p.production?.script) addNode({ id: 'script', kind: 'script' }, 'current');
  for (const asset of p.production?.library ?? []) {
    addNode({ id: asset.id, kind: 'asset' }, asset.retired ? 'archived' : 'current');
  }
  for (const shot of p.plan?.shots ?? []) {
    addNode({ id: shot.id, kind: 'shot' }, 'current');
    if (p.production?.script)
      addDep({ id: shot.id, kind: 'shot' }, { id: 'script', kind: 'script' }, 'depicts');
    for (const assetId of shot.videoInput?.assetIds ?? [])
      addDep({ id: shot.id, kind: 'shot' }, { id: assetId, kind: 'asset' }, 'uses_reference');
    const hasPrompt = p.production?.prompts?.some((v) => v.shotId === shot.id);
    if (hasPrompt) {
      addNode({ id: shot.id, kind: 'prompt' }, 'current');
      addDep({ id: shot.id, kind: 'prompt' }, { id: shot.id, kind: 'shot' }, 'compiled_from');
    }
    if (shot.videoUrl || shot.videoMode) {
      addNode({ id: shot.id, kind: 'video' }, 'current');
      addDep(
        { id: shot.id, kind: 'video' },
        hasPrompt
          ? { id: shot.id, kind: 'prompt' }
          : { id: shot.id, kind: 'shot' },
        'generated_from',
      );
    }
    if (p.production?.qa.some((q) => q.shotId === shot.id)) {
      addNode({ id: shot.id, kind: 'qa' }, 'current');
      addDep({ id: shot.id, kind: 'qa' }, { id: shot.id, kind: 'video' }, 'reviewed_by');
    }
  }
  return { nodes, dependencies };
}

/**
 * Transitive downstream closure: every artifact that (transitively) depends
 * on one of the changed refs becomes stale.
 */
export function downstreamClosure(graph: ArtifactGraph, changed: ArtifactRef[]): ArtifactRef[] {
  const queue = changed.map(key);
  const affected = new Set<string>();
  const index = new Map<string, ArtifactDependency[]>();
  for (const dep of graph.dependencies) {
    const list = index.get(key(dep.to)) ?? [];
    list.push(dep);
    index.set(key(dep.to), list);
  }
  while (queue.length) {
    const current = queue.shift()!;
    for (const dep of index.get(current) ?? []) {
      const next = key(dep.from);
      if (affected.has(next)) continue;
      affected.add(next);
      queue.push(next);
    }
  }
  return [...affected]
    .map((k) => {
      const separator = k.indexOf(':');
      return { kind: k.slice(0, separator) as ArtifactKind, id: k.slice(separator + 1) };
    })
    .sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Append-only invalidation ledger: which artifacts changed and what the graph
 * says is downstream of them. Additive lineage — it never changes what the
 * existing invalidation code clears, only records the causality chain.
 */
export function recordInvalidation(p: Project, changed: ArtifactRef[], affected: ArtifactRef[]) {
  const events = (p.production!.artifactEvents ??= []);
  events.push({ at: Date.now(), changed, affected });
  if (events.length > 100) events.splice(0, events.length - 100);
}

import { filmTeam } from './team.ts';
import { capabilityLabels } from './agent/capabilities.ts';
import type { CapabilityId } from './agent/capabilities.ts';
import type { Project, NodeId } from './types.ts';
export type AgentDefinition = {
  id: string;
  name: string;
  stages: NodeId[];
  deliverable: string;
  checks: string;
  enabled: boolean;
  model?: string;
  /**
   * Explicit capability grants. Known built-in roles fall back to their
   * default grants when absent; custom roles must declare capabilities here
   * or the policy engine will refuse capability-required actions for them.
   */
  capabilities?: CapabilityId[];
};
export type AgentConfig = { version: 1; agents: AgentDefinition[] };
export const defaultAgents = (): AgentDefinition[] =>
  filmTeam.map((r) => ({ ...r, stages: [...r.stages], enabled: true }));
const stages = [
  'clarify',
  'script',
  'assets',
  'storyboard',
  'continuity',
  'prompts',
  'generation',
  'qa',
  'assembly',
  'complete',
];
export function validateAgentConfig(value: unknown): AgentConfig {
  const c = value as AgentConfig;
  if (
    !c ||
    c.version !== 1 ||
    !Array.isArray(c.agents) ||
    !c.agents.length ||
    c.agents.length > 40
  )
    throw new Error('Agent 配置须为 version:1，包含 1–40 个岗位。');
  const seen = new Set<string>();
  const agents = c.agents.map((a) => {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !/^[a-z][a-z0-9_]{0,49}$/.test(a.id) ||
      seen.has(a.id)
    )
      throw new Error('岗位 ID 必须唯一，使用小写字母、数字和下划线。');
    seen.add(a.id);
    for (const [key, max] of [
      ['name', 100],
      ['deliverable', 2000],
      ['checks', 6000],
    ] as const)
      if (typeof a[key] !== 'string' || !a[key].trim() || a[key].length > max)
        throw new Error('岗位 ' + a.id + ' 的 ' + key + ' 缺失或过长。');
    if (
      !Array.isArray(a.stages) ||
      !a.stages.length ||
      a.stages.some((s) => !stages.includes(s)) ||
      typeof a.enabled !== 'boolean'
    )
      throw new Error('岗位阶段或启用状态无效。');
    if (
      a.model !== undefined &&
      (typeof a.model !== 'string' || a.model.length > 120)
    )
      throw new Error('模型名称无效。');
    let capabilities: CapabilityId[] | undefined;
    if (a.capabilities !== undefined) {
      if (
        !Array.isArray(a.capabilities) ||
        a.capabilities.length > 20 ||
        a.capabilities.some(
          (c) => typeof c !== 'string' || !(c in capabilityLabels),
        ) ||
        new Set(a.capabilities).size !== a.capabilities.length
      )
        throw new Error('岗位能力须为有效的唯一能力 ID（最多 20 个）。');
      capabilities = [...a.capabilities] as CapabilityId[];
    }
    return {
      id: a.id,
      name: a.name.trim(),
      deliverable: a.deliverable.trim(),
      checks: a.checks.trim(),
      stages: [...new Set(a.stages)],
      enabled: a.enabled,
      ...(a.model?.trim() ? { model: a.model.trim() } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  });
  if (!agents.some((a) => a.enabled)) throw new Error('至少启用一个岗位。');
  return { version: 1, agents };
}
export function projectAgents(p: Project) {
  return p.production?.agentConfig
    ? validateAgentConfig(p.production.agentConfig).agents
    : defaultAgents();
}

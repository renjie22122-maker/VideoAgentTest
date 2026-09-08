'use client';
import { useState } from 'react';
import {
  defaultAgents,
  projectAgents,
  validateAgentConfig,
} from '@/lib/studio/team-config';
import type { Project } from '@/lib/studio/types';
import { Button } from './ui/button';
export function AgentCustomization({
  project,
  busy,
  act,
}: {
  project: Project;
  busy: boolean;
  act: (action: string, data?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [agents, setAgents] = useState(() => projectAgents(project)),
    [error, setError] = useState('');
  function save() {
    try {
      const agentConfig = validateAgentConfig({ version: 1, agents });
      setError('');
      void act('agent_config_save', { agentConfig });
    } catch (e) {
      setError(e instanceof Error ? e.message : '配置无效');
    }
  }
  return (
    <details>
      <summary>自定义本作品的 Agent 团队</summary>
      <p>
        启停、职责和阶段影响本作品后续部门规范；模型覆盖仅用于独立会审，使用 API
        设置中的同一服务和密钥。修改配置不会自动重生成素材，旧会审报告会标为过期。
      </p>
      {agents.map((a, i) => (
        <details key={a.id}>
          <summary>
            {a.name} · {a.enabled ? '启用' : '停用'}
          </summary>
          <label>
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) =>
                setAgents(
                  agents.map((v, n) =>
                    n === i ? { ...v, enabled: e.target.checked } : v,
                  ),
                )
              }
            />
            启用岗位
          </label>
          {(['name', 'deliverable', 'checks', 'model'] as const).map((k) => (
            <label key={k}>
              {
                {
                  name: '岗位名称',
                  deliverable: '输出要求',
                  checks: '专业规范',
                  model: '会审模型（留空使用默认）',
                }[k]
              }
              <textarea
                value={a[k] ?? ''}
                onChange={(e) =>
                  setAgents(
                    agents.map((v, n) =>
                      n === i ? { ...v, [k]: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
          ))}
        </details>
      ))}
      <Button
        disabled={busy || agents.length >= 40}
        onClick={() =>
          setAgents([
            ...agents,
            {
              id: 'custom_' + Date.now(),
              name: '自定义岗位',
              stages: ['continuity'],
              deliverable: '填写输出要求',
              checks: '填写专业规范',
              enabled: true,
            },
          ])
        }
      >
        新增岗位
      </Button>
      <details>
        <summary>高级：完整配置 JSON（阶段 / ID / 导入导出）</summary>
        <textarea
          aria-label="Agent 配置 JSON"
          key={JSON.stringify(agents)}
          defaultValue={JSON.stringify({ version: 1, agents }, null, 2)}
          onBlur={(e) => {
            try {
              setAgents(validateAgentConfig(JSON.parse(e.target.value)).agents);
              setError('');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'JSON 格式错误');
            }
          }}
        />
      </details>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy || !!error} onClick={save}>
        保存团队配置
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setAgents(defaultAgents());
          setError('');
        }}
      >
        恢复默认草案
      </Button>
    </details>
  );
}

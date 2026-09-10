import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  autoStep,
  continuityFixDecision,
  qualityFixDecision,
  createAutoRun,
  stopAutoRun,
  failAutoRun,
} from '../autopilot.ts';
import { assetRequirement } from '../asset-policy.ts';
import { validateAgentConfig } from '../team-config.ts';
import { text } from '../domain.ts';
import { bump, studioRoot } from './shared.ts';
import type { CommandHandler } from './shared.ts';

/** Auto-run supervision commands: start / step / stop and targeted fixes. */
export const autoCommandHandler: CommandHandler = {
  action: 'auto',
  matches: (input) =>
    ['auto_start', 'auto_step', 'auto_stop', 'continuity_fix', 'quality_fix'].includes(
      input.action ?? '',
    ),
    async run(ctx) {
      const { project: p, input, save } = ctx;
      const g = p!.production!;
      if (!g) throw new Error('作品未初始化。');
      if (input.action === 'auto_stop') {
        if (g.autoRun) stopAutoRun(g.autoRun);
      } else {
        if (
          p!.jobs.some((j) => ['running', 'queued'].includes(j.status)) ||
          g.library?.some(
            (a) => a.status === 'running' && assetRequirement(a, g.library) === 'required',
          )
        )
          throw new Error('请先完成或停止媒体生成。');
        if (input.action === 'auto_start') {
          if (g.autoRun?.status === 'running') throw new Error('自动任务已经运行。');
          const nextRun = createAutoRun(
            p!,
            text(input.notes, '自动任务要求', 2000),
            input.maxSteps ?? 4,
          );
          if (g.autoRun) {
            const backupDir = path.join(studioRoot(), 'auto-backups');
            await mkdir(backupDir, { recursive: true });
            await writeFile(
              path.join(backupDir, p!.id + '-restart-' + Date.now() + '.json'),
              JSON.stringify(p, null, 2),
            );
          }
          g.autoRun = nextRun;
        } else {
          const assigned =
            input.action === 'continuity_fix'
              ? continuityFixDecision(p!)
              : input.action === 'quality_fix'
                ? qualityFixDecision(p!, input.findingIds)
                : undefined;
          if (!assigned && g.autoRun?.status !== 'running')
            throw new Error('自动任务未启动。');
          const backupDir = path.join(studioRoot(), 'auto-backups');
          await mkdir(backupDir, { recursive: true });
          await writeFile(
            path.join(backupDir, p!.id + '-' + Date.now() + '.json'),
            JSON.stringify(p, null, 2),
          );
          const candidate = structuredClone(p!);
          if (assigned)
            candidate.production!.autoRun = createAutoRun(candidate, assigned.reason, 2);
          try {
            await autoStep(candidate, assigned);
            Object.assign(p!, candidate);
          } catch (e) {
            if (assigned) throw e;
            failAutoRun(g.autoRun!, e);
          }
        }
      }
      bump(p!);
      await save();
      return p;
    },
};

/** Agent configuration: roles, stages, models. */
export const agentConfigSaveHandler: CommandHandler = {
  action: 'agent_config_save',
  matches: (input) => input.action === 'agent_config_save',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    if (!p!.production) throw new Error('作品尚未初始化。');
    p!.production.agentConfig = validateAgentConfig(input.agentConfig);
    p!.production.agentConfigRevision = (p!.production.agentConfigRevision ?? 0) + 1;
    bump(p!);
    await save();
    return p;
  },
};

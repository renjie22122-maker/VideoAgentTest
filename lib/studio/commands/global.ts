import { analyzeClarification } from '../clarification.ts';
import { resolveDuration } from '../duration.ts';
import { text } from '../domain.ts';
import { initialProduction } from '../graph.ts';
import { productionSkills } from '../skills.ts';
import { capabilities } from '../providers.ts';
import { saveSettings } from '../settings.ts';
import { randomUUID } from 'node:crypto';
import type { Project } from '../types.ts';
import type { CommandHandler } from './shared.ts';

/** Global commands: run before project lookup, without a project context. */
export const globalCommandHandlers = [
  {
    action: 'save_settings',
    matches: (input) => input.action === 'save_settings',
    async run(ctx) {
      const { all, input } = ctx;
      if (all.some((p) => p.production?.library?.some((a) => a.status === 'running')))
        throw new Error('请先完成资产生成，再更换 API 设置。');
      if (
        all.some(
          (p) =>
            p.mode === 'live' &&
            p.jobs.some((j) => j.status === 'queued' || j.status === 'running'),
        )
      )
        throw new Error('请先完成或停止真实生成队列，再更换 API 设置。');
      return { settings: saveSettings(input.settings), capabilities: capabilities() };
    },
  },
  {
    action: 'list',
    matches: (input) => input.action === 'list',
    async run({ all }) {
      return all
        .map(({ id, title, updatedAt, phase, mode }) => ({
          id,
          title,
          updatedAt,
          phase,
          mode,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
  },
  {
    action: 'create',
    matches: (input) => input.action === 'create',
    async run(ctx) {
      const { all, input, save } = ctx;
      const idea = text(input.idea, '创意', 4000);
      const timing = resolveDuration(input.duration, { idea, answers: {} });
      const duration = timing.seconds;
      if (
        (input.ratio !== '16:9' && input.ratio !== '9:16' && input.ratio !== '1:1') ||
        (input.mode !== 'demo' && input.mode !== 'live')
      )
        throw new Error('画幅或模式无效。');
      const p: Project = {
        durationMode: timing.mode,
        durationReason: timing.reason,
        id: randomUUID(),
        revision: 1,
        idea,
        title: idea.slice(0, 18),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        duration,
        ratio: input.ratio,
        mode: input.mode,
        phase: 'clarify',
        questions: [],
        answers: {},
        jobs: [],
      };
      p.production = initialProduction();
      p.production.skillVersions = Object.fromEntries(
        Object.entries(productionSkills).map(([id, s]) => [id, s.version]),
      );
      const analysis = await analyzeClarification(p);
      p.brief = analysis.brief;
      p.questions = analysis.questions;
      all.push(p);
      await save();
      return p;
    },
  },
] as const satisfies readonly CommandHandler[];

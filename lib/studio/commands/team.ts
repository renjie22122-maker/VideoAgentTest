import { runTeamReview } from '../team-runtime.ts';
import { bump } from './shared.ts';
import type { CommandHandler } from './shared.ts';

/** Department text review requested directly from the workbench. */
export const teamReviewHandler: CommandHandler = {
  action: 'team_review',
  matches: (input) => input.action === 'team_review',
  async run(ctx) {
    const { project: p, input, save } = ctx;
    const { role } = await runTeamReview(p!, input.roleId);
    const g = p!.production!;
    g.events.push({
      at: Date.now(),
      node: g.node,
      role: role.name,
      message: '完成部门文本会审；建议不会自动修改作品或启动生成。',
    });
    bump(p!);
    await save();
    return p;
  },
};

import { teamInstructions } from './team.ts';
import type { NodeId } from './types.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const productionSkills={
 clarify:{name:'创意开发与需求澄清',role:'创意开发编辑',version:'1.0.0'},
 writer:{name:'短片文学剧本',role:'编剧',version:'2.0.0'},
 assets:{name:'美术与资产连续性',role:'美术指导',version:'3.0.0'},
 director:{name:'导演分镜与摄影调度',role:'导演',version:'2.0.0'},
 continuity:{name:'场记与叙事连续性',role:'场记',version:'1.0.0'},
 compiler:{name:'生成提示词编译',role:'提示词编译师',version:'2.0.0'},
 executor:{name:'生成任务执行',role:'执行制片',version:'2.0.0'},
 reviewer:{name:'画面质量与反思审查',role:'审片',version:'1.0.0'},
 editor:{name:'剪辑与声音后期方案',role:'剪辑指导',version:'1.0.0'},
} as const;
export type ProductionSkillId=keyof typeof productionSkills;
export function skillGuide(id:ProductionSkillId):string{const stage:Record<ProductionSkillId,NodeId>={clarify:'clarify',writer:'script',assets:'assets',director:'storyboard',continuity:'continuity',compiler:'prompts',executor:'generation',reviewer:'qa',editor:'assembly'};return readFileSync(path.resolve('production-skills',id+'.md'),'utf8')+teamInstructions(stage[id]);}
export function skillCatalog(){return Object.entries(productionSkills).map(([id,meta])=>({...meta,id,instructions:skillGuide(id as ProductionSkillId)}));}

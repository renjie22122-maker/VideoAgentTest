import type {Project} from './types.ts';
export type StoryGuide={canon:string;visualLanguage:string;scaleRules:string;handoff:string;editingMode:'linear'|'parallel'};
export type StoryContext={seriesId:string;actNumber:number;parentProjectId?:string;parentRevision?:number;guide:StoryGuide;previousAct?:{title:string;synopsis:string;ending:string;lastShot?:string;note:string}};
export const emptyStoryGuide=():StoryGuide=>({canon:'',visualLanguage:'',scaleRules:'',handoff:'',editingMode:'linear'});
export function validateStoryGuide(raw:unknown):StoryGuide{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('故事连续性资料格式无效。');const v=raw as Record<string,unknown>;const result=emptyStoryGuide();
 for(const key of ['canon','visualLanguage','scaleRules','handoff'] as const){if(typeof v[key]!=='string'||v[key].length>6000)throw new Error('每项故事资料须为不超过 6000 字的文字。');result[key]=v[key].trim();}
 if(!['linear','parallel'].includes(v.editingMode as string))throw new Error('剪辑结构无效。');result.editingMode=v.editingMode as StoryGuide['editingMode'];return result;
}
export function nextStoryContext(p:Project):StoryContext{
 return {seriesId:p.storyContext?.seriesId??p.id,actNumber:(p.storyContext?.actNumber??1)+1,parentProjectId:p.id,parentRevision:p.revision,guide:structuredClone(p.storyContext?.guide??emptyStoryGuide()),previousAct:{title:p.title,synopsis:p.production?.script?.synopsis??'',ending:p.production?.script?.scenes?.at(-1)?.endState??'',lastShot:p.plan?.shots.at(-1)?.description,note:'以上来自前幕文字剧本和分镜快照，不代表已验证的实际视频状态；实际成片差异以用户交接说明为准。'}};
}
export function storyContextForModel(p:Project){return p.storyContext??{guide:emptyStoryGuide(),actNumber:1};}

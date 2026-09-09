import {SOUND_SCHEMA} from './sound-plan.ts';
import {PERFORMANCE_SCHEMA,validatePerformances} from './performance.ts';
import {NARRATIVE_SCHEMA,validateNarrativeLinks} from './narrative.ts';
import { INTENT_SCHEMA,validateCoverage } from './shot-intent.ts';
import { MOTION_SCHEMA } from './motion.ts';
import { demoPlan, validatePlan, validateShot } from './domain.ts';
import type { Project, Plan } from './types.ts';

export const DIRECTOR_SCHEMA = SOUND_SCHEMA+PERFORMANCE_SCHEMA+NARRATIVE_SCHEMA+INTENT_SCHEMA+MOTION_SCHEMA+`只输出 {"shots":[...]}。每镜必填 scene（剧本场次 ID，不是地点名称）、title（1–100 字）、beat（1–1000 字）、description（1–4000 字）、dialogue（字符串）、sound（字符串）、duration（2–15 秒的数字）、size（wide/medium/close）、transition（cut/dissolve）、camera、startState、endState。
camera={movement:fixed/push/pull/track/orbit,lens:18–135 的数字,start:{x,y,z},end:{x,y,z},easing:linear/ease-in-out}。x 在 -10–10，y 在 0.1–10，z 在 0.1–15；均为数字。
startState 和 endState 都必须包含 pose（1–500 字）、screenDirection（left-to-right/right-to-left/static）、wardrobe、props、light（各 1–1000 字的字符串，无道具写“无”）、axis（A/B）。枚举必须原样使用，不能翻译为中文。全片 2–24 镜头。不要重新输出或改写剧本、美术设定。
默认按 sceneTiming 顺序拆分每个场次；仅 storyContext.guide.editingMode=parallel 时允许有依据的跨场交叉剪辑，逐场总时长仍须匹配。，每场镜头时长合计与该场秒数一致，全片合计等于 duration。不得通过跳过场次或截断动作来凑时长。`;

export function validateDirectorPlan(value:unknown,p:Project,requireIntent=false):Plan {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('分镜结果必须是包含 shots 数组的对象。');
 const raw=value as Record<string,unknown>;
 if(!Array.isArray(raw.shots)||raw.shots.length<2||raw.shots.length>24)throw new Error('shots 必须包含 2–24 个镜头。');
 const shots=raw.shots.map((shot,index)=>{try{return validateShot(shot,index);}catch(e){throw new Error('第 '+(index+1)+' 镜：'+(e instanceof Error?e.message:'结构无效'));}});
 const scenes=p.production?.script?.scenes;
 if(scenes?.length){
  let previous=-1;
  for(const [i,shot] of shots.entries()){
   const index=scenes.findIndex(s=>s.id===shot.scene);
   if(index<0)throw new Error('第 '+(i+1)+' 镜引用了未知场次「'+shot.scene+'」；允许：'+scenes.map(s=>s.id).join('、')+'。');
   if(index<previous&&p.storyContext?.guide.editingMode!=='parallel')throw new Error('第 '+(i+1)+' 镜的场次顺序与已确认剧本不一致。');
   previous=index;
  }
  for(const scene of scenes){const actual=shots.filter(s=>s.scene===scene.id).reduce((sum,s)=>sum+s.duration,0);if(Math.abs(actual-scene.duration)>.01)throw new Error('场次 '+scene.id+' 的分镜合计 '+Number(actual.toFixed(2))+' 秒，剧本要求 '+scene.duration+' 秒。');}
 }
 validateNarrativeLinks(shots,p.storyContext?.guide.editingMode==='parallel');
 validateCoverage(shots,p,requireIntent);
 validatePerformances(shots,p,requireIntent);
 for(const s of shots)for(const cue of s.soundCues??[]){if(cue.end>s.duration)throw new Error(s.id+' 声音层超出镜头时长。');if(cue.sourceSceneId!=='score'&&!scenes?.some(c=>c.id===cue.sourceSceneId))throw new Error(s.id+' 声音引用未知场次。');}
 const total=shots.reduce((sum,s)=>sum+s.duration,0);
 if(Math.abs(total-p.duration)>.5)throw new Error('分镜总时长 '+Number(total.toFixed(2))+' 秒，目标 '+p.duration+' 秒。');
 const script=p.production?.script,fallback=demoPlan(p);
 return validatePlan({title:script?.title??raw.title??fallback.title,logline:script?.logline??raw.logline??fallback.logline,synopsis:script?.synopsis??raw.synopsis??fallback.synopsis,bible:p.production?.assets?.bible??raw.bible??fallback.bible,shots});
}

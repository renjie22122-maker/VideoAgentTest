import { cameraPosition } from './animatic.ts';
import type {Project,Shot} from './types.ts';
export type ShotIntent={actionIndices:number[];dialogueIndices:number[];purpose:string;movementReason:string;speedPlan:string;actionTiming:string;visualPlan:string;cutReason:string;physicsChecks:string[];scaleAnchors:string[]};
export const INTENT_SCHEMA=`每镜必须含 intent={actionIndices:[本场 action 的 1 起始编号],dialogueIndices:[本场 dialogue 的 1 起始编号],purpose:"观众获得的信息或情绪变化",movementReason:"为何固定或移动，运动由什么事件触发",speedPlan:"缓慢/匀速/加速/减速的时间段和停止点，与 camera/motion 路径一致",actionTiming:"按秒列出动作起势、执行、反应和停顿，不塞入不可能完成的动作",visualPlan:"如何用主体、构图、视线和声音表达，而非重写剧情",cutReason:"与前镜的叙事或动作接点；首镜写建立空间",physicsChecks:["本镜具体的接触/惯性/遮挡/物体恒常风险，以及有剧情依据的超常例外"],scaleAnchors:["主体与人物/手/门/栏杆等已知对象的比例，来源或待确认状态"]}。覆盖所有剧本动作和对白。不能用空洞的电影感替代调度。没有尺寸依据时写相对关系或待确认，禁止把推测尺寸标为原文事实。`;
export function validateShotIntent(raw:unknown):ShotIntent{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('缺少分镜叙事与尺度设计。');const v=raw as Record<string,unknown>;
 const indices=(key:string)=>{const a=v[key];if(!Array.isArray(a)||a.length>40||a.some(n=>!Number.isInteger(n)||n<1)||new Set(a).size!==a.length)throw new Error(key+' 须为不重复的正整数数组。');return a as number[];};
 const field=(key:string)=>{const s=v[key];if(typeof s!=='string'||!s.trim()||s.length>1500)throw new Error(key+' 需有具体设计，且不超过 1500 字。');return s.trim();};
 if(!Array.isArray(v.physicsChecks)||!v.physicsChecks.length||v.physicsChecks.length>8||v.physicsChecks.some(s=>typeof s!=='string'||!s.trim()||s.length>500))throw new Error('每镜需有具体物理风险和例外约束。');
 if(!Array.isArray(v.scaleAnchors)||!v.scaleAnchors.length||v.scaleAnchors.length>8||v.scaleAnchors.some(s=>typeof s!=='string'||!s.trim()||s.length>500))throw new Error('每镜需有 1–8 项具体尺度锚点或待确认项。');
 return {physicsChecks:v.physicsChecks as string[],actionIndices:indices('actionIndices'),dialogueIndices:indices('dialogueIndices'),purpose:field('purpose'),movementReason:field('movementReason'),speedPlan:field('speedPlan'),actionTiming:field('actionTiming'),visualPlan:field('visualPlan'),cutReason:field('cutReason'),scaleAnchors:v.scaleAnchors as string[]};
}
export function validateCoverage(shots:Shot[],p:Project,required=false){
 if(!required&&!shots.some(s=>s.intent))return;
 if(shots.some(s=>!s.intent))throw new Error('新分镜必须逐镜提交叙事依据、视听设计和尺度锚点。');
 for(const scene of p.production?.script?.scenes??[]){
  const group=shots.filter(s=>s.scene===scene.id);const actions=new Set<number>(),dialogues=new Set<number>();
  for(const shot of group){for(const n of shot.intent!.actionIndices){if(n>scene.action.length)throw new Error(shot.id+' 引用了不存在的动作。');actions.add(n);}for(const n of shot.intent!.dialogueIndices){if(n>scene.dialogue.length)throw new Error(shot.id+' 引用了不存在的对白。');dialogues.add(n);}}
  const performances=shots.flatMap(s=>(s.performance??[]).filter(l=>(l.sourceSceneId??s.scene)===scene.id));
  if(shots.some(s=>s.performance!==undefined)){dialogues.clear();performances.forEach(l=>dialogues.add(l.dialogueIndex));}
  if(actions.size!==scene.action.length||dialogues.size!==scene.dialogue.length)throw new Error(scene.id+' 分镜遗漏已确认动作或对白，请检查 intent 覆盖表。');
  const normalize=(s:string)=>s.replace(/[\s\p{P}]/gu,'');
  if(normalize(shots.some(s=>s.performance!==undefined)?performances.map(l=>l.text).join(''):group.map(s=>s.dialogue).join(''))!==normalize(scene.dialogue.map(d=>d.line).join('')))throw new Error(scene.id+' 分镜对白与已确认剧本不一致，不得删除、重复或改写。');
 }
}
export function shotPlanningWarnings(s:Shot){
 const warnings:string[]=[];const count=s.dialogue.replace(/[\s\p{P}]/gu,'').length;
 if(count>s.duration*4)warnings.push('对白负荷偏高：'+count+' 字 / '+s.duration+' 秒，需为停顿和动作留白。');
 if(s.duration<4)warnings.push('短镜建议保留剪辑节奏，并与邻镜联合生成；不要仅为接口最低时长强改剧情。');
 if(s.intent?.scaleAnchors.some(v=>/待确认|未知|推测/.test(v)))warnings.push('尺度尚有待确认项，请在生成前核对。');
 return warnings;
}

export function cameraSpeedSummary(s:Shot){
 let previous=cameraPosition(s,0),distance=0,peak=0;const samples=60;
 for(let i=1;i<=samples;i++){const next=cameraPosition(s,i/samples),step=Math.hypot(next.x-previous.x,next.y-previous.y,next.z-previous.z);distance+=step;peak=Math.max(peak,step*samples/s.duration);previous=next;}
 return {distance:Number(distance.toFixed(2)),average:Number((distance/s.duration).toFixed(2)),peak:Number(peak.toFixed(2))};
}

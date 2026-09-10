import type { Project } from './types.ts';
export function estimateDuration(idea:string,answers:Record<string,string>={}){
 // Decision JSON is control metadata, not dialogue or additional story text.
 const content=[...new Set([idea,...Object.entries(answers).filter(([key])=>key!=='creative_suggestion_decisions').map(([,value])=>value)])].join('；');
 const quoted=[...content.matchAll(/[“「"]([^”」"\n]+)[”」"]/g)].map(m=>m[1]);
 const dialogue=quoted.join('').replace(/[\s\p{P}]/gu,'').length;
 const beats=Math.max(2,((content.match(/然后|随后|接着|最后|最终|转身|走进|离开|拿出|放下|打开|关上|挂断/g)??[]).length+2));
 const proposed=Math.ceil((dialogue/3.5+beats*4+6)/5)*5;
 return {seconds:Math.max(4,proposed),reason:'规则粗估：识别到约 '+dialogue+' 字引号内文本、'+beats+' 个动作节拍，预留停顿；保存澄清回答后更新估算；生成剧本使用页面显示的目标时长。',limited:false};
}
export function resolveDuration(value:unknown,p:Pick<Project,'idea'|'answers'>){
 if(value===undefined||value===null||value==='auto')return {mode:'auto' as const,...estimateDuration(p.idea,p.answers)};
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<4)throw new Error('指定时长须为 不小于 4 的有效整数秒，或选择自动估算。');
 return {mode:'manual' as const,seconds:value,reason:'用户指定时长',limited:false};
}

export function refreshEstimatedDuration(p:Pick<Project,'idea'|'answers'|'durationMode'|'duration'|'durationReason'>){
 if(p.durationMode!=='auto')return;
 const timing=estimateDuration(p.idea,p.answers);p.duration=timing.seconds;p.durationReason=timing.reason;
}

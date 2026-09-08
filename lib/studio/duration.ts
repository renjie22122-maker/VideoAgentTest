import type { Project } from './types.ts';
export function estimateDuration(idea:string,answers:Record<string,string>={}){
 const content=[idea,...Object.values(answers)].join('；');
 const quoted=[...content.matchAll(/[“「"]([^”」"\n]+)[”」"]/g)].map(m=>m[1]);
 const dialogue=quoted.join('').replace(/[\s\p{P}]/gu,'').length;
 const beats=Math.max(2,Math.min(12,(content.match(/然后|随后|接着|最后|最终|转身|走进|离开|拿出|放下|打开|关上|挂断/g)??[]).length+2));
 const proposed=Math.ceil((dialogue/3.5+beats*4+6)/5)*5;
 return {seconds:Math.max(12,Math.min(120,proposed)),reason:'规则粗估：识别到约 '+dialogue+' 字引号内文本、'+beats+' 个动作节拍，预留停顿；生成剧本前会根据澄清回答重新估算。'+(proposed>120?'估算超过当前 120 秒上限，请拆分作品或精简内容。':''),limited:proposed>120};
}
export function resolveDuration(value:unknown,p:Pick<Project,'idea'|'answers'>){
 if(value===undefined||value===null||value==='auto')return {mode:'auto' as const,...estimateDuration(p.idea,p.answers)};
 if(typeof value!=='number'||!Number.isInteger(value)||value<12||value>120)throw new Error('指定时长须为 12–120 的整数秒，或选择自动估算。');
 return {mode:'manual' as const,seconds:value,reason:'用户指定时长',limited:false};
}

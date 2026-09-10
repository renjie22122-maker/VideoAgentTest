import type { CreativeBrief } from './clarification.ts';
export type BriefDecision={suggestion:string;choice:'accept'|'reject'|'revise';replacement?:string};
export function validateBriefDecisions(brief:CreativeBrief,raw:unknown):BriefDecision[]{
 if(!Array.isArray(raw)||raw.length>brief.assumptions.length)throw new Error('建议处理结果格式无效。');
 const seen=new Set<string>();
 return raw.map(v=>{
  if(!v||typeof v!=='object'||!brief.assumptions.includes(v.suggestion)||seen.has(v.suggestion)||!['accept','reject','revise'].includes(v.choice))throw new Error('建议已更新或选择无效，请刷新后重新处理。');
  seen.add(v.suggestion);
  const replacement=typeof v.replacement==='string'?v.replacement.trim():'';
  if(v.choice==='revise'&&(!replacement||replacement.length>2000))throw new Error('修改后的要求须为 1–2000 字。');
  return {suggestion:v.suggestion,choice:v.choice,...(v.choice==='revise'?{replacement}:{})};
 });
}
export function confirmedBrief(brief:CreativeBrief|undefined){
 if(!brief)return null;
 const decisions=validateBriefDecisions(brief,brief.decisions??[]);
 if(brief.assumptions.some(s=>!decisions.some(d=>d.suggestion===s)))throw new Error('请先逐条接受、不接受或修改待确认建议，并保存选择。');
 // Model summaries can contain stale timing and superseded interpretations.
 return {known:brief.known.filter(f=>!/(片长|时长|duration)/i.test(f.topic)),history:brief.history,assumptions:decisions.filter(d=>d.choice!=='reject').map(d=>d.choice==='revise'?d.replacement!:d.suggestion),decisions};
}

export function inheritBriefDecisions(previous:CreativeBrief|undefined,next:CreativeBrief):CreativeBrief{
 const decisions=(previous?.decisions??[]).filter(d=>next.assumptions.includes(d.suggestion));
 return {...next,decisions:validateBriefDecisions(next,decisions)};
}

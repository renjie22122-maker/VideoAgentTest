import type {Shot,Project} from './types.ts';
export type LinePerformance={sourceSceneId?:string;dialogueIndex:number;characterId:string;text:string;start:number;end:number;mode:'on_screen'|'off_screen'|'voice_over';delivery:string;pace:string;emphasis:string;pauses:string;breath:string;listener:string};
export const PERFORMANCE_SCHEMA=`有对白的每镜必须有 performance 数组，每段={sourceSceneId:"台词来源场次ID，声桥允许与画面场次不同",dialogueIndex:来源场次对白1起始编号,characterId:"剧本人物ID",text:"本镜实际说出的原文片段，不改字",start:镜内开始秒,end:结束秒,mode:"on_screen/off_screen/voice_over",delivery:"表演意图、情绪与强度及变化，服从剧本 delivery",pace:"语速与变化",emphasis:"具体重读词，没有则写自然重音",pauses:"具体停顿位置与约秒数",breath:"呼吸/哽咽等，非剧情需要不额外加叫喊",listener:"对谁说或自语"}。完整覆盖本镜 dialogue，不得增删台词；无对白则 []。时窗含停顿与呼吸，不超过镜长；明确先做动作还是先说话。画外音不让画内角色错误动嘴；同人跨镜音色、口音、距离保持一致，除非剧情要求变化。禁止默认所有台词都慢速耳语或喊叫。`;
const normalize=(s:string)=>s.replace(/[\s\p{P}]/gu,'');
export function validatePerformance(raw:unknown):LinePerformance[]{
 if(!Array.isArray(raw)||raw.length>40)throw new Error('台词表演须为最多 40 段的数组。');
 return raw.map(value=>{if(!value||typeof value!=='object')throw new Error('台词表演格式无效。');const v=value as Record<string,unknown>;
 const str=(k:string)=>{const s=v[k];if(typeof s!=='string'||!s.trim()||s.length>1500)throw new Error('台词表演 '+k+' 不能为空或过长。');return s.trim();};
 if(!Number.isInteger(v.dialogueIndex)||Number(v.dialogueIndex)<1||!Number.isFinite(v.start)||!Number.isFinite(v.end)||Number(v.start)<0||Number(v.end)<=Number(v.start))throw new Error('台词来源编号或表演时间窗无效。');
 if(!['on_screen','off_screen','voice_over'].includes(String(v.mode)))throw new Error('台词声源方式无效。');
 return {...(v.sourceSceneId===undefined?{}:{sourceSceneId:str("sourceSceneId")}),dialogueIndex:Number(v.dialogueIndex),characterId:str('characterId'),text:str('text'),start:Number(v.start),end:Number(v.end),mode:v.mode as LinePerformance['mode'],delivery:str('delivery'),pace:str('pace'),emphasis:str('emphasis'),pauses:str('pauses'),breath:str('breath'),listener:str('listener')};});
}
export function validatePerformances(shots:Shot[],p:Project,required:boolean){
 for(const s of shots){if(!required&&s.performance===undefined)continue;const lines=s.performance??[];
 if(normalize(lines.map(l=>l.text).join(''))!==normalize(s.dialogue))throw new Error(s.id+' 台词表演必须完整覆盖本镜原文。');
 for(const l of lines){const source=p.production?.script?.scenes?.find(c=>c.id===(l.sourceSceneId??s.scene))?.dialogue[l.dialogueIndex-1];if(!source||source.characterId!==l.characterId||!normalize(source.line).includes(normalize(l.text)))throw new Error(s.id+' 台词说话人或原文片段与剧本不符。');if(l.sourceSceneId&&l.sourceSceneId!==s.scene&&l.mode==='on_screen')throw new Error(s.id+' 跨场声桥须标为画外声，不能让当前画面人物代说。');if(l.end>s.duration)throw new Error(s.id+' 台词表演时间窗超出镜头时长。');}
 }
}

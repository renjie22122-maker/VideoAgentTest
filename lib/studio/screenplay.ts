import type { Project } from './types.ts';
import { text, finite } from './domain.ts';

export type ScriptCharacter={id:string;name:string;description:string;want:string};
export type ScriptScene={id:string;interiorExterior:'INT'|'EXT'|'INT/EXT';location:string;timeOfDay:string;duration:number;characters:string[];purpose:string;conflict:string;turn:string;action:string[];dialogue:{characterId:string;delivery:string;line:string;afterAction:number}[];sound:string;endState:string};
// Optional structured fields keep existing saved prose drafts readable without inventing scenes.
export type Screenplay={title:string;logline:string;synopsis:string;schemaVersion?:2;theme?:string;dramaticQuestion?:string;characters?:ScriptCharacter[];scenes?:ScriptScene[]};
export type StructuredScreenplay=Screenplay&{schemaVersion:2;theme:string;dramaticQuestion:string;characters:ScriptCharacter[];scenes:ScriptScene[]};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('剧本必须是结构化对象。');return v as Record<string,unknown>;};
function array(v:unknown,name:string,min:number,max:number):unknown[]{if(!Array.isArray(v)||v.length<min||v.length>max)throw new Error(name+'数量应为 '+min+'–'+max+'。');return v;}
const optionalText=(v:unknown,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
export class ScreenplayTimingError extends Error {
 actual:number;target:number;
 constructor(actual:number,target:number){super('场次时长合计 '+Number(actual.toFixed(2))+' 秒，目标 '+target+' 秒，相差 '+Number(Math.abs(actual-target).toFixed(2))+' 秒。');this.name='ScreenplayTimingError';this.actual=actual;this.target=target;}
}
export function applySceneTiming(input:unknown,raw:unknown,total:number):StructuredScreenplay{
 const original=record(input),repair=record(raw);
 if(!Array.isArray(original.scenes)||!Array.isArray(repair.scenes)||repair.scenes.length!==original.scenes.length)throw new Error('时长修复必须覆盖全部原场次，不能增删场次。');
 const times=new Map<string,number>();
 for(const item of repair.scenes){const scene=record(item);const id=text(scene.id,'场次 ID',50);if(times.has(id))throw new Error('时长修复场次 ID 重复。');times.set(id,finite(scene.duration,2,total,'场次秒数'));}
 return validateScreenplay({...original,scenes:original.scenes.map(item=>{const scene=record(item);if(!times.has(String(scene.id)))throw new Error('时长修复缺少原场次。');return {...scene,duration:times.get(String(scene.id))};})},total);
}
export function validateScreenplay(input:unknown,total:number):StructuredScreenplay{
 const s=record(input);if(s.schemaVersion!==2)throw new Error('请先生成结构化剧本，再确认。旧版正文仍保留供参考。');
 const characters=array(s.characters,'人物',1,12).map(v=>{const c=record(v);return {id:text(c.id,'人物 ID',50),name:text(c.name,'人物名',100),description:text(c.description,'可见人物特征',1500),want:text(c.want,'人物目标',1000)};});
 const ids=new Set(characters.map(c=>c.id));if(ids.size!==characters.length)throw new Error('人物 ID 不能重复。');
 const scenes=array(s.scenes,'场次',1,Math.max(12,Math.floor(total/2))).map(v=>{const c=record(v);
   if(!['INT','EXT','INT/EXT'].includes(String(c.interiorExterior)))throw new Error('场次需注明 INT、EXT 或 INT/EXT。');
   const cast=array(c.characters,'出场人物',0,12).map(v=>text(v,'出场人物 ID',50));if(cast.some(id=>!ids.has(id)))throw new Error('场次引用了未定义的人物。');
   const action=array(c.action,'动作段落',1,20).map(v=>text(v,'可拍摄动作',2000));
   const dialogue=array(c.dialogue,'对白',0,40).map(v=>{const d=record(v),id=text(d.characterId,'对白人物 ID',50);if(!cast.includes(id))throw new Error('对白人物必须列入该场出场人物，画外音也需登记。');const afterAction=finite(d.afterAction,0,action.length-1,'对白所接动作段落索引');if(!Number.isInteger(afterAction))throw new Error('对白动作索引必须为整数。');return {characterId:id,delivery:optionalText(d.delivery,200),line:text(d.line,'对白',1500),afterAction};});
   return {id:text(c.id,'场次 ID',50),interiorExterior:c.interiorExterior as ScriptScene['interiorExterior'],location:text(c.location,'场景地点',300),timeOfDay:text(c.timeOfDay,'时间',100),duration:finite(c.duration,2,total,'场次秒数'),characters:cast,purpose:text(c.purpose,'场次目的',1500),conflict:text(c.conflict,'阻力或不确定性',1500),turn:text(c.turn,'场次变化',1500),action:array(c.action,'动作段落',1,20).map(v=>text(v,'可拍摄动作',2000)),dialogue,sound:text(c.sound,'声音设计',1000),endState:text(c.endState,'场末状态',1500)};
 });
 if(new Set(scenes.map(c=>c.id)).size!==scenes.length)throw new Error('场次 ID 不能重复。');
 const actual=scenes.reduce((n,c)=>n+c.duration,0);
 if(Math.abs(actual-total)>.5)throw new ScreenplayTimingError(actual,total);
 return {schemaVersion:2,title:text(s.title,'片名',100),logline:text(s.logline,'一句话故事',2000),synopsis:text(s.synopsis,'故事梗概',8000),theme:text(s.theme,'主题',1000),dramaticQuestion:text(s.dramaticQuestion,'核心悬念',1000),characters,scenes};
}
export const WRITER_GUIDE=`你负责可拍摄的短片文学剧本，后续导演会另行拆分镜头。
按以下次序创作并在提交前自检：
1. 忠于用户明确的主角、地点、结尾与风格；不擅自添加大场面、角色或旁白。开放细节可合理补足。
2. 建立人物当下可行动的目标、具体阻力/不确定性，以及结尾可见的变化；安静短片也可以用迟疑、等待、误会推进，不强塞反派或三幕比例。
3. 按时空连续性划分场次，而非每换镜头就换场。每场提供 INT/EXT、地点、时间、出场人物、预计秒数、场次目的、阻力、转折与场末动作/道具状态。
4. action 写现在时、具体的可见行为，用动作体现情绪。不要写“命运发生改变”“内心复杂”等无法直接拍摄的抽象说明。动作段落按因果顺序排列。
5. dialogue 仅用于必要的角色台词，每项严格写成 {characterId:人物ID,delivery:简短表演提示或空字符串,line:台词,afterAction:从0开始的动作段落索引}。afterAction 指明在哪个 action 段落后说这句台词，确保动作和对白可按顺序排版。无对白要求时 dialogue=[]；画外说话的人物也需登记。
6. sound 写可听见的声源及其叙事作用；明确是环境声、音效还是配乐建议。没有额外声音时也明确说明。
7. 同一人物与道具命名一致。结尾必须回应开场建立的问题，除非用户明确要求开放式片段。
8. 片长是硬约束：所有场次 duration 合计等于用户总秒数；留足动作与停顿，台词长度应能自然说完。12–30 秒通常只需 1–3 场，不为凑结构增加转场。
9. 不写景别、焦距、镜头编号或运镜指令；这是文学剧本层。场次 ID 稳定，例如 scene-1；人物 ID 稳定，例如 character-1。
严格按 outputSchemaExample 返回 schemaVersion=2 的 JSON。示例是字段说明，不可照抄示例的剧情。只返回最终剧本，勿输出自检过程。`;

export function demoScreenplay(p:Project):StructuredScreenplay{
 const name=p.answers.subject||'主角',location=p.answers.location||'待确定场景',ending=p.answers.ending||'主角完成动作';
 return {schemaVersion:2,title:p.idea.slice(0,18),logline:p.idea,synopsis:'在'+location+'，'+name+'围绕创意展开行动，最后'+ending+'。',theme:p.answers.tone||'通过具体行动呈现情绪变化',dramaticQuestion:'主角是否完成「'+ending+'」？',characters:[{id:'character-1',name:'主角',description:name,want:ending}],scenes:[{id:'scene-1',interiorExterior:'EXT',location,timeOfDay:'待核实（演示默认）',duration:p.duration,characters:['character-1'],purpose:'建立主角，完成用户指定事件。',conflict:'待编剧具体化：关键动作完成前的阻力或迟疑。',turn:ending,action:[name+'出现在'+location+'。','演示待细化：'+p.idea,ending+'。'],dialogue:[],sound:'环境声延续；演示不生成音轨。',endState:ending}]};
}
export function screenplayWarnings(s:Screenplay,total:number):string[]{
 if(!s.scenes)return ['这是旧版梗概式剧本，尚未包含结构化场次。'];const warnings:string[]=[];
 const duration=s.scenes.reduce((n,c)=>n+c.duration,0);if(Math.abs(duration-total)>.5)warnings.push('场次合计 '+duration+' 秒，目标为 '+total+' 秒。');
 for(const c of s.scenes){const count=c.dialogue.reduce((n,d)=>n+d.line.replace(/\s/g,'').length,0);if(count>c.duration*4)warnings.push(c.id+' 的对白可能过密（粗略字符估算），请朗读计时并为动作留白。');if(c.action.some(a=>/待细化|待编剧/.test(a))||/待核实/.test(c.timeOfDay)||/待编剧/.test(c.conflict))warnings.push(c.id+' 含演示占位设定，需人工具体化。');}
 return warnings;
}
export function screenplayText(s:Screenplay):string{
 const names=Object.fromEntries((s.characters??[]).map(c=>[c.id,c.name]));return ['Title: '+s.title,'','Logline: '+s.logline,'',...(s.scenes??[]).flatMap((c,i)=>['','.'+c.interiorExterior+'. '+c.location+' - '+c.timeOfDay+' #'+(i+1)+'#','',...c.action.flatMap((a,index)=>[a,'',...c.dialogue.filter(d=>d.afterAction===index).flatMap(d=>['@'+(names[d.characterId]||d.characterId),...(d.delivery?['('+d.delivery+')']:[]),d.line,''])]),'[[声音：'+c.sound+']]'])].join('\n');
}

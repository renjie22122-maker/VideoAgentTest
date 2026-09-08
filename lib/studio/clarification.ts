import type { Project, Question } from './types.ts';
import { text } from './domain.ts';
import { roleJSON } from './providers.ts';
import { skillGuide } from './skills.ts';
export type CreativeBrief={summary:string;known:{topic:string;value:string;evidence:string}[];assumptions:string[];ready:boolean;round:number;source:'model'|'demo';history:{question:string;answer:string}[]};
export type ClarificationResult={brief:CreativeBrief;questions:Question[]};
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('创意分析格式无效。');return v as Record<string,unknown>;}
export function validateClarification(raw:unknown,p:Project,history:CreativeBrief['history']):ClarificationResult{
 const v=obj(raw);if(!Array.isArray(v.known)||v.known.length>30||!Array.isArray(v.assumptions)||v.assumptions.length>12||!Array.isArray(v.questions)||v.questions.length>4||typeof v.ready!=='boolean')throw new Error('创意分析没有返回有效的事实、建议与问题。');
 const sources=[p.idea,...history.map(h=>h.answer),...Object.values(p.answers)];
 const known=v.known.map(item=>{const f=obj(item),evidence=text(f.evidence,'信息依据',600);if(!sources.some(s=>s.includes(evidence)))throw new Error('创意分析的事实依据不在原文或回答中，请重试。');return {topic:text(f.topic,'信息类别',80),value:text(f.value,'已知信息',1500),evidence};});
 const questions=v.questions.map(item=>{const q=obj(item);const id=text(q.id,'问题 ID',50);if(!/^[a-z][a-z0-9_-]*$/.test(id)||['constructor','prototype'].includes(id))throw new Error('问题 ID 无效。');if(!Array.isArray(q.options)||q.options.length>3||q.required!==true)throw new Error('澄清问题需有有效选项并标为关键问题。');return {id,label:text(q.label,'问题',1000),why:text(q.why,'提问原因',1000),placeholder:typeof q.placeholder==='string'?q.placeholder.slice(0,300):'',options:q.options.map(o=>text(o,'选项',500)),required:true};});
 if(new Set(questions.map(q=>q.id)).size!==questions.length||v.ready!==(questions.length===0))throw new Error('澄清问题与就绪状态不一致。');
 return {questions,brief:{summary:text(v.summary,'创意理解',4000),known,assumptions:v.assumptions.map(a=>text(a,'待确认建议',1200)),ready:v.ready,round:(p.brief?.round??0)+1,source:p.mode==='live'?'model':'demo',history}};
}
export function demoClarification(p:Project,history:CreativeBrief['history']):ClarificationResult{
 const known:CreativeBrief['known']=[];const questions:Question[]=[];const content=p.idea;
 const add=(id:string,label:string,why:string,options:string[])=>{if(p.answers[id]?.trim()){known.push({topic:label,value:p.answers[id],evidence:p.answers[id]});return;}questions.push({id,label,why,options,placeholder:'可以选择方向，也可以直接写你的想法',required:true});};
 if(!history.length){
   const scene=content.match(/(?:雨后|黄昏|凌晨|夜晚|白天|车站|面包店|街道|海边|室内)/g);if(scene)known.push({topic:'已提及的时空',value:scene.join('、'),evidence:scene[0]});
 }
 if(/信|信件/.test(content))add('letter_meaning','这封信最关键的内容或来历是什么？','它会决定主角为何行动，以及结尾回应什么。',['来自过去的自己','来自重要的人','由编剧设计，但保留温暖结尾']);
 else if(/产品|广告|品牌/.test(content))add('product_message','这条片子最需要观众记住哪个产品特点？','决定事件、视觉重点和结尾信息。',['突出使用效果','突出情感价值','先展示外观与质感']);
 else if(/追|逃|寻找|找/.test(content))add('motivation','主角为什么必须完成这次追逐或寻找？','动机决定阻力和动作的紧迫程度。',['避免失去重要的人或物','完成一个承诺','由编剧补充动机']);
 else add('core_event','在「'+content.slice(0,45)+'」中，你最想看到哪个具体变化发生？','把画面想法收束成可以拍摄的核心事件。',['人物作出一个选择','一个物件或环境发生变化','由编剧设计具体事件']);
 if(!/结尾|最后|最终|离开|回到|结束/.test(content))add('ending','你希望结尾让观众明确知道结果，还是留下悬念？','确定收束方式，避免编剧擅自解释故事。',['明确完成事件','留下开放结尾','由编剧根据创意决定']);
 if(!/无对白|对白|旁白|配音|台词/.test(content))add('voice','这个故事通过画面和声音表达，还是需要人物说话？','影响剧本节奏、台词和后续声音制作。',['无对白，靠动作表达','少量人物对白','需要旁白']);
 return {questions,brief:{summary:'我理解的核心创意是：'+p.idea+'。目标 '+p.duration+' 秒，画幅 '+p.ratio+'。',known,assumptions:['演示模式只做关键词分析；真实模式会由语言模型阅读全文并针对性澄清。'],ready:questions.length===0,round:(p.brief?.round??0)+1,source:'demo',history}};
}
export async function analyzeClarification(p:Project,history:CreativeBrief['history']=p.brief?.history??[]):Promise<ClarificationResult>{
 if(p.mode==='demo')return demoClarification(p,history);
 const result=await roleJSON('创意开发编辑',skillGuide('clarify'),{idea:p.idea,duration:p.duration,ratio:p.ratio,previousBrief:p.brief??null,history,additionalAnswers:p.answers});
 return validateClarification(result,p,history);
}
